/**
 * [신설: 2026-08-25 16:40, 김병현 작성]
 *
 * DB 이벤트 → "원본(rawdata) 엑셀 12칸 표"로 되돌리는 순수 모듈.
 *
 * 하는 일은 딱 하나: 모양 바꾸기. DB도 파일도 안 건드린다(그건 export.service.ts 몫).
 * 순수하게 떼어 둔 이유는 이 규칙들이 전부 "값이 맞나"를 눈으로 확인해야 하는 것들이라,
 * DB나 엑셀 라이브러리 없이 배열만 넣고 돌려볼 수 있어야 하기 때문이다.
 *
 * ⚠ 이 파일의 핵심 계약: **칸 순서는 COLUMNS 하나로만 정해진다.**
 *   헤더 줄과 데이터 줄이 같은 배열을 돌기 때문에, 한쪽만 고치고 다른 쪽을 깜빡하는
 *   어긋남(제일 흔한 내보내기 버그)이 구조적으로 생길 수가 없다.
 */
import { competitionLabel } from './competition.service';
import { pointsForStat } from './scoring';
import { RawDataCell, RawDataRow, StatEvent } from './types';

// 대회 id → 연도·시즌번호를 찾기 위한 최소 정보.
// CompetitionRow 전체를 요구하지 않는 이유: 이 모듈이 필요한 건 세 칸뿐이라,
// 그 세 칸만 요구해야 테스트에서 가짜 대회를 한 줄로 만들 수 있다(좁은 입구 = 싼 검증).
export interface CompetitionMeta {
  id: number;
  year: number;
  seasonNo: number | null;
  name: string;
}

// 원본 rawdata 시트의 12칸. **여기 순서가 곧 파일의 칸 순서다.**
// header 는 원본 파일의 글자를 그대로 베꼈다 — 한 글자라도 다르면 기존 엑셀 수식이 깨진다.
const COLUMNS: { header: string; pick: (row: RawDataRow) => RawDataCell }[] = [
  { header: '연도', pick: (r) => r.year },
  { header: '시즌', pick: (r) => r.seasonNo },
  { header: '주차', pick: (r) => r.week },
  { header: '경기', pick: (r) => r.game },
  { header: '쿼터', pick: (r) => r.quarter },
  { header: '선수', pick: (r) => r.player },
  { header: '스텟', pick: (r) => r.stat },
  { header: '팀명', pick: (r) => r.team },
  { header: '팀index', pick: (r) => r.teamIndex },
  { header: '활동여부', pick: (r) => r.active },
  { header: '주차인덱스', pick: (r) => r.weekIndex },
  { header: '득점', pick: (r) => r.points },
];

// 헤더 줄(사람이 읽는 칸 이름 12개). 시트 첫 줄에 그대로 들어간다.
export const RAWDATA_HEADERS: string[] = COLUMNS.map((c) => c.header);

// 스텟 코드를 셀 값으로. 숫자로만 된 코드('1','2','3')는 숫자로 넣는다 — 원본이 그렇다.
// (문자열 '2' 로 넣으면 엑셀이 "숫자가 텍스트로 저장됨" 경고 삼각형을 칸마다 띄운다.)
// '2F','1FA' 처럼 글자가 섞이면 당연히 문자열 그대로다.
function statCell(code: string): RawDataCell {
  return /^\d+$/.test(code) ? Number(code) : code;
}

// 주차인덱스: 원본의 '2023S1W1G1' 형식.
// 시즌번호가 없는 대회(seasonNo = null)면 S 구간을 통째로 뺀다 → '2026W1G1'.
// 'S' 만 남겨 '2026SW1G1' 로 쓰면 나중에 되읽을 때 시즌번호가 빈 문자열로 파싱돼 헷갈린다.
export function weekIndexOf(
  year: number,
  seasonNo: number | null,
  week: number,
  game: number,
): string {
  const season = seasonNo != null ? `S${seasonNo}` : '';
  return `${year}${season}W${week}G${game}`;
}

// 이벤트 하나 → 원본 12칸 행 하나.
function toRow(event: StatEvent, competition: CompetitionMeta): RawDataRow {
  const points = pointsForStat(event.stat);
  return {
    year: competition.year,
    seasonNo: competition.seasonNo ?? '',
    week: event.week,
    game: event.game,
    quarter: event.quarter,
    player: event.player,
    stat: statCell(event.stat),
    team: event.team,
    // DB에 없는 값 — 항상 빈칸이다(이유는 types.ts 의 RawDataRow 주석).
    teamIndex: '',
    active: '',
    weekIndex: weekIndexOf(competition.year, competition.seasonNo, event.week, event.game),
    // 0점짜리 코드(DR, A, S …)는 원본에서 빈칸이다. 0 을 찍으면 원본과 달라진다.
    points: points === 0 ? '' : points,
  };
}

// 정렬 기준: 연도 → 시즌 → 주차 → 경기 → 쿼터.
// 원본 파일이 이 순서로 쌓여 있고, 사람이 열어서 훑을 때도 이게 맞다.
// 시즌번호 없는 대회(null)는 그 해의 맨 뒤로 보낸다 — 대회 목록 정렬(competition.service.list)과
// 같은 규칙이라 두 화면에서 순서가 서로 어긋나지 않는다.
function compareRows(a: RawDataRow, b: RawDataRow): number {
  if (a.year !== b.year) return a.year - b.year;
  // 빈 시즌('')은 숫자 시즌보다 뒤. 둘 다 빈 시즌이면 동점 처리하고 다음 기준으로 넘어간다.
  const seasonA = a.seasonNo === '' ? Number.POSITIVE_INFINITY : Number(a.seasonNo);
  const seasonB = b.seasonNo === '' ? Number.POSITIVE_INFINITY : Number(b.seasonNo);
  if (seasonA !== seasonB) return seasonA - seasonB;
  if (a.week !== b.week) return a.week - b.week;
  if (a.game !== b.game) return a.game - b.game;
  return a.quarter - b.quarter;
}

/**
 * 이벤트 목록 + 대회 목록 → 원본 양식 12칸 행 배열(정렬 완료).
 *
 * 대회 목록을 따로 받는 이유: StatEvent 는 대회를 id 와 '표시 라벨'로만 들고 있는데,
 * 원본 파일엔 연도·시즌이 **따로따로** 들어간다. 라벨('2023 시즌1 · 나이배')을 다시
 * 쪼개서 숫자를 뽑는 건 문자열 파싱이라 대회명에 '시즌'이 들어가면 바로 깨진다.
 * 그래서 쪼개지 않고, 처음부터 숫자를 가진 쪽(Competition 행)을 받아 쓴다.
 *
 * 목록에 없는 대회의 이벤트는 **조용히 버리지 않고 건너뛰되 그 사실을 돌려준다**
 * (skipped). 내보내기에서 행이 소리 없이 사라지는 건 최악이라 부르는 쪽이 알아야 한다.
 *
 * ⚠ 입력 배열(events)은 절대 건드리지 않는다. store.getEvents() 가 돌려주는 건 캐시가
 *   들고 있는 바로 그 배열이라, 여기서 sort() 하면 캐시가 오염된다(store.service.ts 경고).
 */
export function buildRawDataRows(
  events: StatEvent[],
  competitions: CompetitionMeta[],
): { rows: RawDataRow[]; skipped: number } {
  const byId = new Map(competitions.map((c) => [c.id, c]));

  const rows: RawDataRow[] = [];
  let skipped = 0;
  for (const event of events) {
    const competition = byId.get(event.competitionId);
    if (!competition) {
      skipped++;
      continue;
    }
    rows.push(toRow(event, competition));
  }

  // 새 배열을 만들어 정렬한다(위 ⚠ 참고 — 원본 배열은 안 건드린다).
  rows.sort(compareRows);
  return { rows, skipped };
}

// 행 배열 → 엑셀에 그대로 넣을 2차원 배열(첫 줄은 헤더).
// COLUMNS 를 돌기 때문에 칸 순서는 헤더와 무조건 같다.
export function toSheetGrid(rows: RawDataRow[]): RawDataCell[][] {
  const grid: RawDataCell[][] = [RAWDATA_HEADERS];
  for (const row of rows) grid.push(COLUMNS.map((c) => c.pick(row)));
  return grid;
}

// 내보낼 파일 이름. '전체'면 대회 없이, 아니면 대회 라벨을 넣는다.
//
// 왜 서버가 정하나: 라벨 규칙(competitionLabel)이 이미 서버에 있다. 프론트가 제 이름을
// 또 만들면 규칙이 두 곳으로 갈라진다 — 이 저장소는 이미 그 문제로 한 번 데였다
// (UploadPage 의 competitionLabel 복제본 주석 참고). 그래서 이름도 서버가 정하고,
// 프론트는 응답 헤더(Content-Disposition)에서 받아 그대로 쓴다.
//
// stamp 는 부르는 쪽이 넘긴다(예: '20260825'). 여기서 new Date() 를 부르면 같은 입력에
// 다른 결과가 나와 이 모듈이 순수하지 않게 된다.
export function rawDataFileName(competition: CompetitionMeta | null, stamp: string): string {
  const scope = competition
    ? competitionLabel(competition.year, competition.seasonNo, competition.name)
    : '전체';
  return `rawdata_${sanitizeFileName(scope)}_${stamp}.xlsx`;
}

// 파일 이름에 못 쓰는 글자를 '_' 로 바꾼다(윈도우 기준이 제일 빡빡해서 그쪽에 맞춘다).
// 한글·공백·가운뎃점(·)은 셋 다 멀쩡하니 그대로 둔다.
function sanitizeFileName(raw: string): string {
  // eslint-disable-next-line no-control-regex
  return raw.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim();
}
