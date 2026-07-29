// [신설: 2026-07-28 15:00, 김병현 작성] 기량 발전(Growth) 탭 — "이 시즌은 직전 시즌보다
// 얼마나 나아졌나"를 계산하는 순수 집계 모듈.
//
// 이 파일이 숨기는 것:
//  - 시간축 정렬(날짜 컬럼이 없는 데이터에서 "직전 시즌"을 결정적으로 정의)
//  - 시즌별 출전 경기 수 집계
//  - 경기당 평균 환산(누적 비교의 거짓말을 막음)
//  - 발전률 공식(방향 반영·절댓값 분모·0/작은 분모 처리)
//  - 표본 자격(두 시즌 모두 최소 경기)
//  - 정렬·랭킹
//  - 빠진 인원 세기(직전 시즌만 뛴 선수 수 / 기준값이 작아 %를 못 낸 선수 수)
// [변경: 2026-07-28 17:00, 김병현 수정] v3.1 — 성공률 2종(2점·3점) 추가로 숨기는 게 하나 늘었다:
//  - 지표 계열 분기(카운트=경기당 평균·상대증가율 / 성공률=시즌 누적 성공률·단순 차이)와
//    계열별 최소 시도 자격. 계열을 아는 곳은 이 파일 안 표 몇 개뿐이고, 호출자는 여전히 모른다.
// 호출하는 쪽은 이벤트 배열 + 대회 목록 + 대회id + 지표 4개만 넘기면 된다.
import { computeBoxScore } from './scoring';
import { efficiency, gameKey, perGameAvg, withPct } from './aggregate';
import type { LeaderboardMetric } from './aggregate';
import { BoxScore, StatEvent } from './types';

// ⚠ 아래 한 줄은 반드시 한 줄로. `as`/`satisfies` 앞에서 줄바꿈하면 ASI 때문에 TS1434 로 죽는다.
// synergy.ts 의 SYNERGY_METRICS 를 import 하지 않는다 — 지금 원소가 같은 건 우연이라
// 공유하면 한쪽이 지표를 늘릴 때 다른 쪽이 끌려간다(가짜 공유).
// [변경: 2026-07-28 17:00, 김병현 수정] v3.1 — 'fg2Pct','fg3Pct' 를 카운트 7종 뒤에 추가(결정 14).
// 기존 7개 순서는 안 흔든다. 백/프론트 배열 순서 일치 계약도 그대로 유지.
export const GROWTH_METRICS = ['eff', 'pts', 'reb', 'ast', 'stl', 'blk', 'tov', 'fg2Pct', 'fg3Pct'] as const satisfies readonly LeaderboardMetric[];
export type GrowthMetric = (typeof GROWTH_METRICS)[number];

// [신설: 2026-07-28 17:00, 김병현 작성] 지표 계열(결정 11). 같은 GrowthSplit.pct 필드에
// 카운트는 "상대 증가율(%)", 성공률은 "두 값의 차이(퍼센트포인트)"가 들어가는데, 단위가 갈리는 게
// 이 설계의 유일한 진짜 위험이라 betterWhen 과 같은 패턴으로 응답에 실어 보낸다.
//   'perGame' → prev/curr = 경기당 평균, pct = 상대 증가율(%) → 화면 표기 `+38.2%`
//   'rate'    → prev/curr = 시즌 누적 성공률(%), pct = 두 값의 차이(%p) → 화면 표기 `+10.0`(% 안 붙임)
export type GrowthKind = 'perGame' | 'rate';
// [변경: 2026-07-28 18:00, 김병현 수정] v3.1 구현 리뷰 D4 — export 를 뗀다. 파일 밖에서 쓰는
// 곳이 0건이었다(같은 파일의 결정 10 주석이 "공개 API 를 늘릴 값어치 없다"고 스스로 말한 원칙을
// 여기엔 안 지키고 있었다). 응답에는 `kinds: KINDS` 로 이미 실려 나간다 — 그게 진짜 공개 지점이다.
const KINDS: Record<GrowthMetric, GrowthKind> = {
  eff: 'perGame',
  pts: 'perGame',
  reb: 'perGame',
  ast: 'perGame',
  stl: 'perGame',
  blk: 'perGame',
  tov: 'perGame',
  fg2Pct: 'rate',
  fg3Pct: 'rate',
};

// 박스스코어에서 원시 값을 꺼내는 표. eff 는 aggregate 의 단일 출처(efficiency)를 재사용한다
// (EFF 공식을 이 파일에 다시 쓰지 않는다 — 두 곳에 적으면 언젠가 어긋난다).
// [변경: 2026-07-28 17:00, 김병현 수정] v3.1 — RAW(박스→원시값) 를 SEASON_VALUE(박스+경기수→
// "이 시즌 이 지표의 값") 로 개명하고 시그니처를 통일했다(결정 10). 카운트 7종은 여전히
// "경기당 평균"(perGameAvg 를 여기서 태운다 — RAW 시절엔 호출부가 태웠다). 성공률 2종은
// "시즌 누적 성공/시도"라 games 인자를 안 쓴다(경기당 평균이 아니다 — gotcha 31).
// null = 이 시즌엔 값 자체가 없다(성공률인데 시도가 0회) — withPct 가 이미 null 을 준다(gotcha 33).
// [변경: 2026-07-28 18:00, 김병현 수정] v3.1 구현 리뷰 D4 — export 를 뗀다(파일 밖 사용 0건).
const SEASON_VALUE: Record<GrowthMetric, (box: BoxScore, games: number) => number | null> = {
  eff: (b, g) => perGameAvg(efficiency(b), g),
  pts: (b, g) => perGameAvg(b.pts, g),
  reb: (b, g) => perGameAvg(b.reb, g),
  ast: (b, g) => perGameAvg(b.ast, g),
  stl: (b, g) => perGameAvg(b.stl, g),
  blk: (b, g) => perGameAvg(b.blk, g),
  tov: (b, g) => perGameAvg(b.tov, g),
  // [신설: 2026-07-28 17:00, 김병현 작성] withPct 가 성공률 4개를 다 계산하지만 우리는 2개만 쓴다 —
  // 호출 횟수가 "선수 × 시즌 2회"라 무시할 수 있는 낭비다. 반올림 규칙의 단일 출처(aggregate.ts 의
  // 비공개 pct())를 지키는 값이 그 낭비보다 크다(결정 10 — withPct 재사용을 택하고 export 를 안 늘림).
  fg2Pct: (b) => withPct(b).fg2Pct,
  fg3Pct: (b) => withPct(b).fg3Pct,
};

// 지표별 "좋아짐"의 방향. 턴오버만 낮을수록 좋다. 응답에도 실어 보낸다(프론트가 'tov' 를 안 외우게).
// [변경: 2026-07-28 18:00, 김병현 수정] v3.1 구현 리뷰 D4 — export 를 뗀다. 봉투의 `betterWhen`
// 필드로 이미 나가고 있어 이 상수 자체를 파일 밖에서 import 하는 곳은 없었다(synergy.ts 의
// 동명 상수는 별개 — 결정 7 이 이미 공유하지 않기로 정했다).
const BETTER_WHEN: Record<GrowthMetric, 'higher' | 'lower'> = {
  eff: 'higher',
  pts: 'higher',
  reb: 'higher',
  ast: 'higher',
  stl: 'higher',
  blk: 'higher',
  tov: 'lower',
  // [변경: 2026-07-28 17:00, 김병현 수정] v3.1 — 성공률 2종 추가. 둘 다 높을수록 좋다.
  fg2Pct: 'higher',
  fg3Pct: 'higher',
};

// % 를 낼 수 있는 최소 기준값(직전 경기당 평균의 절댓값). eff 만 켜져 있다.
// 왜 eff 만? eff 가 특별히 잘 튀어서가 아니라, eff 만 "단 하나뿐인 종합 순위"의 기준이라
// 튀었을 때 잃는 게 제일 크기 때문이다(경기당 0.3 → 1.3 이 +333% 로 1등이 되면 화면이 거짓말이 된다).
// 개별 지표는 그 탭 안에서만 비교되고 원시값이 옆 칸에 보여서 사용자가 스스로 판단할 수 있다.
// 나머지가 0인 건 사실상 꺼짐(Math.abs(prev) < 0 은 언제나 거짓). if 분기 대신 표로 둔 이유:
// "여기만 켜져 있다"를 코드가 스스로 말하게 하려고.
// ⚠ 하한은 공짜가 아니다 — 진짜로 크게 는 사람도 같이 뺀다. 그래서 tinyBaseCount 로 몇 명인지 세서
//    화면이 고지한다(숨기되 숨긴 걸 말한다).
// [변경: 2026-07-28 18:00, 김병현 수정] v3.1 구현 리뷰 D4 — export 를 뗀다(파일 밖 사용 0건).
const MIN_BASE: Record<GrowthMetric, number> = {
  eff: 1,
  pts: 0,
  reb: 0,
  ast: 0,
  stl: 0,
  blk: 0,
  tov: 0,
  // [신설: 2026-07-28 17:00, 김병현 작성] 성공률 2종 추가(결정 9). 나눗셈이 없어 작은 분모가
  // 폭주할 일이 없으므로 MIN_BASE 는 성공률에 안 건다 — splitOf 가 kind==='rate' 면 이 분기
  // 앞에서 바로 돌려주기 때문이다(AC 70). 타입이 모든 키를 요구해서 0을 넣지만, 이 0은
  // "꺼짐"이 아니라 **"해당 없음" 자리표시**다(ATTEMPT_GUARD 의 min:0 과 같은 뜻 — 같은 문장).
  fg2Pct: 0,
  fg3Pct: 0,
};

// 두 시즌 모두 이만큼은 뛰어야 순위에 넣는다. 1~2경기는 한 경기 운으로 뒤집힌다.
// [변경: 2026-07-28 18:00, 김병현 수정] v3.1 구현 리뷰 D4 — export 를 뗀다. 봉투의 `minGames`
// 필드로 이미 나가고 있어(안내 문구용) 상수 자체를 파일 밖에서 쓰는 곳은 없었다.
const MIN_GAMES = 3;

// [신설: 2026-07-28 17:00, 김병현 작성] "이 지표의 표본이 무엇이고, 얼마나 필요한가" 한 곳(결정 12).
// 카운트 7종은 attempts: () => 0, min: 0 → 0 >= 0 이라 항상 통과한다.
// ⚠ 이 0은 "꺼짐"이 아니라 **"해당 없음" 자리표시**다(MIN_BASE 의 0과 같은 뜻 — 같은 문장).
// 성공률 2종의 20/10 은 리더보드의 "경기당 1회" 규칙을 재사용하지 않고 고정 하한을 쓴 것이다 —
// 발전률은 시즌 누적 성공률끼리 비교하므로 표본도 누적 시도 수로 재는 게 결이 맞고(비교 단위 일치),
// 리더보드의 FG3_MIN_ATTEMPTS_PER_GAME 은 aggregate.ts 의 비공개 지역 상수라 재사용하려면
// export 를 늘려야 한다(결정 10과 같은 이유로 거부). 실데이터로 확인: 두 숫자 다 순위가 통째로
// 비지 않는다(fg3Pct 8명·fg2Pct 10명 통과, 결정 12).
// [변경: 2026-07-28 18:00, 김병현 수정] v3.1 구현 리뷰 D4 — export 를 뗀다(파일 밖 사용 0건).
// `minAttempts` 봉투 필드가 이 표에서 `min` 만 파생해 이미 밖으로 나가고 있다.
const ATTEMPT_GUARD: Record<GrowthMetric, { attempts: (b: BoxScore) => number; min: number }> = {
  eff: { attempts: () => 0, min: 0 },
  pts: { attempts: () => 0, min: 0 },
  reb: { attempts: () => 0, min: 0 },
  ast: { attempts: () => 0, min: 0 },
  stl: { attempts: () => 0, min: 0 },
  blk: { attempts: () => 0, min: 0 },
  tov: { attempts: () => 0, min: 0 },
  fg2Pct: { attempts: (b) => b.fg2a, min: 20 },
  fg3Pct: { attempts: (b) => b.fg3a, min: 10 },
};

// 봉투(GrowthReport.minAttempts)용 최소 시도 표. ATTEMPT_GUARD 에서 min 만 뽑아 파생시킨다 —
// 지표를 추가할 때 ATTEMPT_GUARD 한 곳만 고치면 여기도 자동으로 맞다(같은 값을 두 번 적지 않는다).
const MIN_ATTEMPTS: Record<GrowthMetric, number> = GROWTH_METRICS.reduce((acc, m) => {
  acc[m] = ATTEMPT_GUARD[m].min;
  return acc;
}, {} as Record<GrowthMetric, number>);

// % 가 없는 이유. 화면이 "왜 —인지"를 사람 말로 바꿔 보여준다.
// [변경: 2026-07-28 17:00, 김병현 수정] v3.1 — 'no-attempts' 추가(성공률인데 그 시즌 시도가 0회).
export type GrowthBasis = 'ok' | 'no-prev' | 'from-zero' | 'both-zero' | 'tiny-base' | 'no-attempts';

// [신설: 2026-07-28 17:00, 김병현 작성] 자격 미달 사유. 프론트가 규칙(경기 수/시도 수)을 다시
// 계산하지 않게 서버가 알려 준다. qualified 는 이 값에서 **파생**된다(growthReport 본문 참고) —
// "항상 같아야 하는 필드 두 개"를 따로 계산하지 않는다(결정 11 이 세운 원칙을 여기서도 지킨다).
export type GrowthUnqualified = 'none' | 'games' | 'attempts' | 'both';

// growthReport 의 입력용 대회 구조 타입. competition.service.ts 를 import 하지 않는다
// (순수 모듈이 Nest/Prisma 쪽을 안 보게 하려고). CompetitionRow 가 구조적으로 대입 가능하므로
// 서비스는 실제 Competition 행을 그대로 넘기면 된다.
export interface GrowthCompetition {
  id: number;
  year: number;
  seasonNo: number | null;
  label: string;
  createdAt: Date;
}

// 비교에 쓴 시즌 한쪽의 신원.
export interface GrowthSeason {
  competitionId: number;
  label: string; // 표시 라벨(=Competition.label). 프론트가 라벨 규칙을 다시 만들지 않게 서버가 준다.
  games: number; // 그 시즌에 기록이 남은 경기 수
}

// 지표 하나의 직전/이번/발전률.
export interface GrowthSplit {
  prev: number | null; // 직전 시즌 경기당 평균. 직전에 안 뛰었으면 null(0이 아니다)
  // [변경: 2026-07-28 17:00, 김병현 수정] v3.1 — number 에서 number|null 로 바뀐다.
  // 성공률인데 이번 시즌 시도가 0회면 curr 도 값이 없다(no-attempts). 카운트 계열은 여전히 항상 숫자다.
  curr: number | null; // 이번 시즌 경기당 평균(성공률 지표는 시즌 누적 성공률). 시도 0회면 null
  // [변경: 2026-07-28 17:00, 김병현 수정] pct 의 단위가 계열마다 다르다(결정 11) —
  // perGame 은 상대 증가율(%), rate 는 두 값의 차이(퍼센트포인트). 응답의 kinds 를 보고 해석한다.
  pct: number | null; // 발전률. 방향 반영됨(항상 클수록 좋음). 못 구하면 null
  basis: GrowthBasis;
}

export interface GrowthRow {
  rank: number | null; // qualified && pct != null 인 행에만 1,2,3…
  player: string;
  prevGames: number; // 직전 시즌 출전(기록이 남은) 경기 수
  currGames: number;
  qualified: boolean; // 두 시즌 모두 minGames 이상
  // [변경: 2026-07-28 17:00, 김병현 수정] v3.1 — 요청 지표의 최소 시도(AND)까지 반영된 값이다.
  // unqualifiedBy 에서 파생되므로 여기서 다시 계산하지 않는다(결정 11 원칙을 자기 자신에게도 적용).
  unqualifiedBy: GrowthUnqualified; // 자격 미달 사유. qualified === (unqualifiedBy === 'none') 이 항상 성립
  isNew: boolean; // 직전 시즌 기록이 아예 없음(= prevGames === 0)
  value: number | null; // = metrics[metric].pct (정렬에 쓴 값)
  metrics: Record<GrowthMetric, GrowthSplit>;
}

export interface GrowthReport {
  current: GrowthSeason;
  previous: GrowthSeason | null; // 첫 시즌이면 null
  metric: GrowthMetric; // 정렬에 쓴 지표
  betterWhen: Record<GrowthMetric, 'higher' | 'lower'>; // 화면 문구용(프론트의 'tov' 하드코딩 방지)
  // [신설: 2026-07-28 17:00, 김병현 작성] 지표별 계열(결정 11). 프론트가 'fg2Pct'/'fg3Pct' 문자열로
  // 계열을 판단하지 않고 이걸로 값 표기·단위를 고른다.
  kinds: Record<GrowthMetric, GrowthKind>;
  minGames: number; // 안내 문구용(상수 하드코딩 방지)
  // [신설: 2026-07-28 17:00, 김병현 작성] 지표별 최소 시도(결정 12). Record 인 이유는 B4 —
  // `placeholderData` 때문에 탭을 바꾸면 새 응답이 올 때까지 직전 지표의 리포트가 화면에 남는다.
  // 스칼라면 2점 탭→3점 탭 찰나에 "각 20회 이상"(3점은 10인데)이라고 말하는 사고가 난다.
  // → 봉투 규칙: "지표에 따라 달라지는 값은 전부 Record<GrowthMetric, …>".
  minAttempts: Record<GrowthMetric, number>;
  goneCount: number; // 직전엔 뛰었지만 이번 시즌 기록이 없는 선수 수
  // 이번 지표에서 기준값이 너무 작아 발전률을 못 낸 선수 수(basis === 'tiny-base').
  // 화면이 "몇 명 뺐는지"를 말하는 데 쓴다(결정 2의 ⚠). 프론트가 rows 를 다시 훑어 세지 않는다 —
  // 세는 규칙이 두 곳에 생기면 언젠가 어긋난다(결정 8: 셈은 백엔드).
  // [변경: 2026-07-28 17:00, 김병현 수정] 성공률 탭에선 MIN_BASE 가 안 걸려 구조적으로 항상 0이다(결정 13).
  tinyBaseCount: number;
  rows: GrowthRow[]; // metric 기준으로 이미 정렬돼 있음
}

// 소수 1자리 반올림. (표시용 유틸이라 지식이 아니다 — 진짜 단일 출처가 필요한
//  경기당 평균/EFF 공식은 aggregate 것을 그대로 재사용한다.)
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// 대회 시간축 비교자(과거 → 최신). 날짜 컬럼이 없어서 이 4단이 시간의 전부다.
// seasonNo 가 null 이면 그 해의 맨 앞 — 헤더 피커의 정렬(desc + nulls last)을 뒤집은 것과 같다.
// ⚠ 3·4단(createdAt/id)은 피커의 3단(name asc)과 다르다. (year, seasonNo) 가 같은 대회가
//    둘 이상이면 피커 순서와 갈릴 수 있다 — 그래서 화면이 직전 시즌 라벨을 반드시 보여준다.
function compareCompetitionTime(a: GrowthCompetition, b: GrowthCompetition): number {
  if (a.year !== b.year) return a.year - b.year;
  if (a.seasonNo == null && b.seasonNo != null) return -1;
  if (b.seasonNo == null && a.seasonNo != null) return 1;
  if (a.seasonNo != null && b.seasonNo != null && a.seasonNo !== b.seasonNo) {
    return a.seasonNo - b.seasonNo;
  }
  const at = a.createdAt.getTime();
  const bt = b.createdAt.getTime();
  // 잘못된 Date 면 getTime() 이 NaN 이라 비교가 조용히 망가진다 → 그땐 id 로 내려간다.
  if (Number.isFinite(at) && Number.isFinite(bt) && at !== bt) return at - bt;
  return a.id - b.id; // id 는 유일하므로 여기서 반드시 결판난다(결정적 정렬)
}

// "직전 시즌"의 정의 한 곳. 호출자 배열은 건드리지 않는다(복사 후 정렬).
export function previousCompetitionId(
  competitions: GrowthCompetition[],
  competitionId: number,
): number | null {
  const line = [...competitions].sort(compareCompetitionTime);
  const i = line.findIndex((c) => c.id === competitionId);
  return i > 0 ? line[i - 1].id : null; // i === -1(모르는 id)도, i === 0(맨 앞)도 null
}

// 그 대회에 "기록이 남은" 경기 수. gameKey 에 competitionId 가 들어 있어 시즌끼리 안 섞인다.
function countGames(events: StatEvent[]): number {
  return new Set(events.map(gameKey)).size;
}

// 선수별로 이벤트와 출전 경기를 모은다.
function byPlayer(events: StatEvent[]): Map<string, { events: StatEvent[]; games: Set<string> }> {
  const map = new Map<string, { events: StatEvent[]; games: Set<string> }>();
  for (const e of events) {
    let agg = map.get(e.player);
    if (!agg) {
      agg = { events: [], games: new Set() };
      map.set(e.player, agg);
    }
    agg.events.push(e);
    agg.games.add(gameKey(e));
  }
  return map;
}

// 박스스코어 → 지표 9종의 "이 시즌 값"(계열별로 다른 뜻 — SEASON_VALUE 표 참고).
// ⚠ Object.fromEntries 로 만들면 반환 타입이 { [k: string]: number | null } 라 TS2739 로 막힌다.
// [변경: 2026-07-28 17:00, 김병현 수정] v3.1 — perGame → seasonValues 로 개명, 반환 타입이
// Record<GrowthMetric, number | null> 로 바뀐다(성공률은 시도 0회면 null).
function seasonValues(box: BoxScore, games: number): Record<GrowthMetric, number | null> {
  return GROWTH_METRICS.reduce((acc, m) => {
    acc[m] = SEASON_VALUE[m](box, games);
    return acc;
  }, {} as Record<GrowthMetric, number | null>);
}

// 지표 하나의 발전률. 못 구하는 경우엔 숫자를 지어내지 않고 이유(basis)를 같이 내린다.
// [변경: 2026-07-28 17:00, 김병현 수정] v3.1 — 인자에 playedPrev 추가 + 판정 순서 6단으로 확장
// (성공률 지원). dir 은 rate 분기가 먼저 쓰므로 함수 맨 위에 둔다(아래에 두면 TS2448/TDZ).
function splitOf(
  m: GrowthMetric,
  prev: number | null,
  curr: number | null,
  playedPrev: boolean,
): GrowthSplit {
  const dir = BETTER_WHEN[m] === 'higher' ? 1 : -1;

  // 직전 시즌에 아예 안 뛰었으면(경기 자체가 없음) 'no-prev'. 아래 '시도 없음' 판정보다
  // 반드시 먼저다 — 안 뛴 사람에게 "시도 없음"이라 말하는 건 어색하다.
  if (!playedPrev) return { prev: null, curr, pct: null, basis: 'no-prev' };

  // [신설: 2026-07-28 17:00, 김병현 작성] 성공률인데 그 시즌에 한 번도 안 쐈으면(시도 0회) 값
  // 자체가 없다. prev·curr 는 **살아 있는 쪽을 그대로 실어 보낸다**(지어서 지우지 않는다) —
  // 정답 표 M 의 무시도(직전 null→이번 50.0)·이번무시도(직전 50.0→이번 null)가 이걸 확인한다.
  if (prev == null || curr == null) return { prev, curr, pct: null, basis: 'no-attempts' };

  // [신설: 2026-07-28 17:00, 김병현 작성] 성공률(rate)은 나눗셈 없이 두 값의 차이로 발전률을
  // 낸다(사용자 직접 결정 — 결정 9). 그래서 이 분기가 아래 0/작은 분모 처리 3단보다 반드시
  // 먼저여야 한다 — 직전 0.0% → 이번 20.0% 는 여기서 바로 '+20.0'(ok)로 끝나고 'from-zero' 로
  // 죽지 않는다(정답 표 M '영점' 행이 이걸 증명한다).
  if (KINDS[m] === 'rate') return { prev, curr, pct: round1(dir * (curr - prev)), basis: 'ok' };

  if (prev === 0) return { prev, curr, pct: null, basis: curr === 0 ? 'both-zero' : 'from-zero' };
  if (Math.abs(prev) < MIN_BASE[m]) return { prev, curr, pct: null, basis: 'tiny-base' };
  // 분모는 반드시 절댓값 — EFF 는 음수가 될 수 있어서, 그냥 prev 로 나누면
  // 좋아졌는데 −% 가 나오는 정반대 답이 된다.
  return { prev, curr, pct: round1((dir * (curr - prev) * 100) / Math.abs(prev)), basis: 'ok' };
}

// 기준 시즌(competitionId)과 그 직전 시즌을 비교한 발전률 리포트를 만든다.
// competitions 목록에 그 id 가 없으면 null(컨트롤러가 404 로 번역 — playerDetail 선례와 같은 결).
export function growthReport(
  events: StatEvent[],
  competitions: GrowthCompetition[],
  competitionId: number,
  metric: GrowthMetric,
): GrowthReport | null {
  const currMeta = competitions.find((c) => c.id === competitionId);
  if (!currMeta) return null; // 등록부에 없는 대회 → 컨트롤러가 404 로 번역

  const prevId = previousCompetitionId(competitions, competitionId);
  const prevMeta = prevId == null ? null : (competitions.find((c) => c.id === prevId) ?? null);

  const currEvents = events.filter((e) => e.competitionId === competitionId);
  const prevEvents = prevId == null ? [] : events.filter((e) => e.competitionId === prevId);

  const current: GrowthSeason = { competitionId, label: currMeta.label, games: countGames(currEvents) };
  const previous: GrowthSeason | null = prevMeta
    ? { competitionId: prevMeta.id, label: prevMeta.label, games: countGames(prevEvents) }
    : null;

  // 응답 봉투를 한 곳에서 만든다(필드 8개를 두 번 적지 않게).
  // ⚠ 여기서 필드 하나를 빠뜨리면 화면에 undefined 가 샌다 → check-growth 가 봉투를 단언한다(AC 29).
  // [변경: 2026-07-28 17:00, 김병현 수정] v3.1 — kinds·minAttempts 두 필드 추가.
  const envelope = (goneCount: number, tinyBaseCount: number, rows: GrowthRow[]): GrowthReport => ({
    current,
    previous,
    metric,
    betterWhen: BETTER_WHEN,
    kinds: KINDS,
    minGames: MIN_GAMES,
    minAttempts: MIN_ATTEMPTS,
    goneCount,
    tinyBaseCount,
    rows,
  });

  // 비교할 게 없으면 순위 자체가 없다(첫 시즌이거나, 직전 시즌이 등록만 되고 기록 0건).
  if (previous == null || previous.games === 0) return envelope(0, 0, []);

  const currBy = byPlayer(currEvents);
  const prevBy = byPlayer(prevEvents);

  // 직전엔 뛰었는데 이번 시즌 기록이 없는 선수는 행에서 빼고 수만 센다(화면이 고지한다).
  let goneCount = 0;
  for (const name of prevBy.keys()) if (!currBy.has(name)) goneCount++;

  const built = [...currBy.entries()].map(([player, cur]) => {
    const pv = prevBy.get(player) ?? null;
    const currGames = cur.games.size;
    const prevGames = pv ? pv.games.size : 0;
    const currBox = computeBoxScore(cur.events);
    const currValues = seasonValues(currBox, currGames);
    // 직전에 안 뛰었으면 null. perGameAvg(x, 0) 은 0을 주는데 그건 "평균 0.0" 이라는 거짓말이다.
    const prevBox = pv ? computeBoxScore(pv.events) : null;
    const prevValues = prevBox ? seasonValues(prevBox, prevGames) : null;

    // [변경: 2026-07-28 17:00, 김병현 수정] v3.1 — "직전 시즌에 뛰었나"는 값(null)이 아니라
    // 출전 기록(pv)으로 판단한다. prevValues[m] 의 null 은 이제 "시도 0회"라는 다른 뜻도
    // 갖기 때문이다(null 의 두 뜻이 부딪히는 유일한 지점, gotcha 31).
    const playedPrev = pv != null;
    const metrics = GROWTH_METRICS.reduce((acc, m) => {
      acc[m] = splitOf(m, prevValues ? prevValues[m] : null, currValues[m], playedPrev);
      return acc;
    }, {} as Record<GrowthMetric, GrowthSplit>);

    // [신설: 2026-07-28 17:00, 김병현 작성] v3.1 — 자격 판정에 요청 지표의 최소 시도(AND)를
    // 더한다(결정 12). 직전 시즌에 안 뛰었으면(pv===null) 시도도 0으로 본다.
    // unqualifiedBy 를 먼저 구하고 qualified 는 거기서 **파생**시킨다 — "항상 같아야 하는 필드
    // 두 개"를 따로 계산하지 않는다(v3.1 리뷰 N2, 결정 11 원칙을 자기 자신에게도 적용).
    const guard = ATTEMPT_GUARD[metric];
    const prevAttempts = prevBox ? guard.attempts(prevBox) : 0;
    const currAttempts = guard.attempts(currBox);
    const gamesOk = prevGames >= MIN_GAMES && currGames >= MIN_GAMES;
    const attsOk = prevAttempts >= guard.min && currAttempts >= guard.min;
    const unqualifiedBy: GrowthUnqualified =
      !gamesOk && !attsOk ? 'both' : !gamesOk ? 'games' : !attsOk ? 'attempts' : 'none';
    const qualified = unqualifiedBy === 'none';

    const value = metrics[metric].pct;
    // 자격이 있어도 그 지표의 직전 값이 0이거나(from-zero 류) 시도가 없으면(no-attempts)
    // % 가 없어서 순위를 못 매긴다.
    return {
      player,
      prevGames,
      currGames,
      qualified,
      unqualifiedBy,
      isNew: prevGames === 0,
      value,
      metrics,
      ranked: qualified && value != null,
    };
  });

  // 기준값이 너무 작아 발전률을 못 낸 사람 수. 화면이 "몇 명 뺐는지" 말하는 데 쓴다(결정 2의 ⚠).
  // 프론트가 rows 를 다시 훑어 세지 않게 여기서 한 번만 센다.
  const tinyBaseCount = built.filter((x) => x.metrics[metric].basis === 'tiny-base').length;

  // 정렬: 순위대상 → 자격자 → 값 있는 행 → pct 내림차순 → 이번 경기 수 → 이름.
  // pct 에 방향(dir)이 이미 반영돼 있으므로 여기서 또 뒤집지 않는다.
  // [변경: 2026-07-28 18:00, 김병현 수정] v3.1 구현 리뷰 D2 — 아래 문장이 "NaN 이 나온다"고 적혀
  // 있었는데 부정확했다(사실 정정). `null` 을 산술에 섞으면 `undefined` 와 달리 **`0`으로 조용히
  // 강제 변환**된다(`null - 5 === -5`, NaN 이 아니다) — 그래서 오히려 더 위험하다: 에러 없이
  // "그럴듯한" 순서가 나와서 리뷰에서도 한동안 못 잡혔다(값 있는 미자격 행이 전부 양수였을 땐
  // null→0 강제가 우연히 정답과 같았다 — 표 Q 가 음수 pct 행으로 그 우연을 깨고 나서야 실제로
  // 증명됐다, v2 시절 G1 과 같은 결). 그래서 반드시 아래처럼 null 을 명시 분기한다.
  built.sort((a, b) => {
    // [신설: 2026-07-28 18:00, 김병현 작성] v3.1 구현 리뷰 M37 — 이 줄은 논리적으로는 군더더기다
    // (ranked = qualified && value!=null 이라, 아래 qualified 체크 + null 체크만으로도 결과 정렬
    // 순서가 완전히 같다는 걸 리뷰어가 뮤테이션으로 확인했다 — "동치 뮤턴트"). 그래도 일부러 남긴다:
    // ① "정렬: 순위대상 → 자격자 → …" 라는 주석의 1단계를 코드가 그대로 말하게 해서, 아래
    // rank 매김(`ranked ? ++r : null`)이 왜 "여기가 순위 경계"인지 읽는 사람이 두 체크의 조합을
    // 암산하지 않아도 되게 한다. ② qualified/null 체크의 순서가 나중에 바뀌어도(예: null 체크가
    // qualified 보다 앞으로 옮겨지는 리팩터) 이 줄이 "순위대상은 무조건 맨 앞" 불변식을 계속
    // 지켜 준다 — 동치성이 두 체크의 정확한 순서에 우연히 기대고 있는 상태보다 안전하다.
    if (a.ranked !== b.ranked) return a.ranked ? -1 : 1;
    if (a.qualified !== b.qualified) return a.qualified ? -1 : 1;
    const av = a.value;
    const bv = b.value;
    if (av == null && bv != null) return 1;
    if (bv == null && av != null) return -1;
    if (av != null && bv != null && av !== bv) return bv - av;
    return b.currGames - a.currGames || a.player.localeCompare(b.player);
  });

  let r = 0;
  const rows: GrowthRow[] = built.map(({ ranked, ...x }) => ({ rank: ranked ? ++r : null, ...x }));
  return envelope(goneCount, tinyBaseCount, rows);
}
