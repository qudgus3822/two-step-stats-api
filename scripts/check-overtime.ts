/**
 * [신설: 2026-07-29 11:40, 김병현 작성] 연장경기 흡수(mergeOvertimeGames) 검증 스크립트.
 *
 * DB·Nest 없이 순수 함수만 직접 부른다(check-synergy.ts 와 같은 스타일:
 * 수동 fail/eq 헬퍼 + process.exit(0|1), jest 아님).
 *
 * 무엇을 못 박는가:
 *  - 쿼터 2개 이하 경기는 같은 주차 직전 경기에 흡수된다(경기 수가 준다)
 *  - 흡수돼도 득점은 한 점도 안 사라진다(분모만 줄고 분자는 그대로)
 *  - 쿼터 번호는 앞 경기 뒤로 밀린다(4쿼터 경기 + 연장 = 5·6쿼터) — 같은 쿼터 번호가 두 번
 *    나오는 경기를 만들지 않는다
 *  - 연장이 연달아 둘이면 둘 다 같은 앞 경기에 붙고 쿼터는 계속 뒤로 밀린다
 *  - 주차의 '첫' 경기가 짧으면 흡수할 앞 경기가 없으므로 그대로 정규경기로 남는다
 *  - 3쿼터까지만 기록된 경기는 연장이 아니다(경계값 — 실제 데이터에 이런 경기가 있다)
 *  - 주차·대회 경계를 안 넘는다(다른 주차의 앞 경기로 빨려가지 않는다)
 *  - 연장이 없는 입력은 배열을 새로 만들지 않는다(같은 참조를 돌려준다)
 *
 * 검증 관점: "경기 수가 줄었다"만 보면 득점을 통째로 날려도 통과한다. 그래서 경기 수와
 * 총득점을 항상 같이 확인한다.
 */
import { mergeOvertimeGames, gameKey, listPlayers } from '../src/stats/aggregate';
import { StatEvent } from '../src/stats/types';

// 픽스처 이벤트 한 줄.
const ev = (
  week: number,
  game: number,
  quarter: number,
  player: string,
  stat: string,
  team = 'OB',
  competitionId = 1,
): StatEvent => ({
  competitionId,
  competitionLabel: 'test',
  week,
  game,
  quarter,
  player,
  stat,
  team,
});

// 4쿼터짜리 정규경기 한 판 — 쿼터 1~4에 2점씩(=8점).
const fullGame = (week: number, game: number, player: string, competitionId = 1): StatEvent[] =>
  [1, 2, 3, 4].map((q) => ev(week, game, q, player, '2', 'OB', competitionId));

// 2쿼터짜리 연장 한 판 — 쿼터 1~2에 2점씩(=4점).
const overtimeGame = (week: number, game: number, player: string, competitionId = 1): StatEvent[] =>
  [1, 2].map((q) => ev(week, game, q, player, '2', 'OB', competitionId));

let failures = 0;
function fail(msg: string): void {
  failures++;
  console.error(`✗ ${msg}`);
}
function eq(label: string, actual: unknown, expected: unknown): void {
  if (actual !== expected) fail(`${label}: 기대 ${String(expected)} / 실제 ${String(actual)}`);
}

// 이벤트 묶음의 서로 다른 경기 수
const gameCount = (events: StatEvent[]): number => new Set(events.map(gameKey)).size;
// 이벤트 묶음의 총득점 ('2' 만 쓰는 픽스처라 개수 × 2)
const totalPts = (events: StatEvent[]): number =>
  events.filter((e) => e.stat === '2').length * 2;

function main(): void {
  // ── A. 기본: 정규 2경기 + 연장 1경기 → 2경기로 줄고 득점은 그대로 ──────────
  {
    const raw = [
      ...fullGame(3, 1, '갑'), // 8점
      ...fullGame(3, 2, '갑'), // 8점
      ...overtimeGame(3, 3, '갑'), // 4점 — g2 의 연장
    ];
    const merged = mergeOvertimeGames(raw);

    eq('A 흡수 전 경기 수', gameCount(raw), 3);
    eq('A 흡수 후 경기 수', gameCount(merged), 2);
    eq('A 총득점 보존', totalPts(merged), totalPts(raw));
    eq('A 총득점 값', totalPts(merged), 20);

    // 연장 이벤트가 g2 소속으로 바뀌고, 쿼터는 5·6 으로 밀렸는지
    const ot = merged.filter((e) => e.quarter > 4);
    eq('A 연장 이벤트 수', ot.length, 2);
    eq('A 연장 소속 경기', ot.every((e) => e.game === 2), true);
    eq('A 연장 쿼터 = 5,6', ot.map((e) => e.quarter).sort().join(','), '5,6');

    // 흡수된 경기에 같은 쿼터 번호가 두 번 나오면 안 된다
    const g2 = merged.filter((e) => e.game === 2);
    eq('A g2 이벤트 수', g2.length, 6);
    eq('A g2 쿼터 중복 없음', new Set(g2.map((e) => e.quarter)).size, 6);

    // 실제 화면 지표까지 — 경기당 평균이 4.0(20/5) 이 아니라 10.0(20/2) 이어야 한다
    const [row] = listPlayers(merged);
    eq('A listPlayers 경기 수', row.games, 2);
    eq('A listPlayers 누적 득점', row.pts, 20);
    eq('A listPlayers 경기당 평균', row.ppg, 10);
  }

  // ── B. 연장이 연달아 둘 → 둘 다 같은 앞 경기에 붙고 쿼터는 계속 밀린다 ──────
  {
    const raw = [
      ...fullGame(1, 1, '갑'),
      ...overtimeGame(1, 2, '갑'),
      ...overtimeGame(1, 3, '갑'),
    ];
    const merged = mergeOvertimeGames(raw);

    eq('B 경기 수', gameCount(merged), 1);
    eq('B 총득점 보존', totalPts(merged), totalPts(raw));
    eq('B 전부 g1 소속', merged.every((e) => e.game === 1), true);
    eq(
      'B 쿼터 = 1..8',
      merged.map((e) => e.quarter).sort((a, b) => a - b).join(','),
      '1,2,3,4,5,6,7,8',
    );
  }

  // ── C. 주차 첫 경기가 짧으면 흡수할 앞 경기가 없다 → 그대로 남는다 ──────────
  {
    const raw = [...overtimeGame(2, 1, '갑'), ...fullGame(2, 2, '갑')];
    const merged = mergeOvertimeGames(raw);

    eq('C 경기 수 유지', gameCount(merged), 2);
    eq('C 총득점 보존', totalPts(merged), totalPts(raw));
    eq('C 쿼터 안 밀림', merged.filter((e) => e.game === 1).every((e) => e.quarter <= 2), true);
  }

  // ── D. 3쿼터까지 기록된 경기는 연장이 아니다(경계값) ────────────────────────
  //  실제 데이터에 있다: 2024 시즌4 w4, 2026 시즌1 w3 — 이벤트 양이 정상인 진짜 경기다.
  {
    const threeQuarters = [1, 2, 3].map((q) => ev(5, 2, q, '갑', '2'));
    const raw = [...fullGame(5, 1, '갑'), ...threeQuarters];
    const merged = mergeOvertimeGames(raw);

    eq('D 3쿼터 경기는 유지', gameCount(merged), 2);
    eq('D 총득점 보존', totalPts(merged), totalPts(raw));
    eq('D 배열 그대로(연장 없음)', merged, raw); // 참조까지 동일
  }

  // ── E. 주차·대회 경계를 안 넘는다 ──────────────────────────────────────────
  {
    // 1주차는 정규 1경기, 2주차는 짧은 경기 하나뿐 → 2주차 것이 1주차로 빨려가면 안 된다
    const raw = [...fullGame(1, 1, '갑'), ...overtimeGame(2, 1, '갑')];
    const merged = mergeOvertimeGames(raw);
    eq('E 주차 경계 유지', gameCount(merged), 2);

    // 같은 주차·같은 경기 번호라도 대회가 다르면 남남
    const raw2 = [...fullGame(1, 1, '갑', 1), ...overtimeGame(1, 2, '갑', 2)];
    const merged2 = mergeOvertimeGames(raw2);
    eq('E 대회 경계 유지', gameCount(merged2), 2);
    eq('E 대회2 연장 그대로', merged2.filter((e) => e.competitionId === 2).every((e) => e.game === 2), true);
  }

  // ── F. 연장이 없으면 배열을 새로 만들지 않는다(불필요한 복사 방지) ──────────
  {
    const raw = [...fullGame(1, 1, '갑'), ...fullGame(1, 2, '갑')];
    eq('F 같은 참조 반환', mergeOvertimeGames(raw), raw);
  }

  // ── G. 입력을 건드리지 않는다(순수 함수) ───────────────────────────────────
  {
    const raw = [...fullGame(3, 1, '갑'), ...overtimeGame(3, 2, '갑')];
    const before = raw.map((e) => `${e.game}:${e.quarter}`).join('|');
    mergeOvertimeGames(raw);
    eq('G 입력 불변', raw.map((e) => `${e.game}:${e.quarter}`).join('|'), before);
  }

  if (failures === 0) {
    console.log(
      '✓ 검증 통과 — 연장 흡수(경기 수 ↓·득점 보존), 쿼터 밀기, 연속 연장, 첫 경기 예외, 3쿼터 경계, 주차/대회 경계, 무복사, 입력 불변',
    );
    process.exit(0);
  } else {
    console.error(`\n검증 실패: ${failures}건 불일치`);
    process.exit(1);
  }
}

main();
