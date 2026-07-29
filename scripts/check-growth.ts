/**
 * [신설: 2026-07-28 15:00, 김병현 작성] 기량 발전(Growth) 순수 모듈 검증 스크립트.
 *
 * DB·Nest 없이 `growthReport` / `previousCompetitionId` 만 직접 부른다(check-synergy.ts 와
 * 같은 스타일: 수동 fail/eq 헬퍼 + process.exit(0|1), jest 아님).
 *
 * ⚠ 이 파일은 `npm run build`(= nest build) 로 타입 검사가 안 된다. `tsconfig.build.json` 이
 *   `scripts` 디렉터리를 exclude 하기 때문이다(gotcha 20). 반드시 `npm run check:growth`
 *   (ts-node) 로 직접 돌려서 확인할 것.
 *
 * [변경: 2026-07-28 17:00, 김병현 수정] v3.1 리뷰 N8 정정 — 이 헤더가 "정답 표 A~G" 에서 멈춰
 * 있었다(표 H~L 은 인라인 주석에만 있었다). A~P 전부를 아래에 채운다.
 *
 * 무엇을 못 박는가 (정답 표 A~P):
 *  - 표 A: 시간축 정렬(입력 순서 무관·null 위치·createdAt 동률·id 동률·모르는 id·원본 배열 불변)
 *  - 표 B: 메인 리포트(음수 기준값=절댓값 분모, tiny-base 경계, 턴오버 방향, 지표마다 다른 순위,
 *          동률 타이브레이크, 음수 반올림) + 응답 봉투 필드 단언(AC 29)
 *  - 표 C: 첫 시즌(직전 없음)
 *  - 표 D: 직전 시즌 등록만 되고 기록 0건
 *  - 표 E: 모르는 대회
 *  - 표 F: 이번 대회에 이벤트가 하나도 없음(goneCount)
 *  - 표 G: 이중 반올림(화면에 보이는 반올림된 값끼리 % 를 낸다)
 *  - 표 H: 정렬 타이브레이크 — 이름 localeCompare
 *  - 표 I: 정렬 타이브레이크 — currGames
 *  - 표 J: tinyBaseCount 는 자격 무관하게 센다(AC 13)
 *  - 표 K: MIN_GAMES 경계는 `>=`(정확히 3경기)
 *  - 표 L: 시간축 createdAt 타이브레이크 + NaN 폴백(AC 9)
 *  - [신설: 2026-07-28 17:00, 김병현 작성] 표 M: 성공률(fg3Pct) — 단순 차이 공식·시도 0/무시도
 *    처리·자격 AND·unqualifiedBy·이중 반올림·봉투(kinds/minAttempts)
 *  - 표 N: 성공률(fg2Pct) — 표 M 과 다른 정렬(자격자·시도 하한이 다름)
 *  - 표 O: 카운트 탭에서도 새 필드(kinds/minAttempts)가 맞는지 + 공식이 진짜 "단순 차이"인지
 *    (상대증가율이면 다른 값이 나옴을 값으로 못 박음)
 *  - 표 P: 불변식(성공률 basis 는 ok/no-prev/no-attempts 뿐) + 경계 재확인
 *  - [신설: 2026-07-28 18:00, 김병현 작성] 표 Q: 정렬의 null 처리 — 미자격 + pct 음수인 행이
 *    null 행보다 반드시 앞임을 확인한다(구멍 M10, v3.1 구현 리뷰 D2)
 *
 * [신설: 2026-07-28 18:00, 김병현 작성] 일부러 깨 보기(AC 31·81) — 아래를 growth.ts 에 실제로
 * 넣고 `npm run check:growth` 가 빨간불을 내는지 구현자가 직접 확인한 뒤 되돌렸다. 이 목록이
 * 세션 로그에만 남으면 다음 사람이 "이 검사가 뭘 지키려고 만들어졌는지" 알 방법이 없다
 * (v3.1 구현 리뷰 D3). 어느 표가 잡는지도 같이 적는다.
 *  [v2, AC 31 의 4가지]
 *   ① 분모 `Math.abs` 제거 → 표 B(실책개선 pct 부호 반전)
 *   ② `BETTER_WHEN.tov` 를 `'higher'` 로 → 표 B-2(부호·정렬 전부 반전)
 *   ③ `MIN_BASE.eff` 를 `0` 으로 → 표 B-1(작은기준이 순위 1위로 등장)
 *   ④ `pct` 를 반올림 전 원값으로 계산 → 표 G(43.5 → 42.9)
 *  [v3.1, AC 81 의 5가지]
 *   ⑤ 성공률에 상대 증가율 공식 적용 → 표 M 전부(예: +10.0 → +25.0)
 *   ⑥ 성공률을 경기당 평균으로 계산 → 표 M·N·O 전부
 *   ⑦ 시도 0 을 `?? 0` 으로 뭉개기 → 표 M(무시도/이번무시도), 표 N
 *   ⑧ 최소 시도 자격 `>=` → `>` → 표 M·N(경계 정확 10/10·20/20 인 행 전부 탈락)
 *   ⑨ 반올림 순서 뒤집기(성공률 `round1` 제거) → 표 M(반올림 33.4→33.400000000000006)
 *  [추가로 구현자가 확인한 것]
 *   ⑩ rate 조기 반환을 `prev===0` 가드 뒤로 이동 → 표 M(영점이 `from-zero` 로 죽음, 정상 +20.0 이 사라짐)
 *   ⑪ `unqualifiedBy` 판정에서 `attempts`↔`games` 뒤바꿈 → 표 M·N·O·P 전부
 *   ⑫ 정렬 null 처리 3줄을 `if (av!==bv) return bv-av;` 로 축약 → 표 Q(음수 pct 행이 null 행보다 밀림)
 * 위 12가지는 구현자가 직접 넣고 원복한 것만 적었다 — tough-reviewer 가 추가로 심은 뮤턴트
 * 약 20종(자격 가드 한쪽만 검사·KINDS 뒤바꿈·MIN_GAMES 경계 등)은 `reviewImpl.md` 의
 * "v3.1 구현 재채점 → 뮤테이션 테스트" 절이 원본이다 — 매번 이 파일에 옮겨 적지 않는다.
 */
import {
  growthReport,
  previousCompetitionId,
  GROWTH_METRICS,
  GrowthCompetition,
  GrowthRow,
} from '../src/stats/growth';
import { StatEvent } from '../src/stats/types';

function main(): void {
  let failures = 0;
  const fail = (msg: string) => {
    failures++;
    console.error(`  ✗ ${msg}`);
  };
  const eq = (label: string, got: unknown, want: unknown) => {
    if (got !== want) fail(`${label}: 기대 ${JSON.stringify(want)}, 실제 ${JSON.stringify(got)}`);
  };
  // 제네릭으로 둬야 실제 넘어온 GrowthRow[] 의 전체 필드가 그대로 유지된다.
  function row<T extends { player: string }>(rows: T[], name: string): T | undefined {
    return rows.find((r) => r.player === name);
  }

  // [신설: 2026-07-28 17:00, 김병현 작성] AC 78 — 탭 순서 계약. 지금은 누가 배열 중간에
  // 지표를 끼워 넣어도 다른 단언이 전부 초록일 수 있다(값만 보고 순서는 안 보므로).
  // 이 한 줄이 "카운트 7종 뒤에 성공률 2종" 순서 자체를 못 박는다.
  eq(
    'GROWTH_METRICS 순서',
    GROWTH_METRICS.join(','),
    'eff,pts,reb,ast,stl,blk,tov,fg2Pct,fg3Pct',
  );

  // ── 표 A — 시간축 정렬 / previousCompetitionId ─────────────────────
  {
    const comp = (id: number, year: number, seasonNo: number | null, label: string, iso: string): GrowthCompetition => ({
      id,
      year,
      seasonNo,
      label,
      createdAt: new Date(iso),
    });
    const C1 = comp(1, 2025, 2, 'C1', '2025-06-01T00:00:00Z');
    const C2 = comp(2, 2026, null, 'C2', '2026-01-05T00:00:00Z'); // 시즌번호 없음 → 그 해 맨 앞
    const C3 = comp(3, 2026, 1, 'C3', '2026-02-01T00:00:00Z');
    const C4 = comp(4, 2026, 1, 'C4', '2026-03-01T00:00:00Z'); // C3 와 같은 (year,seasonNo) → createdAt 로 결판
    const C5 = comp(5, 2026, 1, 'C5', '2026-03-01T00:00:00Z'); // C4 와 createdAt 까지 동률 → id 로 결판
    const list = [C1, C2, C3, C4, C5];
    const shuffled = [C4, C1, C5, C3, C2];
    const listCopy = [...list];

    eq('A prev(1)', previousCompetitionId(list, 1), null);
    eq('A prev(2)', previousCompetitionId(list, 2), 1);
    eq('A prev(3)', previousCompetitionId(list, 3), 2); // 시즌번호 없는 대회가 시즌1보다 앞
    eq('A prev(4)', previousCompetitionId(list, 4), 3); // createdAt 타이브레이크
    eq('A prev(5)', previousCompetitionId(list, 5), 4); // id 타이브레이크(createdAt 동률)
    eq('A prev(999)', previousCompetitionId(list, 999), null); // 모르는 id

    // 입력 순서를 뒤섞어도 답이 같아야 한다(실제 서비스는 내림차순 배열을 넘긴다).
    eq('A 뒤섞은 입력 prev(5)', previousCompetitionId(shuffled, 5), 4);
    eq('A 뒤섞은 입력 prev(3)', previousCompetitionId(shuffled, 3), 2);

    // 호출 뒤 원본 배열 순서가 그대로여야 한다(복사 후 정렬).
    eq('A 원본 배열 불변', JSON.stringify(list) === JSON.stringify(listCopy), true);
  }

  // ── 표 B — 메인 리포트 픽스처 ────────────────────────────────────
  // 대회 둘: P(id 1, 2026 시즌1, 4경기) → C(id 2, 2026 시즌2, 5경기). 모두 week 1, team 'OB'.
  const ev = (competitionId: number, game: number, player: string, stat: string): StatEvent => ({
    competitionId,
    competitionLabel: `c${competitionId}`,
    week: 1,
    game,
    quarter: 1,
    player,
    stat,
    team: 'OB',
  });
  const P: GrowthCompetition = { id: 1, year: 2026, seasonNo: 1, label: 'P', createdAt: new Date('2026-01-01T00:00:00Z') };
  const C: GrowthCompetition = { id: 2, year: 2026, seasonNo: 2, label: 'C', createdAt: new Date('2026-02-01T00:00:00Z') };
  const COMPS = [P, C];

  // ⚠ plan.md 표 B 의 "g1~g4: `2`,`2A`" 같은 표기는 "매 경기마다 이 조합이 반복된다"는 뜻이다
  // (경기 4개에 이벤트 2개를 나눠 담는 게 아니다). 기대 평균값과 맞춰 역산해 아래처럼 매 경기 반복시켰다.
  const EVENTS: StatEvent[] = [
    // 성장: 직전 매 경기(g1~g4) '2'+'2A' → pts2/eff1 매경기. 이번 매 경기(g1~g4) '2'+'2' → pts4/eff4.
    ...[1, 2, 3, 4].flatMap((g) => [ev(1, g, '성장', '2'), ev(1, g, '성장', '2A')]),
    ...[1, 2, 3, 4].flatMap((g) => [ev(2, g, '성장', '2'), ev(2, g, '성장', '2')]),
    // 하락: 직전 매 경기 '2'×3+'T' → pts6/eff5/tov1. 이번 매 경기 '2'×2+'T'×2 → pts4/eff2/tov2.
    ...[1, 2, 3, 4].flatMap((g) => [
      ev(1, g, '하락', '2'),
      ev(1, g, '하락', '2'),
      ev(1, g, '하락', '2'),
      ev(1, g, '하락', 'T'),
    ]),
    ...[1, 2, 3, 4].flatMap((g) => [
      ev(2, g, '하락', '2'),
      ev(2, g, '하락', '2'),
      ev(2, g, '하락', 'T'),
      ev(2, g, '하락', 'T'),
    ]),
    // 실책개선: 직전 매 경기 'T'×2 → pts0/eff−2/tov2. 이번 매 경기 '2'+'T' → pts2/eff1/tov1.
    ...[1, 2, 3, 4].flatMap((g) => [ev(1, g, '실책개선', 'T'), ev(1, g, '실책개선', 'T')]),
    ...[1, 2, 3, 4].flatMap((g) => [ev(2, g, '실책개선', '2'), ev(2, g, '실책개선', 'T')]),
    // 표본부족: 직전 매 경기(g1~g4) '2' → pts2/eff2. 이번 g1,g2만 '2'×2 → pts4/eff4(currGames=2).
    ...[1, 2, 3, 4].map((g) => ev(1, g, '표본부족', '2')),
    ...[1, 2].flatMap((g) => [ev(2, g, '표본부족', '2'), ev(2, g, '표본부족', '2')]),
    // 작은기준: 직전 g1,g2 '2' / g3,g4 'T' → pts1.0/eff0.5/tov0.5. 이번 매 경기(g1~g4) '2'+'DR' → pts2/eff3/reb1.
    ev(1, 1, '작은기준', '2'),
    ev(1, 2, '작은기준', '2'),
    ev(1, 3, '작은기준', 'T'),
    ev(1, 4, '작은기준', 'T'),
    ...[1, 2, 3, 4].flatMap((g) => [ev(2, g, '작은기준', '2'), ev(2, g, '작은기준', 'DR')]),
    // 신규: 이번 매 경기(g1~g5) '2' → pts2/eff2, currGames=5.
    ...[1, 2, 3, 4, 5].map((g) => ev(2, g, '신규', '2')),
    // 떠남: 직전 매 경기(g1~g4) '2' → 이번 시즌엔 기록이 아예 없음(goneCount 대상).
    ...[1, 2, 3, 4].map((g) => ev(1, g, '떠남', '2')),
  ];

  // ── 표 B-1 — metric='eff' ────────────────────────────────────────
  {
    const r = growthReport(EVENTS, COMPS, 2, 'eff');
    if (!r) {
      fail('B-1 growthReport 가 null');
    } else {
      eq('B current.games', r.current.games, 5);
      eq('B current.label', r.current.label, 'C');
      eq('B previous.games', r.previous?.games, 4);
      eq('B previous.competitionId', r.previous?.competitionId, 1);
      eq('B previous.label', r.previous?.label, 'P');
      eq('B goneCount', r.goneCount, 1);
      eq('B minGames', r.minGames, 3);
      eq('B betterWhen.tov', r.betterWhen.tov, 'lower');
      eq('B betterWhen.eff', r.betterWhen.eff, 'higher');
      eq('B rows.length', r.rows.length, 6);
      eq('B 떠남 행 없음', row(r.rows, '떠남'), undefined);
      eq('B-1 metric', r.metric, 'eff');
      eq('B-1 tinyBaseCount', r.tinyBaseCount, 1);

      const 성장 = row(r.rows, '성장');
      if (!성장) fail('B-1 성장 행 없음');
      else {
        eq('B-1 성장 qualified', 성장.qualified, true);
        eq('B-1 성장 eff prev', 성장.metrics.eff.prev, 1.0);
        eq('B-1 성장 eff curr', 성장.metrics.eff.curr, 4.0);
        eq('B-1 성장 eff pct', 성장.metrics.eff.pct, 300.0);
        eq('B-1 성장 eff basis', 성장.metrics.eff.basis, 'ok'); // MIN_BASE.eff=1 경계: 1.0 < 1.0 은 거짓
        eq('B-1 성장 rank', 성장.rank, 1);
        eq('B-1 성장 value===metrics.eff.pct', 성장.value, 성장.metrics.eff.pct);
        eq('B-1 성장 tov basis', 성장.metrics.tov.basis, 'both-zero');
        eq('B-1 성장 blk basis', 성장.metrics.blk.basis, 'both-zero');
      }

      const 실책개선 = row(r.rows, '실책개선');
      if (!실책개선) fail('B-1 실책개선 행 없음');
      else {
        // 절댓값 분모 테스트: Math.abs 를 빼면 −150.0 이 나온다.
        eq('B-1 실책개선 eff prev', 실책개선.metrics.eff.prev, -2.0);
        eq('B-1 실책개선 eff curr', 실책개선.metrics.eff.curr, 1.0);
        eq('B-1 실책개선 eff pct', 실책개선.metrics.eff.pct, 150.0);
        eq('B-1 실책개선 rank', 실책개선.rank, 2);
        eq('B-1 실책개선 pts basis', 실책개선.metrics.pts.basis, 'from-zero');
        eq('B-1 실책개선 pts pct', 실책개선.metrics.pts.pct, null);
      }

      const 하락 = row(r.rows, '하락');
      if (!하락) fail('B-1 하락 행 없음');
      else {
        eq('B-1 하락 eff pct', 하락.metrics.eff.pct, -60.0);
        eq('B-1 하락 rank', 하락.rank, 3);
      }

      const 작은기준 = row(r.rows, '작은기준');
      if (!작은기준) fail('B-1 작은기준 행 없음');
      else {
        eq('B-1 작은기준 eff prev', 작은기준.metrics.eff.prev, 0.5);
        eq('B-1 작은기준 eff curr', 작은기준.metrics.eff.curr, 3.0);
        eq('B-1 작은기준 eff pct', 작은기준.metrics.eff.pct, null);
        eq('B-1 작은기준 eff basis', 작은기준.metrics.eff.basis, 'tiny-base');
        eq('B-1 작은기준 rank', 작은기준.rank, null);
      }

      const 표본부족 = row(r.rows, '표본부족');
      if (!표본부족) fail('B-1 표본부족 행 없음');
      else {
        eq('B-1 표본부족 qualified', 표본부족.qualified, false);
        eq('B-1 표본부족 eff pct', 표본부족.metrics.eff.pct, 100.0);
        eq('B-1 표본부족 rank', 표본부족.rank, null);
      }

      const 신규 = row(r.rows, '신규');
      if (!신규) fail('B-1 신규 행 없음');
      else {
        eq('B-1 신규 isNew', 신규.isNew, true);
        eq('B-1 신규 eff prev', 신규.metrics.eff.prev, null);
        eq('B-1 신규 eff basis', 신규.metrics.eff.basis, 'no-prev');
        eq('B-1 신규 rank', 신규.rank, null);
      }

      eq(
        'B-1 정렬 순서',
        r.rows.map((x: GrowthRow) => x.player).join(','),
        '성장,실책개선,하락,작은기준,표본부족,신규',
      );

      // ── 표 O — 카운트 탭(표 B 픽스처 재사용)에서도 새 필드가 맞는지 ──────────
      // [신설: 2026-07-28 17:00, 김병현 작성] AC 79 — v3.1 이 늘린 필드(kinds/minAttempts/
      // unqualifiedBy)가 기존 카운트 픽스처에서도 값으로 맞는지, 성공률 공식이 진짜
      // "단순 차이"(상대증가율 아님)인지를 이 표가 못 박는다.
      eq('O kinds.eff', r.kinds.eff, 'perGame');
      eq('O kinds.fg2Pct', r.kinds.fg2Pct, 'rate');
      eq('O kinds.fg3Pct', r.kinds.fg3Pct, 'rate');
      eq('O minAttempts.eff', r.minAttempts.eff, 0); // 카운트 계열은 자격이 꺼져 있다
      eq('O betterWhen.fg2Pct', r.betterWhen.fg2Pct, 'higher');
      eq('O betterWhen.fg3Pct', r.betterWhen.fg3Pct, 'higher');
      if (!성장) fail('O 성장 행 없음');
      else {
        // 성장: 직전 매경기 '2'+'2A'(1성공1실패)×4경기 → fg2m4/fg2a8=50.0.
        // 이번 매경기 '2'+'2'(2성공)×4경기 → fg2m8/fg2a8=100.0.
        eq('O 성장 fg2Pct prev', 성장.metrics.fg2Pct.prev, 50.0);
        eq('O 성장 fg2Pct curr', 성장.metrics.fg2Pct.curr, 100.0);
        // 단순 차이 공식을 값으로 못 박는다 — 상대증가율이었다면 (100-50)/50*100 = +100.0 이 나온다.
        eq('O 성장 fg2Pct pct(단순 차이, 상대증가율 아님)', 성장.metrics.fg2Pct.pct, 50.0);
        eq('O 성장 fg2Pct basis', 성장.metrics.fg2Pct.basis, 'ok');
        // 성장은 3점을 한 번도 안 쐈다 — 직전·이번 둘 다 시도 0(둘 다 null 로 실린다).
        eq('O 성장 fg3Pct basis(무시도)', 성장.metrics.fg3Pct.basis, 'no-attempts');
        eq('O 성장 fg3Pct prev', 성장.metrics.fg3Pct.prev, null);
        eq('O 성장 fg3Pct curr', 성장.metrics.fg3Pct.curr, null);
      }
      if (!신규) fail('O 신규 행 없음');
      else {
        // 판정 순서 증명: 직전에 아예 안 뛴 사람은 'no-attempts' 가 아니라 'no-prev' 가 먼저 걸린다.
        eq('O 신규 fg3Pct basis(판정순서)', 신규.metrics.fg3Pct.basis, 'no-prev');
      }
      if (!표본부족) fail('O 표본부족 행 없음');
      else {
        // 카운트 지표는 시도 조건이 항상 통과라 unqualifiedBy 가 'none' 아니면 'games' 뿐이다.
        eq('O 표본부족 unqualifiedBy', 표본부족.unqualifiedBy, 'games');
      }
    }
  }

  // ── 표 B-2 — metric='tov' (방향이 lower) ───────────────────────────
  {
    const r = growthReport(EVENTS, COMPS, 2, 'tov');
    if (!r) fail('B-2 growthReport 가 null');
    else {
      eq('B-2 metric', r.metric, 'tov');
      eq('B-2 tinyBaseCount', r.tinyBaseCount, 0); // MIN_BASE.tov=0 → 이 지표에선 하한이 항상 꺼짐

      const 작은기준 = row(r.rows, '작은기준');
      const 실책개선 = row(r.rows, '실책개선');
      const 하락 = row(r.rows, '하락');
      if (!작은기준 || !실책개선 || !하락) fail('B-2 자격자 행 없음');
      else {
        eq('B-2 작은기준 tov pct', 작은기준.metrics.tov.pct, 100.0);
        eq('B-2 작은기준 rank', 작은기준.rank, 1);
        eq('B-2 실책개선 tov pct', 실책개선.metrics.tov.pct, 50.0);
        eq('B-2 실책개선 rank', 실책개선.rank, 2);
        eq('B-2 하락 tov pct', 하락.metrics.tov.pct, -100.0);
        eq('B-2 하락 rank', 하락.rank, 3);
        eq('B-2 하락 value===metrics.tov.pct', 하락.value, 하락.metrics.tov.pct);
      }

      eq(
        'B-2 정렬 순서',
        r.rows.map((x: GrowthRow) => x.player).join(','),
        '작은기준,실책개선,하락,성장,신규,표본부족',
      );
    }
  }

  // ── 표 B-3 — metric='pts' (동률 타이브레이크) ───────────────────────
  {
    const r = growthReport(EVENTS, COMPS, 2, 'pts');
    if (!r) fail('B-3 growthReport 가 null');
    else {
      eq('B-3 metric', r.metric, 'pts');
      eq('B-3 tinyBaseCount', r.tinyBaseCount, 0);

      const 성장 = row(r.rows, '성장');
      const 작은기준 = row(r.rows, '작은기준');
      const 하락 = row(r.rows, '하락');
      if (!성장 || !작은기준 || !하락) fail('B-3 행 없음');
      else {
        eq('B-3 성장 pts pct', 성장.metrics.pts.pct, 100.0);
        eq('B-3 성장 rank', 성장.rank, 1); // 동률 타이브레이크: '성장' < '작은기준'(localeCompare)
        eq('B-3 작은기준 pts pct', 작은기준.metrics.pts.pct, 100.0);
        eq('B-3 작은기준 rank', 작은기준.rank, 2);
        // 음수 반올림 방향: (4.0-6.0)/6.0*100 = -33.333… → -33.3
        eq('B-3 하락 pts pct', 하락.metrics.pts.pct, -33.3);
        eq('B-3 하락 rank', 하락.rank, 3);
        eq('B-3 하락 value===metrics.pts.pct', 하락.value, 하락.metrics.pts.pct);
      }

      eq(
        'B-3 정렬 순서',
        r.rows.map((x: GrowthRow) => x.player).join(','),
        '성장,작은기준,하락,실책개선,표본부족,신규',
      );
    }
  }

  // ── 표 C — 첫 시즌(직전 없음) ────────────────────────────────────
  {
    const r = growthReport(EVENTS, COMPS, 1, 'eff'); // 제일 오래된 P 를 고름
    if (!r) fail('C growthReport 가 null');
    else {
      eq('C previous', r.previous, null);
      eq('C rows.length', r.rows.length, 0);
      eq('C current.games', r.current.games, 4);
      eq('C goneCount', r.goneCount, 0);
      eq('C tinyBaseCount', r.tinyBaseCount, 0);
    }
  }

  // ── 표 D — 직전 시즌이 등록만 되고 기록이 0건 ────────────────────
  {
    const currOnly = EVENTS.filter((e) => e.competitionId === 2);
    const r = growthReport(currOnly, COMPS, 2, 'eff');
    if (!r) fail('D growthReport 가 null');
    else {
      eq('D previous 존재', r.previous !== null, true);
      eq('D previous.games', r.previous?.games, 0);
      eq('D rows.length', r.rows.length, 0);
      eq('D goneCount', r.goneCount, 0);
      eq('D tinyBaseCount', r.tinyBaseCount, 0);
    }
  }

  // ── 표 E — 모르는 대회 ───────────────────────────────────────────
  {
    const r = growthReport(EVENTS, COMPS, 999, 'eff');
    eq('E growthReport(모르는 id)', r, null); // 컨트롤러가 404 로 번역
  }

  // ── 표 F — 이번 대회에 이벤트가 하나도 없음 ─────────────────────
  {
    const prevOnly = EVENTS.filter((e) => e.competitionId === 1);
    const r = growthReport(prevOnly, COMPS, 2, 'eff');
    if (!r) fail('F growthReport 가 null');
    else {
      eq('F current.games', r.current.games, 0);
      eq('F rows.length', r.rows.length, 0);
      // 직전 시즌 선수 전원: 성장·하락·실책개선·표본부족·작은기준·떠남
      eq('F goneCount', r.goneCount, 6);
    }
  }

  // ── 표 G — 이중 반올림 전용 ──────────────────────────────────────
  {
    const G1: GrowthCompetition = { id: 11, year: 2027, seasonNo: 1, label: 'G1', createdAt: new Date('2027-01-01T00:00:00Z') };
    const G2: GrowthCompetition = { id: 12, year: 2027, seasonNo: 2, label: 'G2', createdAt: new Date('2027-02-01T00:00:00Z') };
    const GCOMPS = [G1, G2];
    const GEVENTS: StatEvent[] = [
      // 직전 G1, 3경기: g1:'3' / g2:'2' / g3:'2' → 총 pts 7 → 경기당 2.3(2.3333…)
      ev(11, 1, '반올림', '3'),
      ev(11, 2, '반올림', '2'),
      ev(11, 3, '반올림', '2'),
      // 이번 G2, 3경기: g1:'3','2' / g2:'3' / g3:'2' → 총 pts 10 → 경기당 3.3(3.3333…)
      ev(12, 1, '반올림', '3'),
      ev(12, 1, '반올림', '2'),
      ev(12, 2, '반올림', '3'),
      ev(12, 3, '반올림', '2'),
    ];
    const r = growthReport(GEVENTS, GCOMPS, 12, 'pts');
    if (!r) fail('G growthReport 가 null');
    else {
      const 반올림 = row(r.rows, '반올림');
      if (!반올림) fail('G 반올림 행 없음');
      else {
        eq('G pts prev', 반올림.metrics.pts.prev, 2.3);
        eq('G pts curr', 반올림.metrics.pts.curr, 3.3);
        // 원값으로 계산하면 (3.3333-2.3333)/2.3333*100 = 42.857… → 42.9 라 다르다.
        eq('G pts pct(이중 반올림)', 반올림.metrics.pts.pct, 43.5);
      }
    }
  }

  // [신설: 2026-07-28 16:00, 김병현 작성] 아래 표 H~L 은 구현 리뷰(reviewImpl.md)가 뮤테이션
  // 테스팅으로 찾아낸 "값은 맞는데 규칙은 증명 못 하는" 구멍 5개를 메운다. 기존 표 A~B 의 픽스처를
  // 직접 고치지 않고 **격리된 새 표**로 추가한 이유: 표 A~B 는 이미 계약서(plan.md)의 정답 표와
  // 숫자가 대조돼 있다. 거길 고치면 그 정답 표 자체가 흔들려 계약과 어긋날 위험이 생긴다.
  // 격리된 표는 그 위험 없이 같은 뮤턴트를 잡는다(표 G 가 이미 쓴 방식과 같다).

  // ── 표 H — 정렬 타이브레이크: 이름 localeCompare 전용 (구멍 G1) ────────
  // 기존 표 B-3 의 '성장'/'작은기준' 동률은 **이벤트 등장 순서가 이미 이름 순서와 같아서**
  // localeCompare 를 지워도 우연히 통과했다(주석은 증명한 척했지만 실제로는 증명 못 함).
  // 여기서는 이름이 나중인 '하나' 를 이벤트 배열에 **먼저** 넣어 등장 순서와 이름 순서를 반대로 만든다.
  {
    const H1: GrowthCompetition = { id: 41, year: 2033, seasonNo: 1, label: 'H1', createdAt: new Date('2033-01-01T00:00:00Z') };
    const H2: GrowthCompetition = { id: 42, year: 2033, seasonNo: 2, label: 'H2', createdAt: new Date('2033-02-01T00:00:00Z') };
    const HCOMPS = [H1, H2];
    // 두 선수 모두 prev pts2.0/game·curr pts4.0/game(pct100.0)·currGames3 로 완전히 동률 —
    // 오직 이름만 순위를 가른다. '하나' 를 이벤트 배열에 먼저 넣어 등장 순서를 이름 역순으로 만든다.
    const HEVENTS: StatEvent[] = [
      // 하나: 등장 순서상 '가나' 보다 먼저(=이름 역순으로 먼저 나옴).
      ...[1, 2, 3].map((g) => ev(41, g, '하나', '2')), // 직전 매경기 1×'2' → pts2.0
      ...[1, 2, 3].flatMap((g) => [ev(42, g, '하나', '2'), ev(42, g, '하나', '2')]), // 이번 매경기 2×'2' → pts4.0
      // 가나: 이름은 앞서지만 이벤트 배열엔 '하나' 다음에 등장.
      ...[1, 2, 3].map((g) => ev(41, g, '가나', '2')),
      ...[1, 2, 3].flatMap((g) => [ev(42, g, '가나', '2'), ev(42, g, '가나', '2')]),
    ];
    const r = growthReport(HEVENTS, HCOMPS, 42, 'pts');
    if (!r) fail('H growthReport 가 null');
    else {
      eq('H rows.length', r.rows.length, 2);
      const 가나 = row(r.rows, '가나');
      const 하나 = row(r.rows, '하나');
      if (!가나 || !하나) fail('H 행 없음');
      else {
        eq('H 가나 pts pct', 가나.metrics.pts.pct, 100.0);
        eq('H 하나 pts pct', 하나.metrics.pts.pct, 100.0);
        eq('H 가나/하나 currGames 동률', 가나.currGames === 하나.currGames, true);
        // 이름순: '가나' < '하나' → 값·경기수가 동률이면 '가나' 가 1위여야 한다.
        // localeCompare 타이브레이크를 지우면 안정 정렬이 "등장 순서"(하나 먼저)를 그대로 살려
        // '하나' 가 1위로 나온다 — 그래서 이 결과가 그 뮤턴트를 잡는다.
        eq('H 정렬 순서(이름 타이브레이크)', r.rows.map((x: GrowthRow) => x.player).join(','), '가나,하나');
        eq('H 가나 rank', 가나.rank, 1);
        eq('H 하나 rank', 하나.rank, 2);
      }
    }
  }

  // ── 표 I — 정렬 타이브레이크: currGames 전용 (구멍 G2) ─────────────────
  // 기존 표 B-2 의 '신규'(5경기)/'표본부족'(2경기) 는 **이름순으로도 같은 답**이 나와서
  // (ㅅ < ㅍ) currGames 타이브레이크를 지워도 우연히 통과했다. 여기서는 경기 수가 **많은** 쪽의
  // 이름이 가나다순으로 **나중**이 되게 골라, currGames 규칙과 이름 규칙이 서로 다른 승자를 내게 한다.
  {
    const I1: GrowthCompetition = { id: 43, year: 2034, seasonNo: 1, label: 'I1', createdAt: new Date('2034-01-01T00:00:00Z') };
    const I2: GrowthCompetition = { id: 44, year: 2034, seasonNo: 2, label: 'I2', createdAt: new Date('2034-02-01T00:00:00Z') };
    const ICOMPS = [I1, I2];
    const IEVENTS: StatEvent[] = [
      // 가영: prev 3경기, curr 3경기 — pct100.0, currGames=3.
      ...[1, 2, 3].map((g) => ev(43, g, '가영', '2')),
      ...[1, 2, 3].flatMap((g) => [ev(44, g, '가영', '2'), ev(44, g, '가영', '2')]),
      // 하영: prev 3경기, curr **6경기** — 경기당 평균은 가영과 똑같이 pct100.0, currGames=6(더 많음).
      ...[1, 2, 3].map((g) => ev(43, g, '하영', '2')),
      ...[1, 2, 3, 4, 5, 6].flatMap((g) => [ev(44, g, '하영', '2'), ev(44, g, '하영', '2')]),
    ];
    const r = growthReport(IEVENTS, ICOMPS, 44, 'pts');
    if (!r) fail('I growthReport 가 null');
    else {
      const 가영 = row(r.rows, '가영');
      const 하영 = row(r.rows, '하영');
      if (!가영 || !하영) fail('I 행 없음');
      else {
        eq('I 가영 pts pct', 가영.metrics.pts.pct, 100.0);
        eq('I 하영 pts pct', 하영.metrics.pts.pct, 100.0);
        eq('I 가영 currGames', 가영.currGames, 3);
        eq('I 하영 currGames', 하영.currGames, 6);
        // pct 는 동률이라 currGames 가 갈라야 한다. currGames desc 규칙대로면 '하영'(6) 이 1위 —
        // 이름순(가영<하영)과는 정반대라서, currGames 타이브레이크를 지우면 '가영' 이 1위로 나와
        // 이 단언이 빨간불이 된다.
        eq('I 정렬 순서(currGames 타이브레이크)', r.rows.map((x: GrowthRow) => x.player).join(','), '하영,가영');
        eq('I 하영 rank', 하영.rank, 1);
        eq('I 가영 rank', 가영.rank, 2);
      }
    }
  }

  // ── 표 J — tinyBaseCount 는 자격 무관하게 센다 (구멍 G4, AC 13) ────────
  // 기존 표 B 의 유일한 tiny-base 선수('작은기준')는 자격자였다. "자격자만 센다"로 바꿔도
  // 표 B 는 초록이었다. 여기서는 **미자격 tiny-base 선수**를 자격 tiny-base 선수와 함께 넣어,
  // tinyBaseCount 가 둘 다(자격 무관) 세는지를 값으로 확인한다.
  {
    const J1: GrowthCompetition = { id: 45, year: 2035, seasonNo: 1, label: 'J1', createdAt: new Date('2035-01-01T00:00:00Z') };
    const J2: GrowthCompetition = { id: 46, year: 2035, seasonNo: 2, label: 'J2', createdAt: new Date('2035-02-01T00:00:00Z') };
    const JCOMPS = [J1, J2];
    const JEVENTS: StatEvent[] = [
      // 자격기준: 직전 3경기('2','2A','DR' → eff 합 2 → 경기당 0.7) · 이번 3경기(매경기 '2' → eff4.0) → qualified true.
      ev(45, 1, '자격기준', '2'),
      ev(45, 2, '자격기준', '2A'),
      ev(45, 3, '자격기준', 'DR'),
      ...[1, 2, 3].map((g) => ev(46, g, '자격기준', '2')),
      // 미자격기준: 직전 2경기('2','2A' → eff 합 1 → 경기당 0.5) · 이번 1경기('2') → prevGames 2<3 → qualified false.
      ev(45, 1, '미자격기준', '2'),
      ev(45, 2, '미자격기준', '2A'),
      ev(46, 1, '미자격기준', '2'),
    ];
    const r = growthReport(JEVENTS, JCOMPS, 46, 'eff');
    if (!r) fail('J growthReport 가 null');
    else {
      eq('J rows.length', r.rows.length, 2);
      const 자격기준 = row(r.rows, '자격기준');
      const 미자격기준 = row(r.rows, '미자격기준');
      if (!자격기준 || !미자격기준) fail('J 행 없음');
      else {
        eq('J 자격기준 qualified', 자격기준.qualified, true);
        eq('J 자격기준 eff basis', 자격기준.metrics.eff.basis, 'tiny-base');
        eq('J 자격기준 rank', 자격기준.rank, null);
        eq('J 미자격기준 qualified', 미자격기준.qualified, false);
        eq('J 미자격기준 eff basis', 미자격기준.metrics.eff.basis, 'tiny-base');
        eq('J 미자격기준 rank', 미자격기준.rank, null);
        // "자격자만 센다"로 바꾸면 여기가 2 대신 1 이 나와 빨간불이 된다.
        eq('J tinyBaseCount(자격 무관 합계)', r.tinyBaseCount, 2);
      }
    }
  }

  // ── 표 K — MIN_GAMES 경계는 `>=` (구멍 G5, AC 19) ───────────────────
  // 기존 표 B 엔 정확히 3경기인 선수가 없어서 `>=` 를 `>` 로 바꿔도 통과했다.
  // 여기서는 prev/curr 둘 다 **정확히 3경기**인 선수로 경계를 직접 찍는다.
  {
    const K1: GrowthCompetition = { id: 47, year: 2036, seasonNo: 1, label: 'K1', createdAt: new Date('2036-01-01T00:00:00Z') };
    const K2: GrowthCompetition = { id: 48, year: 2036, seasonNo: 2, label: 'K2', createdAt: new Date('2036-02-01T00:00:00Z') };
    const KCOMPS = [K1, K2];
    const KEVENTS: StatEvent[] = [
      // 삼경기: 직전 정확히 3경기(매경기 '2') · 이번 정확히 3경기(매경기 '2','2') → 경계값 그 자체.
      ...[1, 2, 3].map((g) => ev(47, g, '삼경기', '2')),
      ...[1, 2, 3].flatMap((g) => [ev(48, g, '삼경기', '2'), ev(48, g, '삼경기', '2')]),
      // 이경기: 직전 2경기(매경기 '2') · 이번 3경기(매경기 '2') → prevGames 2<3 → 미자격(대조군).
      ...[1, 2].map((g) => ev(47, g, '이경기', '2')),
      ...[1, 2, 3].map((g) => ev(48, g, '이경기', '2')),
    ];
    const r = growthReport(KEVENTS, KCOMPS, 48, 'eff');
    if (!r) fail('K growthReport 가 null');
    else {
      const 삼경기 = row(r.rows, '삼경기');
      const 이경기 = row(r.rows, '이경기');
      if (!삼경기 || !이경기) fail('K 행 없음');
      else {
        eq('K 삼경기 prevGames', 삼경기.prevGames, 3);
        eq('K 삼경기 currGames', 삼경기.currGames, 3);
        // `>` 로 바뀌면 3>3 이 거짓이라 qualified 가 false 로 뒤집히고 rank 도 null 이 된다.
        eq('K 삼경기 qualified(경계값 >=3)', 삼경기.qualified, true);
        eq('K 삼경기 eff pct', 삼경기.metrics.eff.pct, 100.0);
        eq('K 삼경기 rank', 삼경기.rank, 1);
        // 대조군: 2경기는 그대로 미자격이어야 한다(경계 아래는 두 규칙 다 동의).
        eq('K 이경기 qualified(대조군 <3)', 이경기.qualified, false);
        eq('K 이경기 rank', 이경기.rank, null);
      }
    }
  }

  // ── 표 L — 시간축 createdAt 타이브레이크 + NaN 폴백 (구멍 G3, AC 9) ────
  // 표 A 의 C3~C5 는 createdAt 순서와 id 순서가 항상 같은 방향이라, createdAt 비교 단계를
  // 통째로 지우고 id 만 써도 우연히 통과했다. 여기서는 id 순서와 createdAt 순서가 **반대**인
  // 대회 쌍(L 서브케이스)과, createdAt 이 파싱 불가(NaN)라 id 로 폴백해야 하는 쌍(L2 서브케이스)을 각각 판다.
  {
    // L: id 는 크지만 실제로는 더 먼저 생긴 대회 — createdAt 이 진짜로 순서를 뒤집는지 확인.
    const L_EARLY: GrowthCompetition = { id: 9, year: 2037, seasonNo: 1, label: 'L_EARLY', createdAt: new Date('2037-01-01T00:00:00Z') };
    const L_LATE: GrowthCompetition = { id: 1, year: 2037, seasonNo: 1, label: 'L_LATE', createdAt: new Date('2037-06-01T00:00:00Z') };
    const listL = [L_EARLY, L_LATE];
    // id 만으로 정렬하면(뮤턴트) id1(L_LATE)이 먼저라 prev(L_EARLY=9) 가 1이 되어 버린다.
    // createdAt 을 제대로 쓰면 L_EARLY(1월)가 시간상 더 앞이라 prev(9)=null 이어야 한다.
    eq('L prev(L_EARLY) — createdAt 이 id 를 이긴다', previousCompetitionId(listL, 9), null);
    eq('L prev(L_LATE) — 직전은 L_EARLY', previousCompetitionId(listL, 1), 9);

    // L2: createdAt 이 파싱 불가(NaN) → AC 9 의 id 폴백이 실제로 도는지 확인.
    // [변경: 2026-07-28 17:00, 김병현 수정] 변수/라벨을 'M_*' → 'L2_*' 로 개명했다(표 M 이
    // 새로 성공률 픽스처를 쓰게 되면서 이름이 겹치지 않게 — id 도 21/20 → 121/120 으로 옮겼다).
    const L2_BAD: GrowthCompetition = { id: 121, year: 2038, seasonNo: 1, label: 'L2_BAD', createdAt: new Date('not-a-real-date') };
    const L2_GOOD: GrowthCompetition = { id: 120, year: 2038, seasonNo: 1, label: 'L2_GOOD', createdAt: new Date('2038-01-01T00:00:00Z') };
    eq('L2 createdAt이 NaN 인지 사전 확인', Number.isFinite(L2_BAD.createdAt.getTime()), false);
    const listL2 = [L2_BAD, L2_GOOD]; // NaN 쪽을 배열 앞에 둬서 "안정 정렬이 우연히 맞는" 경우까지 배제.
    // NaN 가드 없이 그냥 getTime() 을 뺐다면 비교 결과가 NaN 이 되어 정렬이 조용히 망가진다.
    // 가드가 있으면 id(120<121) 로 폴백해 L2_GOOD 이 시간상 앞이 된다.
    eq('L2 prev(L2_BAD) — NaN 이면 id 로 폴백', previousCompetitionId(listL2, 121), 120);
    eq('L2 prev(L2_GOOD) — id 폴백으로 맨 앞', previousCompetitionId(listL2, 120), null);
  }

  // ── 표 M~P — 성공률 2종(2점·3점) 공통 픽스처 ────────────────────────
  // [신설: 2026-07-28 17:00, 김병현 작성] 대회 R1(id 21, 2027 시즌1) → R2(id 22, 2027 시즌2),
  // 각 5경기(g1~g5), team 'OB'. 기존 표 A~L 과 완전히 분리된 새 대회·새 선수다
  // (plan.md 정답 표 M~P 픽스처와 값이 같다 — 손검산 + node 재확인).
  const R1: GrowthCompetition = { id: 21, year: 2027, seasonNo: 1, label: 'R1', createdAt: new Date('2027-01-01T00:00:00Z') };
  const R2: GrowthCompetition = { id: 22, year: 2027, seasonNo: 2, label: 'R2', createdAt: new Date('2027-02-01T00:00:00Z') };
  const RCOMPS = [R1, R2];
  const RATE_EVENTS: StatEvent[] = [
    // 슈터: 직전 g1~g4 매경기 '3'+'3A' / g5 '3A'+'3A' → 4/10=40.0. 이번 매경기(g1~g5) '3'+'3A' → 5/10=50.0.
    ...[1, 2, 3, 4].flatMap((g) => [ev(21, g, '슈터', '3'), ev(21, g, '슈터', '3A')]),
    ev(21, 5, '슈터', '3A'),
    ev(21, 5, '슈터', '3A'),
    ...[1, 2, 3, 4, 5].flatMap((g) => [ev(22, g, '슈터', '3'), ev(22, g, '슈터', '3A')]),

    // 하락: 직전 매경기(g1~g5) '3'+'3A' → 5/10=50.0. 이번 g1~g4 매경기 '3'+'3A' / g5 '3A'+'3A' → 4/10=40.0.
    ...[1, 2, 3, 4, 5].flatMap((g) => [ev(21, g, '하락', '3'), ev(21, g, '하락', '3A')]),
    ...[1, 2, 3, 4].flatMap((g) => [ev(22, g, '하락', '3'), ev(22, g, '하락', '3A')]),
    ev(22, 5, '하락', '3A'),
    ev(22, 5, '하락', '3A'),

    // 영점: 직전 매경기(g1~g5) '3A'+'3A' → 0/10=0.0. 이번 g1,g2 '3'+'3A' / g3~g5 '3A'+'3A' → 2/10=20.0.
    ...[1, 2, 3, 4, 5].flatMap((g) => [ev(21, g, '영점', '3A'), ev(21, g, '영점', '3A')]),
    ...[1, 2].flatMap((g) => [ev(22, g, '영점', '3'), ev(22, g, '영점', '3A')]),
    ...[3, 4, 5].flatMap((g) => [ev(22, g, '영점', '3A'), ev(22, g, '영점', '3A')]),

    // 무시도: 직전 매경기(g1~g5) '2' 하나(3점 시도 0). 이번 매경기(g1~g5) '3'+'3A' → 5/10=50.0.
    ...[1, 2, 3, 4, 5].map((g) => ev(21, g, '무시도', '2')),
    ...[1, 2, 3, 4, 5].flatMap((g) => [ev(22, g, '무시도', '3'), ev(22, g, '무시도', '3A')]),

    // 이번무시도: 직전 매경기(g1~g5) '3'+'3A' → 5/10=50.0. 이번 매경기(g1~g5) '2' 하나(3점 시도 0).
    ...[1, 2, 3, 4, 5].flatMap((g) => [ev(21, g, '이번무시도', '3'), ev(21, g, '이번무시도', '3A')]),
    ...[1, 2, 3, 4, 5].map((g) => ev(22, g, '이번무시도', '2')),

    // 경계미달: 직전 g1~g4 매경기 '3'+'3A' / g5 '3A' 하나 → 4/9=44.4. 이번 g1~g4 매경기 '3'+'3A' / g5 '3' 하나 → 5/9=55.6.
    ...[1, 2, 3, 4].flatMap((g) => [ev(21, g, '경계미달', '3'), ev(21, g, '경계미달', '3A')]),
    ev(21, 5, '경계미달', '3A'),
    ...[1, 2, 3, 4].flatMap((g) => [ev(22, g, '경계미달', '3'), ev(22, g, '경계미달', '3A')]),
    ev(22, 5, '경계미달', '3'),

    // 반올림: 3경기뿐. 직전 g1 '3' / g2 '3A' / g3 '3A' → 1/3=33.3. 이번 g1 '3' / g2 '3' / g3 '3A' → 2/3=66.7.
    ev(21, 1, '반올림', '3'),
    ev(21, 2, '반올림', '3A'),
    ev(21, 3, '반올림', '3A'),
    ev(22, 1, '반올림', '3'),
    ev(22, 2, '반올림', '3'),
    ev(22, 3, '반올림', '3A'),

    // 투점: 3점은 아예 없고 2점만. 직전 g1~g3 매경기 '2','2','2A','2A' / g4,g5 매경기 '2','2A','2A','2A' → 8/20=40.0.
    //       이번 g1~g4 매경기 '2','2','2','2A' / g5 '2A'×4 → 12/20=60.0.
    ...[1, 2, 3].flatMap((g) => [
      ev(21, g, '투점', '2'),
      ev(21, g, '투점', '2'),
      ev(21, g, '투점', '2A'),
      ev(21, g, '투점', '2A'),
    ]),
    ...[4, 5].flatMap((g) => [
      ev(21, g, '투점', '2'),
      ev(21, g, '투점', '2A'),
      ev(21, g, '투점', '2A'),
      ev(21, g, '투점', '2A'),
    ]),
    ...[1, 2, 3, 4].flatMap((g) => [
      ev(22, g, '투점', '2'),
      ev(22, g, '투점', '2'),
      ev(22, g, '투점', '2'),
      ev(22, g, '투점', '2A'),
    ]),
    ev(22, 5, '투점', '2A'),
    ev(22, 5, '투점', '2A'),
    ev(22, 5, '투점', '2A'),
    ev(22, 5, '투점', '2A'),

    // 적은경기: 2경기뿐(g1,g2). 직전 g1,g2 각 '3','3','3A','3A','3A' → 4/10=40.0.
    //          이번 g1 '3','3','3A','3A','3A' / g2 '3','3','3','3A','3A' → 5/10=50.0.
    ...[1, 2].flatMap((g) => [
      ev(21, g, '적은경기', '3'),
      ev(21, g, '적은경기', '3'),
      ev(21, g, '적은경기', '3A'),
      ev(21, g, '적은경기', '3A'),
      ev(21, g, '적은경기', '3A'),
    ]),
    ev(22, 1, '적은경기', '3'),
    ev(22, 1, '적은경기', '3'),
    ev(22, 1, '적은경기', '3A'),
    ev(22, 1, '적은경기', '3A'),
    ev(22, 1, '적은경기', '3A'),
    ev(22, 2, '적은경기', '3'),
    ev(22, 2, '적은경기', '3'),
    ev(22, 2, '적은경기', '3'),
    ev(22, 2, '적은경기', '3A'),
    ev(22, 2, '적은경기', '3A'),

    // 신입: R1 엔 없음(직전 0경기 — v3 리뷰 H1 대응, 'no-prev' 를 실제로 밟게 하는 선수).
    // 이번 매경기(g1~g5) '3'+'3A' → 5/10=50.0.
    ...[1, 2, 3, 4, 5].flatMap((g) => [ev(22, g, '신입', '3'), ev(22, g, '신입', '3A')]),
  ];

  // ── 표 M — metric = 'fg3Pct' (min 10) ────────────────────────────
  {
    const r = growthReport(RATE_EVENTS, RCOMPS, 22, 'fg3Pct');
    if (!r) fail('M growthReport 가 null');
    else {
      eq('M current.games', r.current.games, 5);
      eq('M previous.games', r.previous?.games, 5);
      eq('M previous.label', r.previous?.label, 'R1');
      eq('M goneCount', r.goneCount, 0);
      eq('M rows.length', r.rows.length, 10);
      eq('M metric', r.metric, 'fg3Pct');
      eq('M kinds.fg3Pct', r.kinds.fg3Pct, 'rate');
      eq('M kinds.eff', r.kinds.eff, 'perGame');
      eq('M betterWhen.fg3Pct', r.betterWhen.fg3Pct, 'higher');
      eq('M minGames', r.minGames, 3);
      eq('M minAttempts.fg3Pct', r.minAttempts.fg3Pct, 10);
      eq('M minAttempts.fg2Pct', r.minAttempts.fg2Pct, 20);
      eq('M minAttempts.eff', r.minAttempts.eff, 0);
      eq('M tinyBaseCount', r.tinyBaseCount, 0);

      const 영점 = row(r.rows, '영점');
      if (!영점) fail('M 영점 행 없음');
      else {
        // **영점이 1위인 게 이 요구의 심장이다** — 상대 증가율이었다면 0으로 나눠야 해서
        // 계산 불가(from-zero)였을 선수가, 단순 차이에서는 당당히 1위다.
        eq('M 영점 fg3Pct prev', 영점.metrics.fg3Pct.prev, 0.0);
        eq('M 영점 fg3Pct curr', 영점.metrics.fg3Pct.curr, 20.0);
        eq('M 영점 fg3Pct pct(from-zero 아님)', 영점.metrics.fg3Pct.pct, 20.0);
        eq('M 영점 fg3Pct basis', 영점.metrics.fg3Pct.basis, 'ok');
        eq('M 영점 qualified', 영점.qualified, true);
        eq('M 영점 unqualifiedBy', 영점.unqualifiedBy, 'none');
        eq('M 영점 rank', 영점.rank, 1);
      }

      const 슈터 = row(r.rows, '슈터');
      if (!슈터) fail('M 슈터 행 없음');
      else {
        eq('M 슈터 fg3Pct pct', 슈터.metrics.fg3Pct.pct, 10.0);
        eq('M 슈터 qualified(경계 정확 10/10)', 슈터.qualified, true);
        eq('M 슈터 rank', 슈터.rank, 2);
      }

      const 하락 = row(r.rows, '하락');
      if (!하락) fail('M 하락 행 없음');
      else {
        eq('M 하락 fg3Pct pct', 하락.metrics.fg3Pct.pct, -10.0);
        eq('M 하락 rank', 하락.rank, 3);
      }

      const 반올림 = row(r.rows, '반올림');
      if (!반올림) fail('M 반올림 행 없음');
      else {
        // 이중 반올림: 66.7 − 33.3 = 33.400000000000006(부동소수 먼지) → round1 없으면 다른 값.
        eq('M 반올림 fg3Pct prev', 반올림.metrics.fg3Pct.prev, 33.3);
        eq('M 반올림 fg3Pct curr', 반올림.metrics.fg3Pct.curr, 66.7);
        eq('M 반올림 fg3Pct pct(이중 반올림)', 반올림.metrics.fg3Pct.pct, 33.4);
        eq('M 반올림 prevGames/currGames(경계값)', `${반올림.prevGames}/${반올림.currGames}`, '3/3');
        // 경기 수는 통과(3>=3)인데 시도(3)가 min(10) 에 못 미친다 — v3.1 리뷰 N1 정정(볼드/괄호 모순 → attempts).
        eq('M 반올림 unqualifiedBy(경기 통과·시도 탈락)', 반올림.unqualifiedBy, 'attempts');
        eq('M 반올림 rank', 반올림.rank, null);
      }

      const 경계미달 = row(r.rows, '경계미달');
      if (!경계미달) fail('M 경계미달 행 없음');
      else {
        eq('M 경계미달 fg3Pct prev', 경계미달.metrics.fg3Pct.prev, 44.4);
        eq('M 경계미달 fg3Pct curr', 경계미달.metrics.fg3Pct.curr, 55.6);
        eq('M 경계미달 fg3Pct pct(이중 반올림)', 경계미달.metrics.fg3Pct.pct, 11.2);
        eq('M 경계미달 unqualifiedBy', 경계미달.unqualifiedBy, 'attempts');
        eq('M 경계미달 rank', 경계미달.rank, null);
      }

      const 적은경기 = row(r.rows, '적은경기');
      if (!적은경기) fail('M 적은경기 행 없음');
      else {
        eq('M 적은경기 fg3Pct pct', 적은경기.metrics.fg3Pct.pct, 10.0);
        // 시도는 자격(10/10)인데 경기 수(2)가 MIN_GAMES(3) 에 못 미친다 — AND 조건 증명.
        eq('M 적은경기 unqualifiedBy(시도 통과·경기 탈락)', 적은경기.unqualifiedBy, 'games');
        eq('M 적은경기 rank', 적은경기.rank, null);
      }

      const 무시도 = row(r.rows, '무시도');
      if (!무시도) fail('M 무시도 행 없음');
      else {
        // prev·curr 는 살아 있는 쪽을 그대로 싣는다 — 지어서 지우지 않는다.
        eq('M 무시도 fg3Pct prev', 무시도.metrics.fg3Pct.prev, null);
        eq('M 무시도 fg3Pct curr', 무시도.metrics.fg3Pct.curr, 50.0);
        eq('M 무시도 fg3Pct basis', 무시도.metrics.fg3Pct.basis, 'no-attempts');
        eq('M 무시도 unqualifiedBy', 무시도.unqualifiedBy, 'attempts');
        eq('M 무시도 rank', 무시도.rank, null);
      }

      const 이번무시도 = row(r.rows, '이번무시도');
      if (!이번무시도) fail('M 이번무시도 행 없음');
      else {
        eq('M 이번무시도 fg3Pct prev', 이번무시도.metrics.fg3Pct.prev, 50.0);
        eq('M 이번무시도 fg3Pct curr', 이번무시도.metrics.fg3Pct.curr, null);
        eq('M 이번무시도 fg3Pct basis', 이번무시도.metrics.fg3Pct.basis, 'no-attempts');
        eq('M 이번무시도 unqualifiedBy', 이번무시도.unqualifiedBy, 'attempts');
      }

      const 신입 = row(r.rows, '신입');
      if (!신입) fail('M 신입 행 없음');
      else {
        // v3 구멍 H1 대응: 'no-prev' 를 허용 목록이 아니라 실측으로 확인한다.
        eq('M 신입 fg3Pct basis', 신입.metrics.fg3Pct.basis, 'no-prev');
        eq('M 신입 fg3Pct prev', 신입.metrics.fg3Pct.prev, null);
        eq('M 신입 isNew', 신입.isNew, true);
        // 직전 0경기 + 직전 시도 0 → 둘 다 탈락.
        eq('M 신입 unqualifiedBy(경기·시도 둘 다 탈락)', 신입.unqualifiedBy, 'both');
      }

      const 투점 = row(r.rows, '투점');
      if (!투점) fail('M 투점 행 없음');
      else {
        eq('M 투점 fg3Pct prev', 투점.metrics.fg3Pct.prev, null);
        eq('M 투점 fg3Pct curr', 투점.metrics.fg3Pct.curr, null);
        eq('M 투점 fg3Pct basis', 투점.metrics.fg3Pct.basis, 'no-attempts');
        eq('M 투점 unqualifiedBy', 투점.unqualifiedBy, 'attempts');
      }

      // 모든 행에서 value === metrics.fg3Pct.pct, qualified === (unqualifiedBy === 'none').
      for (const x of r.rows) {
        eq(`M ${x.player} value===metrics.fg3Pct.pct`, x.value, x.metrics.fg3Pct.pct);
        eq(`M ${x.player} qualified===(unqualifiedBy==='none')`, x.qualified, x.unqualifiedBy === 'none');
      }

      eq(
        'M 정렬 순서',
        r.rows.map((x: GrowthRow) => x.player).join(','),
        '영점,슈터,하락,반올림,경계미달,적은경기,무시도,신입,이번무시도,투점',
      );
    }
  }

  // ── 표 N — metric = 'fg2Pct' (min 20) ────────────────────────────
  {
    const r = growthReport(RATE_EVENTS, RCOMPS, 22, 'fg2Pct');
    if (!r) fail('N growthReport 가 null');
    else {
      eq('N metric', r.metric, 'fg2Pct');
      eq('N kinds.fg2Pct', r.kinds.fg2Pct, 'rate');
      eq('N betterWhen.fg2Pct', r.betterWhen.fg2Pct, 'higher');
      eq('N minAttempts.fg2Pct', r.minAttempts.fg2Pct, 20);
      eq('N tinyBaseCount', r.tinyBaseCount, 0);

      const 투점 = row(r.rows, '투점');
      if (!투점) fail('N 투점 행 없음');
      else {
        eq('N 투점 fg2Pct prev', 투점.metrics.fg2Pct.prev, 40.0);
        eq('N 투점 fg2Pct curr', 투점.metrics.fg2Pct.curr, 60.0);
        eq('N 투점 fg2Pct pct', 투점.metrics.fg2Pct.pct, 20.0);
        eq('N 투점 qualified(경계 정확 20/20)', 투점.qualified, true);
        eq('N 투점 unqualifiedBy', 투점.unqualifiedBy, 'none');
        eq('N 투점 rank', 투점.rank, 1);
      }

      const 무시도 = row(r.rows, '무시도');
      if (!무시도) fail('N 무시도 행 없음');
      else {
        eq('N 무시도 fg2Pct prev(5/5)', 무시도.metrics.fg2Pct.prev, 100.0);
        eq('N 무시도 fg2Pct curr', 무시도.metrics.fg2Pct.curr, null);
        eq('N 무시도 fg2Pct basis', 무시도.metrics.fg2Pct.basis, 'no-attempts');
      }

      const 이번무시도 = row(r.rows, '이번무시도');
      if (!이번무시도) fail('N 이번무시도 행 없음');
      else {
        eq('N 이번무시도 fg2Pct prev', 이번무시도.metrics.fg2Pct.prev, null);
        eq('N 이번무시도 fg2Pct curr(5/5)', 이번무시도.metrics.fg2Pct.curr, 100.0);
        eq('N 이번무시도 fg2Pct basis', 이번무시도.metrics.fg2Pct.basis, 'no-attempts');
      }

      const 신입 = row(r.rows, '신입');
      if (!신입) fail('N 신입 행 없음');
      else {
        eq('N 신입 fg2Pct basis', 신입.metrics.fg2Pct.basis, 'no-prev');
      }

      // [신설: 2026-07-28 17:00, 김병현 작성] v3.1 리뷰 N6 — 표 N 에 unqualifiedBy 열을 더한다.
      // '적은경기' 는 fg3Pct(표 M)에선 시도가 자격(10/10)이라 'games' 뿐이었는데, fg2Pct(표 N)는
      // 애초에 2점 시도가 0 이라 'both' 로 갈린다 — "unqualifiedBy 가 요청 지표에 따라 달라진다"를
      // 증명하는 최고의 재료(표 M 과 표 N 이 같은 선수에서 다른 답을 낸다).
      const 적은경기 = row(r.rows, '적은경기');
      if (!적은경기) fail('N 적은경기 행 없음');
      else eq('N 적은경기 unqualifiedBy(fg2 시도 0 → both, fg3 은 games)', 적은경기.unqualifiedBy, 'both');

      // 나머지(3점만 쏘고 2점은 한 번도 안 쏜 5명) — 경기 수는 통과인데 fg2 시도가 0이라 'attempts'.
      for (const name of ['슈터', '하락', '영점', '경계미달', '반올림']) {
        const r2 = row(r.rows, name);
        if (!r2) fail(`N ${name} 행 없음`);
        else {
          eq(`N ${name} fg2Pct basis`, r2.metrics.fg2Pct.basis, 'no-attempts');
          eq(`N ${name} unqualifiedBy(fg2 시도 0, 경기는 통과)`, r2.unqualifiedBy, 'attempts');
        }
      }

      eq(
        'N 정렬 순서',
        r.rows.map((x: GrowthRow) => x.player).join(','),
        '투점,경계미달,무시도,슈터,신입,영점,이번무시도,하락,반올림,적은경기',
      );
    }
  }

  // ── 표 P — 불변식 + 경계 집중(표 M·N 픽스처 재사용) ─────────────────
  {
    const m = growthReport(RATE_EVENTS, RCOMPS, 22, 'fg3Pct');
    const n = growthReport(RATE_EVENTS, RCOMPS, 22, 'fg2Pct');
    if (!m || !n) fail('P growthReport 가 null');
    else {
      // 표 M·N 의 모든 행에서 성공률 지표의 basis 가 'ok'|'no-prev'|'no-attempts' 뿐이다
      // (= from-zero·both-zero·tiny-base 0건). '신입' 덕에 'no-prev' 도 실제로 등장한다(허용 목록이 아니라 실측).
      const RATE_BASES = new Set(['ok', 'no-prev', 'no-attempts']);
      let sawNoPrev = false;
      for (const x of m.rows) {
        if (!RATE_BASES.has(x.metrics.fg3Pct.basis)) fail(`P ${x.player} fg3Pct.basis 불변식 위반: ${x.metrics.fg3Pct.basis}`);
        if (x.metrics.fg3Pct.basis === 'no-prev') sawNoPrev = true;
      }
      for (const x of n.rows) {
        if (!RATE_BASES.has(x.metrics.fg2Pct.basis)) fail(`P ${x.player} fg2Pct.basis 불변식 위반: ${x.metrics.fg2Pct.basis}`);
      }
      eq('P no-prev 가 실제로 등장(신입)', sawNoPrev, true);

      const 영점 = row(m.rows, '영점');
      if (!영점) fail('P 영점 행 없음');
      else {
        eq('P 영점 fg3Pct basis(직전 0.0% 는 정상값)', 영점.metrics.fg3Pct.basis, 'ok');
        eq('P 영점 fg3Pct pct', 영점.metrics.fg3Pct.pct, 20.0);
      }

      const 반올림 = row(m.rows, '반올림');
      const 경계미달 = row(m.rows, '경계미달');
      if (!반올림 || !경계미달) fail('P 반올림/경계미달 행 없음');
      else {
        eq('P 반올림 fg3Pct pct(반올림 순서)', 반올림.metrics.fg3Pct.pct, 33.4);
        eq('P 경계미달 fg3Pct pct(반올림 순서)', 경계미달.metrics.fg3Pct.pct, 11.2);
      }

      const 슈터 = row(m.rows, '슈터');
      if (!슈터) fail('P 슈터 행 없음');
      else eq('P 슈터 qualified', 슈터.qualified, true);

      const 적은경기 = row(m.rows, '적은경기');
      if (!적은경기) fail('P 적은경기 unqualifiedBy(games)');
      else eq('P 적은경기 unqualifiedBy', 적은경기.unqualifiedBy, 'games');

      const 신입 = row(m.rows, '신입');
      if (!신입) fail('P 신입 행 없음');
      else eq('P 신입 unqualifiedBy', 신입.unqualifiedBy, 'both');
    }
  }

  // ── 표 Q — 정렬의 null 처리: 값이 있으면 음수라도 null 보다 앞이다 (구멍 M10, v3.1 구현 리뷰 D2) ──
  // [신설: 2026-07-28 18:00, 김병현 작성] growth.ts:419-421 의 세 줄(`av==null&&bv!=null→1` /
  // `bv==null&&av!=null→-1` / `av!==bv→bv-av`)을 `if (av !== bv) return bv - av;` 한 줄로 줄이는
  // 뮤턴트(M10)가 표 M~P 로는 안 잡혔다 — 그 표들의 미자격·값 있는 행이 전부 **양수**(+33.4/+11.2/
  // +10.0)라, `null` 이 `0` 으로 강제돼도 "값 있는 게 0보다 크니 먼저"라는 우연한 답이 나왔기
  // 때문이다. 여기서는 **미자격이면서 pct 가 음수**인 선수를 넣어 그 우연을 깬다: 음수(-33.4)는
  // `0` 보다 작아서, 뮤턴트의 "null→0 강제 비교"로는 값 있는 행이 null 행보다 **뒤로** 밀린다 —
  // 표 A~L 이 이미 증명한 "명시 분기가 필수"라는 growth.ts:413 의 설명이 이제 값으로도 증명된다.
  // 표 M(공유 픽스처)을 직접 고치지 않고 격리한 이유는 표 H~L 과 같다 — plan.md 의 정답 표 숫자를
  // 흔들지 않으면서 같은 뮤턴트를 잡을 수 있다.
  {
    const Q1: GrowthCompetition = { id: 51, year: 2039, seasonNo: 1, label: 'Q1', createdAt: new Date('2039-01-01T00:00:00Z') };
    const Q2: GrowthCompetition = { id: 52, year: 2039, seasonNo: 2, label: 'Q2', createdAt: new Date('2039-02-01T00:00:00Z') };
    const QCOMPS = [Q1, Q2];
    const QEVENTS: StatEvent[] = [
      // 마이너스: 직전 3경기 3점 2/3=66.7% → 이번 3경기 3점 1/3=33.3% (하락, pct=-33.4).
      // 시도 3<10 → 미자격(attempts). prevGames/currGames=3/3.
      ev(51, 1, '마이너스', '3'),
      ev(51, 2, '마이너스', '3'),
      ev(51, 3, '마이너스', '3A'),
      ev(52, 1, '마이너스', '3A'),
      ev(52, 2, '마이너스', '3A'),
      ev(52, 3, '마이너스', '3'),
      // 미시도: 3점 시도가 아예 없다(2점만 뜀) → fg3Pct basis 'no-attempts', value=null.
      // prevGames/currGames=3/3 — '마이너스' 와 경기 수까지 똑같이 맞춰 currGames 타이브레이크가
      // 끼어들 여지를 없앤다(오직 null-처리 규칙만으로 순서가 갈리게 만든다).
      ev(51, 1, '미시도', '2'),
      ev(51, 2, '미시도', '2'),
      ev(51, 3, '미시도', '2'),
      ev(52, 1, '미시도', '2'),
      ev(52, 2, '미시도', '2'),
      ev(52, 3, '미시도', '2'),
    ];
    const r = growthReport(QEVENTS, QCOMPS, 52, 'fg3Pct');
    if (!r) fail('Q growthReport 가 null');
    else {
      const 마이너스 = row(r.rows, '마이너스');
      const 미시도 = row(r.rows, '미시도');
      if (!마이너스 || !미시도) fail('Q 행 없음');
      else {
        eq('Q 마이너스 fg3Pct pct(음수)', 마이너스.metrics.fg3Pct.pct, -33.4);
        eq('Q 마이너스 fg3Pct basis', 마이너스.metrics.fg3Pct.basis, 'ok');
        eq('Q 마이너스 unqualifiedBy', 마이너스.unqualifiedBy, 'attempts');
        eq('Q 미시도 fg3Pct pct', 미시도.metrics.fg3Pct.pct, null);
        eq('Q 미시도 fg3Pct basis', 미시도.metrics.fg3Pct.basis, 'no-attempts');
        // 핵심 단언: 값이 있으면(음수라도) null 행보다 반드시 앞이다.
        eq('Q 정렬 순서(음수도 null 보다 앞)', r.rows.map((x: GrowthRow) => x.player).join(','), '마이너스,미시도');
      }
    }
  }

  if (failures === 0) {
    console.log(
      '✓ 검증 통과 — 시간축 정렬(표A), 메인 리포트·절댓값 분모·tiny-base·턴오버 방향·지표별 순위·' +
        '동률 타이브레이크·봉투 필드(표B), 첫 시즌(표C), 빈 직전 시즌(표D), 모르는 대회(표E), ' +
        '빈 이번 시즌(표F), 이중 반올림(표G), 이름 타이브레이크(표H), currGames 타이브레이크(표I), ' +
        'tinyBaseCount 자격무관(표J), MIN_GAMES 경계(표K), createdAt 타이브레이크·NaN 폴백(표L), ' +
        '카운트 탭 새 필드(표O), 성공률 3점(표M)·2점(표N)·불변식(표P), 정렬 null 처리(표Q) 전부 일치',
    );
    process.exit(0);
  } else {
    console.error(`\n검증 실패: ${failures}건 불일치`);
    process.exit(1);
  }
}

main();
