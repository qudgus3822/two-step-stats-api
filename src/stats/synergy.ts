// [신설: 2026-07-27 16:14, 김병현 작성] 시너지(Synergy) 탭 — "기준 선수가 이 동료와 같이 뛰면
// 얼마나 좋아지나"를 계산하는 순수 집계 모듈.
//
// 이 파일이 숨기는 것:
//  - 팀-경기 판정(같은 경기 + 같은 팀이어야 "같이 뛴 것" — 상대팀은 절대 아님)
//  - 함께/따로 두 덩이로 나눠 각각 경기당 평균을 내는 계산 + 이중 반올림(부동소수 먼지 제거)
//  - 표본 자격(함께 ≥3경기, 따로 ≥1경기) 판정
//  - 지표별 "좋아짐" 방향(턴오버만 반대)
//  - 정렬·랭킹(자격자 먼저 → 델타 → 함께 경기 수 → 이름)
// 호출하는 쪽은 이벤트 배열 + 기준 선수 이름 + 지표 하나만 넘기면 된다.
import { computeBoxScore } from './scoring';
import { efficiency, gameKey, perGameAvg } from './aggregate';
import type { LeaderboardMetric } from './aggregate';
import { BoxScore, StatEvent } from './types';

// 시너지에서 비교할 지표 7종. 전부 "경기당 평균"으로 다룰 수 있는 카운트 계열만 넣는다.
// as const satisfies … → 리더보드 지표의 부분집합임을 컴파일러가 보증한다.
// (그래야 프론트가 METRIC_LABELS 를 그대로 재사용할 수 있다.)
// ⚠ 아래 한 줄은 반드시 **한 줄**로 쓴다. `as` / `satisfies` 앞에서 줄을 바꾸면
//   자동 세미콜론 삽입(ASI) 때문에 TS1434 로 컴파일이 죽는다.
export const SYNERGY_METRICS = ['eff', 'pts', 'reb', 'ast', 'stl', 'blk', 'tov'] as const satisfies readonly LeaderboardMetric[];
export type SynergyMetric = (typeof SYNERGY_METRICS)[number];

// 박스스코어에서 원시 값을 꺼내는 표. eff 는 aggregate 의 단일 출처(efficiency)를 재사용한다
// (EFF 공식을 이 파일에 다시 쓰지 않는다 — 두 곳에 적으면 언젠가 어긋난다).
const RAW: Record<SynergyMetric, (b: BoxScore) => number> = {
  eff: (b) => efficiency(b),
  pts: (b) => b.pts,
  reb: (b) => b.reb,
  ast: (b) => b.ast,
  stl: (b) => b.stl,
  blk: (b) => b.blk,
  tov: (b) => b.tov,
};

// 지표별 "좋아짐"의 방향. 턴오버만 낮을수록 좋다.
// 정렬 방향과 화면 색을 이 표 하나로 결정하고, 응답에도 실어 보낸다(프론트가 'tov' 를 하드코딩 안 하게).
export const BETTER_WHEN: Record<SynergyMetric, 'higher' | 'lower'> = {
  eff: 'higher',
  pts: 'higher',
  reb: 'higher',
  ast: 'higher',
  stl: 'higher',
  blk: 'higher',
  tov: 'lower',
};

// 표본 자격. 함께 3경기 미만이면 한 경기 운으로 뒤집히고, 따로 0경기면 비교 기준선이 없다.
export const MIN_TOGETHER_GAMES = 3;
export const MIN_APART_GAMES = 1;

export interface SynergySplit {
  together: number; // 같이 뛴 경기의 경기당 평균(소수1)
  apart: number | null; // 따로 뛴 경기의 경기당 평균. 따로 뛴 경기가 없으면 null
  delta: number | null; // together − apart. apart 가 null 이면 null
}
export interface SynergyRow {
  rank: number | null; // 자격 행에만 1,2,3… / 미자격은 null
  teammate: string;
  togetherGames: number;
  apartGames: number; // 기준 선수는 뛰었지만 이 동료가 내 팀엔 없던 경기(상대팀이었던 경기 포함)
  qualified: boolean;
  value: number | null; // = metrics[metric].delta (정렬에 쓴 값)
  metrics: Record<SynergyMetric, SynergySplit>;
}
export interface SynergyReport {
  player: string;
  games: number; // 기준 선수가 기록을 남긴 경기 수
  metric: SynergyMetric; // 정렬에 쓴 지표
  betterWhen: Record<SynergyMetric, 'higher' | 'lower'>; // 화면 색·해석용
  minTogetherGames: number; // 화면 안내 문구용(상수 하드코딩 방지)
  minApartGames: number;
  overall: Record<SynergyMetric, number>; // 동료와 무관한 "평소" 경기당 평균
  rows: SynergyRow[];
}

// 경기 + 팀. 같은 경기라도 팀이 다르면 맞대결이라 시너지가 아니다.
// gameKey 형식(`대회id 주차 경기`)에 공백으로 팀명을 잇는다. 앞 세 토막이 전부 숫자라
// 팀 이름에 공백이 있어도 경계가 모호해지지 않는다.
// (aggregate.ts:19 의 "널 문자로 구분한다"는 옛 주석은 사실이 아니다 — 실제 구분자는 공백이다.
//  기존 주석은 규칙상 지우지 않고 여기 새 주석에 사실만 정정해 둔다.)
function unitKey(e: StatEvent): string {
  return `${gameKey(e)} ${e.team}`;
}

// 소수 1자리 반올림. 이미 반올림된 평균끼리 빼면 12.3-10.1=2.1999… 같은 먼지가 남아 한 번 더 턴다.
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// 박스스코어 하나 → 지표 7종의 경기당 평균.
// ⚠ Object.fromEntries 로 만들면 반환 타입이 { [k: string]: number } 라 TS2739 로 막힌다.
// reduce + 초기값 단언으로 간다.
function perGame(box: BoxScore, games: number): Record<SynergyMetric, number> {
  return SYNERGY_METRICS.reduce((acc, m) => {
    acc[m] = perGameAvg(RAW[m](box), games);
    return acc;
  }, {} as Record<SynergyMetric, number>);
}

// 기준 선수 하나의 동료별 WOWY(with-or-without-you) 리포트를 만든다.
// null 을 반환하지 않는다 — 기록 없는 이름이면 games:0, rows:[], overall 은 전 지표 0이 담긴 리포트를 준다
// (이름이 필터라서 "없음"도 정상 응답이다 — 404 로 다루지 않는다).
export function synergyReport(
  events: StatEvent[],
  name: string,
  metric: SynergyMetric,
): SynergyReport {
  const mine = events.filter((e) => e.player === name);
  const myGames = new Set(mine.map(gameKey));
  const myUnits = new Set(mine.map(unitKey));
  const games = myGames.size;
  const overall = perGame(computeBoxScore(mine), games);

  // 1) 동료 찾기: 내 (경기,팀) 유닛에 같이 들어 있는 남의 이벤트만 본다.
  //    같은 경기라도 상대팀이면 유닛이 달라 여기 안 걸린다(= 동료 목록에 안 나온다).
  const together = new Map<string, Set<string>>(); // 동료 → 함께 뛴 경기 키 집합
  for (const e of events) {
    if (e.player === name) continue;
    if (!myUnits.has(unitKey(e))) continue;
    let gameSet = together.get(e.player);
    if (!gameSet) {
      gameSet = new Set<string>();
      together.set(e.player, gameSet);
    }
    gameSet.add(gameKey(e));
  }

  // 2) 동료별로 내 이벤트를 함께/따로 두 덩이로 갈라 각각 집계한다.
  //    (경기 수가 수백 수준이라 필터 두 번이 가장 단순하고 안전하다 — 박스스코어 뺄셈 헬퍼를 새로 만들지 않는다.)
  const built = [...together.entries()].map(([teammate, gameSet]) => {
    const togetherGames = gameSet.size;
    const apartGames = games - togetherGames;
    const tBox = computeBoxScore(mine.filter((e) => gameSet.has(gameKey(e))));
    const aBox = computeBoxScore(mine.filter((e) => !gameSet.has(gameKey(e))));

    // 지표별 { together, apart, delta }.
    // 따로 뛴 경기가 0이면 perGameAvg 가 0을 주는데 그건 "따로 0.0" 이라는 거짓말이라
    // apart·delta 를 둘 다 null 로 내린다. delta 는 표시되는 값(반올림된 값)끼리 뺀 뒤 한 번 더 round1.
    // 변수명이 tAvg/aAvg 인 이유: 바깥의 together(동료→경기집합 Map)를 가리지(shadow) 않으려고.
    const metrics = SYNERGY_METRICS.reduce((acc, m) => {
      const tAvg = perGameAvg(RAW[m](tBox), togetherGames);
      const aAvg = apartGames > 0 ? perGameAvg(RAW[m](aBox), apartGames) : null;
      acc[m] = { together: tAvg, apart: aAvg, delta: aAvg == null ? null : round1(tAvg - aAvg) };
      return acc;
    }, {} as Record<SynergyMetric, SynergySplit>);

    const qualified = togetherGames >= MIN_TOGETHER_GAMES && apartGames >= MIN_APART_GAMES;
    return { teammate, togetherGames, apartGames, qualified, value: metrics[metric].delta, metrics };
  });

  // 3) 정렬: 자격자 먼저 → 델타(방향 반영) → 함께 경기 많은 순 → 이름.
  //    null 을 -Infinity 같은 걸로 바꿔치기해서 빼면 NaN 이 나오므로, 반드시 명시적으로 분기한다.
  const dir = BETTER_WHEN[metric] === 'higher' ? 1 : -1;
  built.sort((a, b) => {
    if (a.qualified !== b.qualified) return a.qualified ? -1 : 1;
    const av = a.value;
    const bv = b.value;
    if (av == null && bv != null) return 1; // 값 없는 행은 뒤로
    if (bv == null && av != null) return -1;
    if (av != null && bv != null && av !== bv) return dir * bv - dir * av;
    return b.togetherGames - a.togetherGames || a.teammate.localeCompare(b.teammate);
  });

  // 4) 랭크는 자격 행에만 매긴다. 미자격은 null(화면에 "—"로 뜬다).
  let r = 0;
  const rows: SynergyRow[] = built.map((x) => ({ rank: x.qualified ? ++r : null, ...x }));

  return {
    player: name,
    games,
    metric,
    betterWhen: BETTER_WHEN,
    minTogetherGames: MIN_TOGETHER_GAMES,
    minApartGames: MIN_APART_GAMES,
    overall,
    rows,
  };
}
