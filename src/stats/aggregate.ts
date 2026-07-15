import { computeBoxScore, pointsForStat } from './scoring';
import {
  BoxScore,
  BoxScoreView,
  GameSummary,
  PlayerLine,
  StatEvent,
} from './types';

// ── 순수 집계 함수 모음 ──────────────────────────────────────────────
// StatEvent[] 만 입력받아 파생 스탯을 계산한다. DB/프레임워크에 의존하지 않아
// 그대로 테스트하거나 정적 빌드에서 재사용할 수 있다.
//
// [변경: 2026-07-14 17:32, 김병현 수정] 대회 모델 대개편 — 이 파일은 이제 competitionLabel 을
// '불투명 문자열'로만 다룬다(그대로 출력만 함). 그룹핑/식별자는 competitionId(숫자, FK)로 하고,
// 라벨을 어떻게 만드는지는 전혀 모른다 — 그 규칙은 competition.service.competitionLabel() 한 곳에만 있다.
// 이렇게 분리하면 대회 표기 규칙이 바뀌어도 집계 로직은 안 건드려도 된다.

// 경기 그룹핑 키 (대회id|주차|경기). 널 문자로 구분해 충돌을 피한다.
function gameKey(e: Pick<StatEvent, 'competitionId' | 'week' | 'game'>): string {
  return `${e.competitionId} ${e.week} ${e.game}`;
}

// URL-safe 경기 식별자 (한글은 유지)
// [변경: 2026-07-14 17:32, 김병현 수정] 대회 문자열 대신 competitionId(FK, 숫자)를 직접 사용하도록 변경.
// 대회명이 바뀌어도 id 가 안 바뀌게 하려는 목적 — slug(대회명) 대신 안정적인 숫자 키를 쓴다.
export function gameId(competitionId: number, week: number, game: number): string {
  return `c${competitionId}_w${week}_g${game}`;
}

// 옛 gameId 가 slug(season) 로 문자열을 다듬어 id 에 넣던 시절의 헬퍼. 지금은 gameId 가
// competitionId 를 직접 쓰므로 미사용이지만, 주석/코드 삭제 금지 규칙에 따라 그대로 남겨둔다.
function slug(s: string): string {
  return String(s)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
}

// 성공/시도로 성공률(%) 계산 — 시도가 0이면 null, 있으면 소수 첫째자리 반올림
function pct(makes: number, atts: number): number | null {
  if (atts <= 0) return null;
  return Math.round((makes / atts) * 1000) / 10;
}

// [변경: 2026-07-15 11:37, 김병현 수정] 경기당 평균(소수1자리) 단일 출처 헬퍼.
// leaderboard()·listPlayers() 가 공통으로 쓴다. 반올림 규칙을 한 곳에 가둔다.
// 주의: 프론트 lib/format.ts 의 perGameAvg 와 반올림 표현식을 반드시 같게 유지할 것(같은 선수 값이 화면마다 갈리지 않게).
export function perGameAvg(total: number, games: number): number {
  return games > 0 ? Math.round((total / games) * 10) / 10 : 0;
}

// 박스스코어에 야투율 등 비율을 붙인다.
export function withPct(box: BoxScore): BoxScoreView {
  return {
    ...box,
    fgPct: pct(box.fgm, box.fga),
    fg2Pct: pct(box.fg2m, box.fg2a),
    fg3Pct: pct(box.fg3m, box.fg3a),
    ftPct: pct(box.ftm, box.fta),
  };
}

// 한 팀의 총득점 (이벤트 득점 합)
function teamScore(events: StatEvent[]): number {
  return events.reduce((sum, e) => sum + pointsForStat(e.stat), 0);
}

// 대회|주차|경기 단위로 이벤트를 묶는다.
function groupGames(events: StatEvent[]): Map<string, StatEvent[]> {
  const map = new Map<string, StatEvent[]>();
  for (const e of events) {
    const k = gameKey(e);
    const arr = map.get(k);
    if (arr) arr.push(e);
    else map.set(k, [e]);
  }
  return map;
}

// 경기 하나의 팀별 점수/승자를 계산
function gameTeams(gameEvents: StatEvent[]): {
  teams: { team: string; score: number }[];
  winner: string | null;
} {
  const byTeam = new Map<string, StatEvent[]>();
  for (const e of gameEvents) {
    const arr = byTeam.get(e.team);
    if (arr) arr.push(e);
    else byTeam.set(e.team, [e]);
  }
  const teams = [...byTeam.entries()]
    .map(([team, evs]) => ({ team, score: teamScore(evs) }))
    .sort((a, b) => b.score - a.score);

  let winner: string | null = null;
  if (teams.length >= 2 && teams[0].score !== teams[1].score) {
    winner = teams[0].team;
  } else if (teams.length === 1) {
    winner = teams[0].team;
  }
  return { teams, winner };
}

// 경기 정렬 기준: 대회 → 주차 → 경기
// [변경: 2026-07-14 17:32, 김병현 수정] 정렬 키가 응답 필드 competition(=라벨 문자열)으로 바뀜에 따라
// 제네릭 제약도 { competition: string; week; game } 로 맞춘다.
function sortByGame<T extends { competition: string; week: number; game: number }>(
  a: T,
  b: T,
): number {
  return (
    a.competition.localeCompare(b.competition) || a.week - b.week || a.game - b.game
  );
}

// ── 공개 집계 API ────────────────────────────────────────────────────

// 전체 경기 목록 (팀 점수/승패 요약)
export function listGames(events: StatEvent[]): GameSummary[] {
  const games = groupGames(events);
  const out: GameSummary[] = [];
  for (const evs of games.values()) {
    // [변경: 2026-07-14 17:32, 김병현 수정] season(문자열) → competitionId+competitionLabel.
    // id 는 competitionId 로, 화면에 보이는 competition 필드엔 competitionLabel(불투명 문자열)을 담는다.
    const { competitionId, competitionLabel, week, game } = evs[0];
    const { teams, winner } = gameTeams(evs);
    out.push({
      id: gameId(competitionId, week, game),
      competition: competitionLabel,
      week,
      game,
      teams,
      winner,
      events: evs.length,
    });
  }
  return out.sort(sortByGame);
}

// 특정 경기의 박스스코어 (양 팀 · 선수별). 없으면 null.
export function boxScoreForGame(
  events: StatEvent[],
  id: string,
): {
  id: string;
  competition: string;
  week: number;
  game: number;
  winner: string | null;
  teams: { team: string; score: number; players: PlayerLine[] }[];
} | null {
  const games = groupGames(events);
  for (const evs of games.values()) {
    // [변경: 2026-07-14 17:32, 김병현 수정] season(문자열) → competitionId+competitionLabel.
    const { competitionId, competitionLabel, week, game } = evs[0];
    if (gameId(competitionId, week, game) !== id) continue;

    // 팀별 → 선수별로 다시 그룹핑
    const byTeam = new Map<string, StatEvent[]>();
    for (const e of evs) {
      const arr = byTeam.get(e.team);
      if (arr) arr.push(e);
      else byTeam.set(e.team, [e]);
    }

    const teams = [...byTeam.entries()].map(([team, teamEvents]) => {
      const byPlayer = new Map<string, StatEvent[]>();
      for (const e of teamEvents) {
        const arr = byPlayer.get(e.player);
        if (arr) arr.push(e);
        else byPlayer.set(e.player, [e]);
      }
      const players: PlayerLine[] = [...byPlayer.entries()]
        .map(([player, pe]) => ({
          player,
          team,
          ...withPct(computeBoxScore(pe)),
        }))
        .sort((a, b) => b.pts - a.pts);
      return { team, score: teamScore(teamEvents), players };
    });
    teams.sort((a, b) => b.score - a.score);

    const winner =
      teams.length >= 2 && teams[0].score !== teams[1].score
        ? teams[0].team
        : null;

    return { id, competition: competitionLabel, week, game, winner, teams };
  }
  return null;
}

// 선수 목록 (출전 경기 수·누적 득점 요약)
// [변경: 2026-07-15 11:37, 김병현 수정] 경기당 득점(ppg) 필드 추가 — 목록의 메인 지표로 승격.
export function listPlayers(events: StatEvent[]): {
  player: string;
  teams: string[];
  games: number;
  pts: number;
  ppg: number;
}[] {
  const map = new Map<
    string,
    { teams: Set<string>; games: Set<string>; pts: number }
  >();
  for (const e of events) {
    let agg = map.get(e.player);
    if (!agg) {
      agg = { teams: new Set(), games: new Set(), pts: 0 };
      map.set(e.player, agg);
    }
    agg.teams.add(e.team);
    agg.games.add(gameKey(e));
    agg.pts += pointsForStat(e.stat);
  }
  return [...map.entries()]
    .map(([player, a]) => ({
      player,
      teams: [...a.teams],
      games: a.games.size,
      pts: a.pts,
      // [변경: 2026-07-15 11:37, 김병현 수정] 경기당 득점 계산(공통 헬퍼).
      ppg: perGameAvg(a.pts, a.games.size),
    }))
    // [변경: 2026-07-15 11:37, 김병현 수정] 정렬을 경기당 득점 우선으로. 동률이면 누적 → 이름순.
    .sort((a, b) => b.ppg - a.ppg || b.pts - a.pts || a.player.localeCompare(b.player));
}

// 한 선수의 누적 스탯 + 경기별 추이
export function playerDetail(
  events: StatEvent[],
  name: string,
): {
  player: string;
  totals: BoxScoreView;
  games: (PlayerLine & {
    id: string;
    competition: string;
    week: number;
    game: number;
    opponent: string | null;
    teamScore: number;
    opponentScore: number | null;
    result: 'W' | 'L' | 'D';
  })[];
} | null {
  const mine = events.filter((e) => e.player === name);
  if (mine.length === 0) return null;

  const totals = withPct(computeBoxScore(mine));

  // 이 선수가 뛴 경기별로 집계
  const byGame = groupGames(mine);
  const allGames = groupGames(events); // 상대 점수 계산용(전체 이벤트 기준)

  const games = [...byGame.entries()].map(([key, myGameEvents]) => {
    // [변경: 2026-07-14 17:32, 김병현 수정] season(문자열) → competitionId+competitionLabel.
    const { competitionId, competitionLabel, week, game, team } = myGameEvents[0];
    const line: PlayerLine = {
      player: name,
      team,
      ...withPct(computeBoxScore(myGameEvents)),
    };

    // 같은 경기의 전체 이벤트로 우리팀/상대팀 점수 계산
    const full = allGames.get(key) ?? myGameEvents;
    const scores = new Map<string, number>();
    for (const e of full) {
      scores.set(e.team, (scores.get(e.team) ?? 0) + pointsForStat(e.stat));
    }
    const myScore = scores.get(team) ?? 0;
    const opponents = [...scores.entries()].filter(([t]) => t !== team);
    const opponent = opponents.length > 0 ? opponents[0][0] : null;
    const opponentScore = opponents.length > 0 ? opponents[0][1] : null;

    let result: 'W' | 'L' | 'D' = 'D';
    if (opponentScore !== null) {
      result = myScore > opponentScore ? 'W' : myScore < opponentScore ? 'L' : 'D';
    }

    return {
      ...line,
      id: gameId(competitionId, week, game),
      competition: competitionLabel,
      week,
      game,
      opponent,
      teamScore: myScore,
      opponentScore,
      result,
    };
  });

  games.sort(sortByGame);
  return { player: name, totals, games };
}

// 리더보드에서 정렬 가능한 스탯 지표
export const LEADERBOARD_METRICS = [
  'pts',
  'reb',
  'oreb',
  'dreb',
  'ast',
  'stl',
  'blk',
  'tov',
  'fgm',
  'fg2m',
  'fg3m',
  'ftm',
  'andOne',
] as const;
export type LeaderboardMetric = (typeof LEADERBOARD_METRICS)[number];

// 특정 지표 기준 리더보드 (누적값 + 경기당 평균)
// [변경: 2026-07-14 17:49, 김병현 수정] limit 선택적으로 변경 — 생략하거나 0 이하면 상위 제한 없이 전체 반환.
export function leaderboard(
  events: StatEvent[],
  metric: LeaderboardMetric,
  limit?: number,
): { rank: number; player: string; games: number; total: number; perGame: number }[] {
  const byPlayer = new Map<string, StatEvent[]>();
  const gamesOf = new Map<string, Set<string>>();
  for (const e of events) {
    const arr = byPlayer.get(e.player);
    if (arr) arr.push(e);
    else byPlayer.set(e.player, [e]);
    let g = gamesOf.get(e.player);
    if (!g) {
      g = new Set();
      gamesOf.set(e.player, g);
    }
    g.add(gameKey(e));
  }

  return [...byPlayer.entries()]
    .map(([player, evs]) => {
      const box = computeBoxScore(evs);
      const games = gamesOf.get(player)?.size ?? 0;
      const total = box[metric];
      return {
        player,
        games,
        total,
        // [변경: 2026-07-15 11:37, 김병현 수정] 인라인 계산 → 공통 헬퍼 perGameAvg 호출로 변경.
        perGame: perGameAvg(total, games),
      };
    })
    // [변경: 2026-07-15 11:37, 김병현 수정] 정렬을 경기당 평균 우선으로. 동률이면 누적 → 이름순.
    .sort((a, b) => b.perGame - a.perGame || b.total - a.total || a.player.localeCompare(b.player))
    // [변경: 2026-07-14 17:49, 김병현 수정] limit 양수일 때만 상위 N개로 자르고, 그 외엔 전체 유지.
    .slice(0, limit && limit > 0 ? limit : undefined)
    .map((row, i) => ({ rank: i + 1, ...row }));
}

// 전체 데이터 요약 (규모 + 코드 사용 히스토그램)
export function summary(events: StatEvent[]): {
  seasons: number;
  games: number;
  players: number;
  events: number;
  byStat: Record<string, number>;
} {
  // [변경: 2026-07-14 17:32, 김병현 수정] 대회 카운트 기준을 competitionId(FK, 숫자)로 바꿈.
  // (응답 필드명 seasons 는 계약 범위 밖이라 그대로 유지 — GET /summary 응답 형태 불변.)
  const seasons = new Set<string>();
  const games = new Set<string>();
  const players = new Set<string>();
  const byStat: Record<string, number> = {};
  for (const e of events) {
    seasons.add(String(e.competitionId));
    games.add(gameKey(e));
    players.add(e.player);
    byStat[e.stat] = (byStat[e.stat] ?? 0) + 1;
  }
  return {
    seasons: seasons.size,
    games: games.size,
    players: players.size,
    events: events.length,
    byStat,
  };
}
