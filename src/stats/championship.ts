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
export function countWinsByPlayer(records: WinRecord[]): PlayerWins[] {
  const map = new Map<string, string[]>();
  for (const r of records) {
    const titles = map.get(r.player);
    if (titles) titles.push(r.title);
    else map.set(r.player, [r.title]);
  }
  return [...map.entries()]
    .map(([player, titles]) => ({ player, wins: titles.length, titles }))
    // 많이 우승한 순 → 이름순. 표를 그대로 순위처럼 읽을 수 있게.
    .sort((a, b) => b.wins - a.wins || a.player.localeCompare(b.player, 'ko'));
}
