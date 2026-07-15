/**
 * 과거 기록 엑셀(xlsx) → 깨끗한 행 배열로 바꿔주는 "순수 리더".
 *
 * 이 파일은 일부러 Prisma·NestJS·competition.service 를 전혀 import 하지 않는다.
 * 이유: 적재 스크립트(import-legacy-xlsx.ts)는 `prisma.competition` 을 쓰는데,
 * 생성된 Prisma client 가 아직 옛 스키마(Season)면 타입 에러가 난다. 검증 스크립트가
 * 파서를 그 파일 통해 가져오면 검증도 같이 못 돈다. 그래서 파서만 여기 떼어놓으면
 * (DB·client 재생성 없이) 메모리 엑셀만으로도 지금 이 환경에서 실제로 돌릴 수 있다.
 *
 * 하는 일: 시트 고르기 → 헤더 키워드로 컬럼 찾기(INDEX 보조컬럼은 무시) →
 * 병합셀 forward-fill → 시즌 경계에서 주차/경기/쿼터 이월 리셋 → 스텟 코드 정규화 →
 * 빈 행 skip.
 * [변경: 2026-07-15 12:39, 김병현 수정] 원본에 '팀명' 칸이 생겨 team 도 여기서 읽는다.
 *   앱 파서(parser.service.ts)와 같은 키워드로 잡고 병합셀 forward-fill 한다. 팀명 칸이
 *   아예 없는 구버전 파일이면 '-' 로 채운다(옛 동작 유지). '팀index'·'주차인덱스' 같은 보조
 *   컬럼은 index 무시 규칙과 "가장 왼쪽 컬럼 우선"으로 안 걸린다.
 */
import * as XLSX from 'xlsx';
import { KNOWN_CODES, normalizeCode } from '../src/stats/scoring';

// 파싱된 한 행 (DB 무관). 연도·시즌은 있고 팀은 없다(팀은 적재 시점에 '-'로 채운다).
// [변경: 2026-07-15 12:39, 김병현 수정] 원본에 '팀명' 칸이 생겨 team 을 여기서 읽어 담는다
//   (구버전 파일처럼 팀명 칸이 없으면 리더가 '-' 로 채운다 — 위 옛 설명은 그 fallback 경우만 해당).
// [주의] app 의 ParsedEvent 를 재사용하지 않는다: ParsedEvent 는 team 이 있고 year/seasonNo 가
// 없다. 이 리더의 출력은 team·year·seasonNo 를 모두 담아서 전용 타입이 맞다.
export interface LegacyRow {
  year: number; // 연도 (예: 2023)
  seasonNo: number; // 시즌번호 (엑셀 '시즌' 칸). competitionId 가 아니다.
  week: number; // 주차
  game: number; // 주차 내 경기 번호
  quarter: number; // 쿼터
  player: string; // 선수 이름 (원본 그대로 — '김진우1' 접미사 유지)
  stat: string; // 스텟 코드 (normalizeCode 로 대문자 정규화)
  team: string; // 팀명 (엑셀 '팀명' 칸. 칸이 없으면 '-'). 앱 파서와 같은 키워드로 읽는다.
}

// 파싱 중 발견한 경고. 미등록 코드/필수값 미해결 등을 모아 3년치 파일의 오타를 조기 발견한다.
export interface ParseWarning {
  row: number; // 엑셀 기준 1-based 행 번호
  player: string; // 선수 (없을 수 있어 빈 문자열 허용)
  code: string; // 코드 경고면 그 코드, 아니면 '' (예: 주차 미해결)
  message: string;
}

export interface ParseResult {
  rows: LegacyRow[];
  warnings: ParseWarning[];
  unknownCodes: string[]; // 중복 제거된 미등록 코드 목록
  sheet: string; // 실제로 읽은 시트 이름
}

// 대회(=(year, seasonNo) 그룹)별 개수 요약. 라벨은 여기서 안 만든다
// (competitionLabel 의존을 피해 리더를 순수하게 유지 — 그 규칙은 적재 스크립트에서만 쓴다).
export interface CompetitionSummary {
  year: number;
  seasonNo: number;
  rowCount: number;
  distinctWeeks: number; // Set(week).size
  distinctGames: number; // Set(`${week}|${game}`).size — (week,game) 쌍 개수
}

// 헤더 컬럼을 찾기 위한 키워드 사전. 셀 텍스트에 키워드가 포함되면 해당 필드로 인식.
const HEADER_KEYWORDS: Record<string, string[]> = {
  year: ['연도', 'year'],
  seasonNo: ['시즌', 'season'],
  week: ['주차', 'week'],
  game: ['경기', 'game'],
  quarter: ['쿼터', 'quarter'],
  player: ['선수', '이름', 'player'],
  stat: ['스텟', '스탯', '기록', 'stat'],
  // [변경: 2026-07-15 12:39, 김병현 수정] 팀명 칸 인식 키워드 추가(앱 파서와 동일).
  // '팀index' 는 matchField 의 index 무시 규칙에 걸려 team 으로 오인되지 않는다.
  team: ['팀명', '팀', 'team'],
};

type Field =
  | 'year'
  | 'seasonNo'
  | 'week'
  | 'game'
  | 'quarter'
  | 'player'
  | 'stat'
  | 'team';
type ColumnMap = Record<Field, number>;

// 헤더 탐지에 꼭 필요한 7개 필드(하나라도 없으면 행을 온전히 만들 수 없다).
// [변경: 2026-07-15 12:39, 김병현 수정] team(팀명)은 여기 넣지 않는다 — 구버전 파일 호환을 위해
//   "선택" 컬럼으로 둔다(있으면 읽고, 없으면 적재 때 '-'). 그래서 팀명 없어도 헤더 탐지는 통과한다.
const REQUIRED_FIELDS: Field[] = [
  'year',
  'seasonNo',
  'week',
  'game',
  'quarter',
  'player',
  'stat',
];

// 엑셀 버퍼를 파싱해서 (연도·시즌 포함) 깨끗한 행 배열로 바꾼다.
export function parseLegacyWorkbook(buffer: Buffer): ParseResult {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = pickSheet(wb);
  const ws = wb.Sheets[sheetName];

  // 2차원 배열로 변환 (빈 칸은 null 유지, 빈 행도 유지해서 행 번호를 엑셀과 맞춘다)
  const grid: unknown[][] = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    blankrows: true,
    defval: null,
    raw: true,
  });

  const { headerIndex, cols } = detectHeader(grid);

  const rows: LegacyRow[] = [];
  const warnings: ParseWarning[] = [];
  const unknown = new Set<string>();

  // 병합 셀 대비 forward-fill 상태. null = "아직 값을 본 적 없음".
  let lastYear: number | null = null;
  let lastSeason: number | null = null;
  let lastWeek: number | null = null;
  let lastGame: number | null = null;
  let lastQuarter: number | null = null;
  // [변경: 2026-07-15 12:39, 김병현 수정] 팀명 forward-fill 상태(병합셀 대비). null = 아직 못 봄.
  let lastTeam: string | null = null;
  let prevKey: string | null = null; // 직전 데이터 행의 `${year}|${seasonNo}` (시즌 경계 감지용)

  for (let r = headerIndex + 1; r < grid.length; r++) {
    const row = grid[r] ?? [];
    const player = text(row[cols.player]);
    const rawStat = text(row[cols.stat]);

    // (1) 연도/시즌 확정: anchor(값 있는 칸) 있으면 갱신, 없으면 직전 값으로 채움.
    const y = int(row[cols.year]);
    if (y != null) lastYear = y;
    const year = lastYear;
    const s = int(row[cols.seasonNo]);
    if (s != null) lastSeason = s;
    const seasonNo = lastSeason;

    // 선수/스텟이 둘 다 없는 행은 데이터가 아님(오른쪽 범례/빈 행) → 조용히 건너뜀.
    if (!player || !rawStat) continue;

    // 대회를 못 정하면(연도/시즌 미해결) 이 행은 어디에 넣을지 알 수 없음 → skip + 경고.
    if (year == null || seasonNo == null) {
      warnings.push({
        row: r + 1,
        player,
        code: '',
        message: `시즌(연도/시즌) 미해결 → 행 skip (${player}, ${r + 1}행)`,
      });
      continue;
    }

    // (2) 시즌 경계 리셋: (year, seasonNo) 가 직전 데이터 행과 달라지면
    // 주차/경기/쿼터 이월 상태를 버린다(앞 대회 마지막 주차가 다음 대회 첫 행에 새는 것 방지).
    // [변경: 2026-07-15 12:39, 김병현 수정] 팀명 이월 상태도 함께 버린다(앞 대회 팀명이 다음 대회로
    //   새는 것 방지 — 팀명은 보통 행마다 있어 무해하지만 병합셀 대비 대칭 처리).
    const key = `${year}|${seasonNo}`;
    if (key !== prevKey) {
      lastWeek = null;
      lastGame = null;
      lastQuarter = null;
      lastTeam = null;
      prevKey = key;
    }

    // (3) 주차/경기/쿼터 확정: anchor 있으면 갱신, 없으면 (방금 리셋됐을 수 있는) 직전 값.
    const w = int(row[cols.week]);
    if (w != null) lastWeek = w;
    let week = lastWeek;
    const g = int(row[cols.game]);
    if (g != null) lastGame = g;
    let game = lastGame;
    const q = int(row[cols.quarter]);
    if (q != null) lastQuarter = q;
    let quarter = lastQuarter;

    // (4) anchor·직전값 둘 다 없어 못 정하면 0 으로 두되 비-fatal 경고로 시끄럽게 남긴다
    // (연도/시즌처럼 대칭으로 — 조용히 0 이 되어 gameId 집계가 오염되는 걸 막는다).
    if (week == null) {
      warnings.push({ row: r + 1, player, code: '', message: `주차 미해결 → 0 처리 (${player}, ${r + 1}행)` });
      week = 0;
    }
    if (game == null) {
      warnings.push({ row: r + 1, player, code: '', message: `경기 미해결 → 0 처리 (${player}, ${r + 1}행)` });
      game = 0;
    }
    if (quarter == null) {
      warnings.push({ row: r + 1, player, code: '', message: `쿼터 미해결 → 0 처리 (${player}, ${r + 1}행)` });
      quarter = 0;
    }

    // [변경: 2026-07-15 12:39, 김병현 수정] (4.5) 팀명 확정: 병합셀 대비 forward-fill(앱 파서와 동일).
    // 팀명 칸이 있는데 값이 비면 경고(다른 필드와 대칭) 후 '-'. 칸 자체가 없는 구버전 파일이면
    // 조용히 '-'(cols.team < 0 이면 경고 안 함 → 매 행 경고로 시끄러워지지 않는다).
    const teamCell = cols.team >= 0 ? text(row[cols.team]) : '';
    if (teamCell) lastTeam = teamCell;
    let team = teamCell || lastTeam || '';
    if (!team) {
      if (cols.team >= 0) {
        warnings.push({ row: r + 1, player, code: '', message: `팀명 미해결 → '-' 처리 (${player}, ${r + 1}행)` });
      }
      team = '-';
    }

    // (5) 스텟 코드 정규화 + 미등록 코드 수집(코드는 대문자만, player 는 손대지 않는다).
    const stat = normalizeCode(rawStat);
    if (!KNOWN_CODES.has(stat)) {
      unknown.add(stat);
      warnings.push({
        row: r + 1,
        player,
        code: stat,
        message: `미등록 스텟 코드 '${stat}' (${player}, ${r + 1}행)`,
      });
    }

    rows.push({ year, seasonNo, week, game, quarter, player, stat, team });
  }

  return { rows, warnings, unknownCodes: [...unknown], sheet: sheetName };
}

// 파싱된 행들을 (year, seasonNo) 대회 단위로 묶는다(첫 등장 순). 요약·적재가 같은 그룹핑을
// 쓰도록 여기 한 곳에만 둔다(DRY — 적재 스크립트가 이 함수를 재사용한다).
export function groupByCompetition(rows: LegacyRow[]): Map<string, LegacyRow[]> {
  const groups = new Map<string, LegacyRow[]>();
  for (const r of rows) {
    const key = `${r.year}|${r.seasonNo}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(r);
    else groups.set(key, [r]);
  }
  return groups;
}

// 파싱된 행들을 대회 단위로 묶어 개수만 요약한다.
// distinctGames 는 반드시 (week, game) 쌍으로 센다 — 경기 번호는 주차마다 1부터 다시
// 시작하므로 Set(game) 으로 세면 서로 다른 경기가 뭉쳐서 과소 집계된다.
export function summarizeRows(rows: LegacyRow[]): CompetitionSummary[] {
  return [...groupByCompetition(rows).values()].map((groupRows) => {
    const { year, seasonNo } = groupRows[0];
    const weeks = new Set(groupRows.map((r) => r.week));
    const games = new Set(groupRows.map((r) => `${r.week}|${r.game}`));
    return {
      year,
      seasonNo,
      rowCount: groupRows.length,
      distinctWeeks: weeks.size,
      distinctGames: games.size,
    };
  });
}

// 읽을 시트 선택: 이름이 'rawdata'와 비슷하면 우선, 없으면 첫 번째 시트.
function pickSheet(wb: XLSX.WorkBook): string {
  const raw = wb.SheetNames.find((n) =>
    n.replace(/\s+/g, '').toLowerCase().includes('rawdata'),
  );
  return raw ?? wb.SheetNames[0];
}

// 헤더 행 탐지: 앞쪽 행들을 위→아래로 훑어, 7개 필드가 모두 매칭되는 "첫" 행을 헤더로 본다.
// 못 찾으면, 그나마 가장 헤더에 가까웠던 후보 행 기준으로 "못 찾은 컬럼"을 콕 집어 에러를 던진다.
function detectHeader(grid: unknown[][]): { headerIndex: number; cols: ColumnMap } {
  const scanLimit = Math.min(grid.length, 30);
  let bestMissing: Field[] = [...REQUIRED_FIELDS]; // 미매칭이 가장 적었던(=가장 헤더 같던) 후보
  for (let r = 0; r < scanLimit; r++) {
    const row = grid[r] ?? [];
    const cols: Partial<ColumnMap> = {};
    for (let c = 0; c < row.length; c++) {
      const field = matchField(text(row[c]));
      // 같은 필드가 여러 컬럼에 걸리면 가장 왼쪽(먼저 만난) 컬럼만 사용.
      if (field && cols[field] === undefined) cols[field] = c;
    }
    const missing = REQUIRED_FIELDS.filter((f) => cols[f] === undefined);
    if (missing.length === 0) {
      // [변경: 2026-07-15 12:39, 김병현 수정] team 은 선택 컬럼 — 없으면 -1 로 못박아
      //   본문에서 `cols.team >= 0` 한 번으로 "칸 유무"를 판별한다(undefined 비교 회피).
      if (cols.team === undefined) cols.team = -1;
      return { headerIndex: r, cols: cols as ColumnMap };
    }
    if (missing.length < bestMissing.length) bestMissing = missing;
  }
  throw new Error(
    `헤더를 찾지 못했습니다. 못 찾은 컬럼: ${bestMissing.join('/')} ` +
      '(연도/시즌/주차/경기/쿼터/선수/스텟 헤더가 한 행에 모두 있어야 합니다).',
  );
}

// 셀 텍스트가 어떤 필드 헤더인지 판별. 'index' 가 들어간 헤더(INDEX/시즌index 보조컬럼)는
// 무조건 무시 → 컬럼 순서·개수에 무관하게 안전(예: '시즌index' 가 seasonNo 로 오인되지 않음).
function matchField(headerText: string): Field | null {
  const t = headerText.toLowerCase();
  if (!t) return null;
  if (t.includes('index')) return null;
  for (const [field, kws] of Object.entries(HEADER_KEYWORDS)) {
    if (kws.some((kw) => t.includes(kw.toLowerCase()))) return field as Field;
  }
  return null;
}

// 셀 → 문자열 (null/undefined는 빈 문자열).
function text(cell: unknown): string {
  if (cell === null || cell === undefined) return '';
  return String(cell).trim();
}

// 셀 → 정수. 숫자면 내림(음수면 null). 문자열이면 첫 정수 덩어리를 뽑되,
// 리딩 마이너스(음수 표기)는 거부해 null. 매칭 없으면 null. (예: '3주차'→3, '3주2'→3, '-3'→null)
function int(cell: unknown): number | null {
  if (typeof cell === 'number' && Number.isFinite(cell)) {
    const n = Math.trunc(cell);
    return n >= 0 ? n : null;
  }
  const m = text(cell).match(/-?\d+/);
  if (!m) return null;
  const n = parseInt(m[0], 10);
  return n >= 0 ? n : null;
}
