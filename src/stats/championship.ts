/**
 * [신설: 2026-09-02 김병현 작성]
 *
 * 우승 기록에 필요한 "계산"만 모아둔 순수 모듈. DB도 엑셀도 안 건드린다.
 *
 * 여기 있는 두 계산은 성격이 정반대다.
 *   playerTeamUsage   — 경기 기록에서 뽑는다. "이 대회에서 누가 어느 팀으로 몇 경기 뛰었나"
 *   countWinsByPlayer — 우승 기록에서 뽑는다. "지금까지 누가 몇 번 우승했나"
 * 둘 다 배열 넣고 배열 받는 함수라 DB 없이 그대로 돌려볼 수 있다.
 *
 * ⚠ playerTeamUsage 에 넣는 이벤트는 반드시 **연장 병합본**이어야 한다
 *   (stats.service.ts 의 mergedEvents — mergeOvertimeGames 를 거친 뷰).
 *   연장전은 화면에 별도 경기로 보이지만 스탯상으로는 앞 경기에 붙는다. 원본 뷰를 넣으면
 *   "8경기 중 7경기" 가 "10경기 중 9경기" 처럼 사람 감각과 어긋난 숫자로 나온다.
 */
import { gameKey } from './aggregate';
import { StatEvent } from './types';
import { PlayerTeamUsage, PlayerWins, TeamGameCount, WinRecord } from './types';

// 한 대회의 이벤트 → 선수별 "어느 팀으로 몇 경기 뛰었나".
//
// 경기 수는 이벤트 수가 아니라 **경기 개수**다. 한 경기에서 스탯을 20개 찍어도 1경기다.
// 그래서 Set<gameKey> 로 센다 (aggregate.listPlayers 가 쓰는 것과 같은 방식).
//
// 정렬:
//  - 팀 목록: 많이 뛴 순 → 그래서 teams[0] 이 곧 "가장 많이 뛴 팀"이다.
//             동률이면 팀 이름 가나다순(로케일 'ko' 명시 — 서버 환경에 따라 한글 순서가 흔들리지 않게).
//  - 선수 목록: 출전 경기 많은 순 → 이름순. 주전이 위로 올라오고 몇 경기만 뛴 용병이 아래로
//             내려가서, 화면에서 [+] 를 누를 사람을 위에서부터 훑기만 하면 된다.
export function playerTeamUsage(events: StatEvent[]): PlayerTeamUsage[] {
  // 선수 → (팀 → 그 팀으로 뛴 경기 집합) + 그 선수가 뛴 전체 경기 집합
  const byPlayer = new Map<
    string,
    { allGames: Set<string>; byTeam: Map<string, Set<string>> }
  >();

  for (const e of events) {
    let agg = byPlayer.get(e.player);
    if (!agg) {
      agg = { allGames: new Set(), byTeam: new Map() };
      byPlayer.set(e.player, agg);
    }
    const gk = gameKey(e);
    agg.allGames.add(gk);
    let teamGames = agg.byTeam.get(e.team);
    if (!teamGames) {
      teamGames = new Set();
      agg.byTeam.set(e.team, teamGames);
    }
    teamGames.add(gk);
  }

  return [...byPlayer.entries()]
    .map(([player, agg]) => {
      const teams: TeamGameCount[] = [...agg.byTeam.entries()]
        .map(([team, games]) => ({ team, games: games.size }))
        .sort((a, b) => b.games - a.games || a.team.localeCompare(b.team, 'ko'));
      return { player, totalGames: agg.allGames.size, teams };
    })
    .sort(
      (a, b) => b.totalGames - a.totalGames || a.player.localeCompare(b.player, 'ko'),
    );
}

// 우승 기록들 → 선수별 통산 우승횟수.
//
// 입력을 ChampionshipWin 행 전체가 아니라 {player, title} 두 칸만 받는 이유:
// 이 계산에 필요한 게 그 둘뿐이라서다. 좁은 입구여야 테스트에서 가짜 데이터를 한 줄로 만든다
// (rawExport.ts 의 CompetitionMeta 가 같은 이유로 세 칸만 받는다).
//
// titles 를 같이 돌려주는 이유: 화면에서 "5회" 옆에 어느 시즌들인지 바로 보여줄 수 있고,
// 숫자가 이상할 때 근거를 눈으로 확인할 수 있다(횟수만 주면 "왜 5지?"를 되물을 방법이 없다).
//
// [변경: 2026-09-02 김병현 수정] allPlayers 추가 — **우승이 한 번도 없는 선수까지 0회로 넣는다.**
//
// 왜 필요한가: 우승 줄만 세면 우승자만 나온다. 그럼 "내 이름이 왜 없지?"가 되고,
// 0회인지 명단에서 빠진 건지 구분이 안 된다. 0 을 명시적으로 보여주는 게 정직하다.
// (원본 rawdata.xlsx 의 '선수명' 시트도 우승 0회 선수까지 전부 적혀 있다 — 그 결을 따른다.)
//
// seasonsByPlayer 는 한 인자로 두 가지 일을 한다 — 일부러 그렇게 뒀다.
//   키(선수 이름) = 아는 선수 전원 → 우승 0회 선수를 0으로 깔아 두는 명단
//   값(시즌 수)   = 승률의 분모
// 두 값이 애초에 같은 조회 하나에서 나오기 때문이다(store.listPlayerSeasonCounts).
// 따로 받으면 "명단엔 있는데 시즌 수엔 없는 사람"이라는, 있을 수 없는 상태를 다뤄야 한다.
//
// 안 주면 옛 동작 그대로(우승자만, seasons 0, winRate null). 명단을 못 구했을 때 "0회 선수가
// 없다"거나 "승률 0%"라고 지어내지 않으려는 것이다 — 빈 Map 과 안 줌(undefined)은 뜻이 다르다.
export function countWinsByPlayer(
  records: WinRecord[],
  seasonsByPlayer?: ReadonlyMap<string, number>,
): PlayerWins[] {
  const map = new Map<string, string[]>();
  // 명단을 먼저 0회로 깔아 둔다. 그 다음 우승 줄을 얹으면 우승자는 자연스럽게 채워진다.
  // (반대 순서로 하면 이미 채운 선수를 다시 0으로 덮어쓰지 않게 조건을 하나 더 써야 한다.)
  for (const p of seasonsByPlayer?.keys() ?? []) if (!map.has(p)) map.set(p, []);
  for (const r of records) {
    const titles = map.get(r.player);
    if (titles) titles.push(r.title);
    else map.set(r.player, [r.title]);
  }
  return [...map.entries()]
    .map(([player, titles]) => {
      const wins = titles.length;
      const seasons = seasonsByPlayer?.get(player) ?? 0;
      return { player, wins, titles, seasons, winRate: winRateOf(wins, seasons) };
    })
    // 많이 우승한 순 → 이름순. 표를 그대로 순위처럼 읽을 수 있게.
    // 0회 선수들은 자연히 맨 아래에 가나다순으로 모인다.
    // (승률로 정렬하지 않는 이유: 1시즌 뛰고 1번 우승한 사람이 100% 로 맨 위에 오면
    //  '통산 우승 순위'라는 이름과 어긋난다. 승률은 옆에 붙는 참고값이다.)
    .sort((a, b) => b.wins - a.wins || a.player.localeCompare(b.player, 'ko'));
}

// 우승 승률(%) = 우승 횟수 ÷ 뛴 시즌 수. 소수 첫째 자리까지.
//
// 시즌 수가 0이면 0% 가 아니라 **null(= 모름)** 이다. 0으로 나눌 수 없기도 하지만,
// 뜻이 다르다: "10시즌 뛰고 한 번도 못 이김"(0%)과 "잰 적이 없음"(null)은 같은 말이 아니다.
// 실제로 이 상황은 선수 명단을 못 구했을 때만 생긴다.
function winRateOf(wins: number, seasons: number): number | null {
  if (seasons <= 0) return null;
  return Math.round((wins / seasons) * 1000) / 10;
}
