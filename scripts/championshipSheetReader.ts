/**
 * [신설: 2026-09-02 김병현 작성]
 *
 * 기록 엑셀의 '우승' 시트 → 깨끗한 배열로 바꿔주는 "순수 리더".
 *
 * legacyXlsxReader.ts 와 같은 이유로 Prisma·NestJS 를 전혀 import 하지 않는다:
 * DB 없이 엑셀 파일만으로 "제대로 읽히나"를 바로 돌려볼 수 있어야 해서다.
 *
 * ── '우승' 시트 생김새 (rawdata.xlsx 기준) ──────────────────────────────
 *   A1: 2023년                                       ← 연도 헤더줄 (A칸만 채움)
 *   A2: 시즌1 | B2: 박연진팀 | C2~: 전성식 한승혁 …   ← 우승 1건
 *   A3: 시즌2 | B3: 단백질팀 | C3~: …
 *   A5: 2024년
 *   …
 *   A16: 시즌1 |  (B칸 비어 있음)                      ← 아직 안 정해진 자리표시 → 건너뜀
 *
 * 즉 "연도는 위쪽 헤더줄에서 물려받고, 시즌·팀·멤버는 그 줄에서 읽는다".
 * 이 물려받기가 이 파일에서 유일하게 까다로운 부분이다.
 */
import * as XLSX from 'xlsx';
// 앱 파서와 같은 이름 정규화 규칙(공백 제거)을 재사용한다. 접미사('김진우1')는 그대로 둔다.
import { normalizePlayerName } from '../src/stats/playerCheck';

// 우승 1건. DB 무관 — competitionId 는 적재 스크립트가 (year, seasonNo) 로 찾아 붙인다.
export interface ChampionshipSheetRow {
  excelRow: number; // 엑셀 기준 1-based 행 번호 (사람이 파일에서 찾아보라고 남긴다)
  year: number;
  seasonNo: number;
  teamName: string;
  players: string[]; // 우승 멤버(중복 제거, 파일 등장 순)
}

// 건너뛴 줄 한 개. "조용히 사라졌다"가 제일 나쁜 결과라 이유까지 남긴다.
export interface SkippedRow {
  excelRow: number;
  text: string; // 그 줄의 A칸(무슨 줄이었는지 눈으로 알아보게)
  reason: string;
}

export interface ChampionshipSheetResult {
  rows: ChampionshipSheetRow[];
  skipped: SkippedRow[];
  sheet: string; // 실제로 읽은 시트 이름
}

// 시트 이름 후보. 원본은 '우승' 한 글자지만, 공백이나 접미사가 붙어도 잡히게 '포함'으로 본다.
const SHEET_KEYWORD = '우승';
// 선수 명단 시트(대조용). 원본 이름은 '선수명'.
const PLAYER_SHEET_KEYWORD = '선수명';

/** '우승' 시트를 읽어 우승 기록 배열로 바꾼다. */
export function parseChampionshipSheet(buffer: Buffer): ChampionshipSheetResult {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = pickSheet(wb, SHEET_KEYWORD);
  const grid: unknown[][] = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
    header: 1,
    blankrows: true, // 빈 줄도 유지해야 행 번호가 엑셀과 맞는다
    defval: null,
    raw: true,
  });

  const rows: ChampionshipSheetRow[] = [];
  const skipped: SkippedRow[] = [];
  // 연도는 헤더줄에서 물려받는다. null = "아직 연도 헤더를 못 봤다".
  let currentYear: number | null = null;

  for (let r = 0; r < grid.length; r++) {
    const row = grid[r] ?? [];
    const excelRow = r + 1;
    const head = text(row[0]);
    if (!head) continue; // 완전히 빈 줄 — 조용히 넘어간다(보고할 게 없다)

    // (1) 연도 헤더줄인가? '2023년' / '2023' 둘 다 받는다.
    const yearMatch = /^(\d{4})\s*년?$/.exec(head);
    if (yearMatch) {
      currentYear = Number(yearMatch[1]);
      continue;
    }

    // (2) 우승 줄인가? '시즌1' / '시즌 1' 둘 다 받는다.
    const seasonMatch = /^시즌\s*(\d+)/.exec(head);
    if (!seasonMatch) {
      skipped.push({ excelRow, text: head, reason: '연도 줄도 시즌 줄도 아님' });
      continue;
    }
    // 연도 헤더가 아직 안 나왔는데 시즌 줄이 먼저 오면 어느 해인지 알 수 없다.
    // 0 같은 걸로 때우면 엉뚱한 대회에 붙으므로 반드시 건너뛴다.
    if (currentYear == null) {
      skipped.push({ excelRow, text: head, reason: '위쪽에 연도 줄이 없어 연도 미해결' });
      continue;
    }

    const teamName = text(row[1]);
    // 팀명이 비면 "아직 안 치러진 시즌"이다(원본의 2026 시즌1~4 가 그렇다). 우승이 없는 것이지
    // 데이터가 깨진 게 아니라서, 경고가 아니라 담담한 사유로 남긴다.
    if (!teamName) {
      skipped.push({
        excelRow,
        text: head,
        reason: `${currentYear}년 ${head} — 우승팀 칸이 비어 있음(아직 미정)`,
      });
      continue;
    }

    // (3) 멤버는 C칸(index 2)부터 오른쪽 끝까지. 대회마다 인원이 달라 길이가 제각각이다.
    const players = uniqueInOrder(
      row.slice(2).map((cell) => normalizePlayerName(text(cell))).filter((p) => p !== ''),
    );
    if (players.length === 0) {
      skipped.push({
        excelRow,
        text: head,
        reason: `${currentYear}년 ${head} — 팀명(${teamName})은 있는데 멤버가 하나도 없음`,
      });
      continue;
    }

    rows.push({
      excelRow,
      year: currentYear,
      seasonNo: Number(seasonMatch[1]),
      teamName,
      players,
    });
  }

  return { rows, skipped, sheet: sheetName };
}

/**
 * '선수명' 시트의 `우승횟수` 칸을 읽어 (선수 → 횟수) 표로 돌려준다. **대조 전용**이다.
 *
 * 이 값을 DB에 넣지 않는 이유: 저건 '우승' 시트를 손으로 센 값이라 원본이 아니다.
 * 실제로 대조해 보면 한 명(김진우2)이 어긋난다 — 그래서 우리는 '우승' 시트만 믿고 적재하고,
 * 이 표는 "내가 읽은 게 사람이 세둔 것과 맞나"를 눈으로 확인하는 데만 쓴다.
 *
 * 시트나 칸이 없으면 null(= "대조 못 함"). 빈 Map(= "정말 아무도 없다")과 반드시 구분한다.
 */
export function readSheetWinCounts(buffer: Buffer): Map<string, number> | null {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = wb.SheetNames.find((n) => n.includes(PLAYER_SHEET_KEYWORD));
  if (!sheetName) return null;

  const grid: unknown[][] = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
    header: 1,
    blankrows: true,
    defval: null,
    raw: true,
  });
  const header = (grid[0] ?? []).map((c) => text(c));
  const nameCol = header.findIndex((h) => h.includes('선수명'));
  const winCol = header.findIndex((h) => h.includes('우승횟수'));
  if (nameCol < 0 || winCol < 0) return null;

  const counts = new Map<string, number>();
  for (let r = 1; r < grid.length; r++) {
    const name = normalizePlayerName(text((grid[r] ?? [])[nameCol]));
    if (!name) continue;
    const n = Number(text((grid[r] ?? [])[winCol]));
    counts.set(name, Number.isFinite(n) ? n : 0);
  }
  return counts;
}

// ── 안쪽 도우미 ────────────────────────────────────────────────────────────

// 이름에 키워드가 들어간 시트를 고른다. 없으면 던진다 —
// 첫 시트로 대충 넘어가면 rawdata 시트를 우승 시트로 읽어 엉뚱한 걸 적재한다.
function pickSheet(wb: XLSX.WorkBook, keyword: string): string {
  const found = wb.SheetNames.find((n) => n.replace(/\s+/g, '').includes(keyword));
  if (!found) {
    throw new Error(
      `'${keyword}' 시트를 찾지 못했습니다. 이 파일의 시트: ${wb.SheetNames.join(', ')}`,
    );
  }
  return found;
}

// 순서를 지키면서 중복만 없앤다. 같은 줄에 같은 이름이 두 번 적힌 경우 대비
// (Set 으로 한 번에 만들고 배열로 되돌려도 되지만, 순서 보장을 코드로 드러내려고 이렇게 쓴다).
function uniqueInOrder(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of names) {
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

// 셀 → 문자열 (null/undefined 는 빈 문자열).
function text(cell: unknown): string {
  if (cell === null || cell === undefined) return '';
  return String(cell).trim();
}
