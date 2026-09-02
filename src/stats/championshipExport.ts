/**
 * [신설: 2026-09-02 김병현 작성]
 *
 * 우승 기록 → "엑셀 시트 격자(2차원 배열)"로 되돌리는 순수 모듈.
 *
 * 하는 일은 모양 바꾸기 하나뿐이다. DB도 엑셀 라이브러리도 안 건드린다
 * (그건 export.service.ts 몫). rawExport.ts 와 같은 결이다.
 *
 * 시트를 두 장 만든다 — 원본 rawdata.xlsx 에 있던 두 장을 그대로 되돌리는 모양이다.
 *   '우승'     : 연도 헤더줄 + (시즌 | 팀명 | 멤버들…) — 사람이 보던 원본 표
 *   '우승횟수' : 선수명 | 우승횟수 — 원본 '선수명' 시트의 우승횟수 칸만 뽑은 표
 *
 * ⚠ 우리 DB는 '한 줄 = 선수 한 명의 우승'이라 팀 명단이라는 게 따로 없다.
 *   '우승' 시트는 같은 대회 줄들을 도로 묶어서 만든다(저장 모양과 보기 모양이 다른 지점).
 */
import { ChampionshipWinView, PlayerWins, RawDataCell } from './types';

// 시트 이름. '우승'/'우승횟수' 는 원본 파일의 시트 이름을 그대로 베낀 것이다.
export const CHAMPIONSHIP_SHEET_TITLES = '우승';
export const CHAMPIONSHIP_SHEET_COUNTS = '우승횟수';

// '우승횟수' 시트의 헤더. 원본 '선수명' 시트의 칸 이름을 그대로 쓴다.
const COUNT_HEADERS = ['선수명', '우승횟수'];

/**
 * '우승' 시트 격자.
 *
 * 원본 모양(연도가 바뀔 때만 헤더줄이 끼어든다):
 *   2023년
 *   시즌1 | 박연진팀 | 전성식 | 한승혁 | …
 *   시즌2 | 단백질팀 | 이희찬 | 이호연 | …
 *   2024년
 *   시즌1 | 종이알렌 | …
 *
 * 첫 칸은 시즌번호가 있으면 '시즌3', 없으면 대회명('나이배')이다
 * — 원본엔 시즌번호 있는 대회만 있었지만, 우리 DB는 둘 다 가능해서 둘 다 담는다.
 */
export function toTitlesGrid(wins: ChampionshipWinView[]): RawDataCell[][] {
  const grid: RawDataCell[][] = [];
  let lastYear: number | null = null;

  for (const group of groupByCompetition(wins)) {
    // 연도가 바뀌는 순간에만 '2023년' 줄을 끼운다(원본과 같은 모양).
    if (group.year !== lastYear) {
      grid.push([`${group.year}년`]);
      lastYear = group.year;
    }
    const seasonCell =
      group.seasonNo != null ? `시즌${group.seasonNo}` : group.competitionName;
    grid.push([seasonCell, group.teamName, ...group.players]);
  }

  return grid;
}

// '우승횟수' 시트 격자. 헤더 한 줄 + (선수명, 횟수) 줄들.
// 정렬은 손대지 않는다 — 넘겨받은 순서(countWinsByPlayer 가 만든 '많이 우승한 순')가
// 곧 화면에 보이는 순서라, 파일과 화면이 같은 순서여야 대조하기 쉽다.
export function toCountsGrid(playerWins: PlayerWins[]): RawDataCell[][] {
  return [COUNT_HEADERS, ...playerWins.map((p) => [p.player, p.wins])];
}

// 파일 이름. 날짜를 붙여 여러 번 받아도 다운로드 폴더에서 안 덮어쓴다(rawExport 와 같은 규칙).
export function championshipFileName(stamp: string): string {
  return `championships_${stamp}.xlsx`;
}

// ── 안쪽 ──────────────────────────────────────────────────────────────────

// 한 대회의 우승자들을 도로 묶은 모양('우승' 시트 한 줄에 대응).
interface CompetitionGroup {
  year: number;
  seasonNo: number | null;
  competitionName: string;
  teamName: string;
  players: string[];
}

// 우승 줄들 → 대회별 묶음. 연도 오름차순 → 시즌번호 오름차순(번호 없는 대회는 맨 뒤).
// 원본 파일이 옛날 → 최근 순이라 그 순서를 따른다(화면은 최근 순이지만 파일은 원본 결을 지킨다).
function groupByCompetition(wins: ChampionshipWinView[]): CompetitionGroup[] {
  const groups = new Map<number, ChampionshipWinView[]>();
  for (const w of wins) {
    const bucket = groups.get(w.competitionId);
    if (bucket) bucket.push(w);
    else groups.set(w.competitionId, [w]);
  }

  return [...groups.values()]
    .map((rows) => ({
      year: rows[0].year,
      seasonNo: rows[0].seasonNo,
      competitionName: rows[0].competitionName,
      teamName: dominantTeamName(rows),
      // 멤버는 가나다순. DB 순서에 기대면 같은 데이터로 파일이 매번 달라 보인다.
      players: rows.map((r) => r.player).sort((a, b) => a.localeCompare(b, 'ko')),
    }))
    .sort(
      (a, b) =>
        a.year - b.year ||
        seasonRank(a.seasonNo) - seasonRank(b.seasonNo) ||
        a.competitionName.localeCompare(b.competitionName, 'ko'),
    );
}

// 시즌번호 정렬용 순위. null(번호 없는 대회)은 맨 뒤로 보낸다.
// Infinity 를 쓰는 이유: 어떤 실제 시즌번호보다도 크다는 걸 비교식 하나로 표현하려고.
function seasonRank(seasonNo: number | null): number {
  return seasonNo ?? Number.POSITIVE_INFINITY;
}

// 그 대회의 대표 팀 이름 = 줄들에 가장 많이 나온 이름.
//
// 왜 '가장 많이'인가: 저장은 선수마다 하고 팀 이름은 그 선수가 그때 가장 많이 뛴 팀이라,
// 이론상 한 대회 안에서 서로 다른 팀 이름이 섞일 수 있다(우승 확정 뒤에 경기 기록을 고친 경우 등).
// 그럴 때 아무거나 집으면 파일이 매번 달라진다. 다수결로 정하고, 동률이면 가나다순 첫 번째로
// 못박아 **같은 데이터면 항상 같은 파일**이 나오게 한다.
function dominantTeamName(rows: ChampionshipWinView[]): string {
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.teamName, (counts.get(r.teamName) ?? 0) + 1);
  return [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko'),
  )[0][0];
}
