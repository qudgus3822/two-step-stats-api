/**
 * [신설: 2026-07-27 16:14, 김병현 작성] 시너지(Synergy) 순수 모듈 검증 스크립트.
 *
 * DB·Nest 없이 `synergyReport` 만 직접 부른다(check-legacy-import.ts 와 같은 스타일:
 * 수동 fail/eq 헬퍼 + process.exit(0|1), jest 아님).
 *
 * 무엇을 못 박는가:
 *  - 상대팀 배제(같은 경기라도 팀이 다르면 동료가 아니다)
 *  - 함께/따로 분할과 그 경기당 평균 계산
 *  - 표본 자격 경계(함께 ≥3, 따로 ≥1) + apartGames=0(null 경로)
 *  - 델타 반올림(표시되는 값끼리 뺀 뒤 다시 반올림) — 표 E 가 부동소수 먼지를 일부러 심어 확인
 *  - 정렬·랭킹(자격자 먼저 → 델타(방향 반영) → 함께 경기 수 → 이름) — 표 E·F 가 방향을 확인
 *  - 기록지 오타 시 동작(표 D — 한 경기에서 기준 선수가 두 팀에 기록되면 상대팀 배제가 뚫린다).
 *    이건 버그가 아니라 데이터 문제라 "이런 입력이면 이렇게 된다"를 값으로 기록만 해 둔다.
 *    화면 고지(AC 42)로 안내한다.
 */
import { synergyReport } from '../src/stats/synergy';
import { StatEvent } from '../src/stats/types';

// 픽스처 이벤트 한 줄. 전부 같은 대회/주차라 game 번호만 다르면 다른 경기다.
const ev = (game: number, player: string, stat: string, team: string): StatEvent => ({
  competitionId: 1,
  competitionLabel: 'test',
  week: 1,
  game,
  quarter: 1,
  player,
  stat,
  team,
});

// 정답 표 A~D 의 공통 픽스처(계획서 plan.md "정답 표" 절과 값이 같다).
// g1~g3: 기준·동료1·항상 이 OB, 상대 가 YB(맞대결). g4: 동료1 대신 동료2 가 OB(+기준 턴오버 1개).
// g5: 동료1 이 YB 로 넘어가(=이 경기에선 동료 아님) 상대 와 같은 편이 된다 — "함께 3, 따로 2" 를 만드는 핵심 행.
const EVENTS: StatEvent[] = [
  // g1 — 기준 2점 2개(pts4/eff4), 동료1·항상 OB, 상대 YB
  ev(1, '기준', '2', 'OB'),
  ev(1, '기준', '2', 'OB'),
  ev(1, '동료1', '2', 'OB'),
  ev(1, '항상', '2', 'OB'),
  ev(1, '상대', '2', 'YB'),
  // g2 — g1과 동일 패턴
  ev(2, '기준', '2', 'OB'),
  ev(2, '기준', '2', 'OB'),
  ev(2, '동료1', '2', 'OB'),
  ev(2, '항상', '2', 'OB'),
  ev(2, '상대', '2', 'YB'),
  // g3 — g1과 동일 패턴
  ev(3, '기준', '2', 'OB'),
  ev(3, '기준', '2', 'OB'),
  ev(3, '동료1', '2', 'OB'),
  ev(3, '항상', '2', 'OB'),
  ev(3, '상대', '2', 'YB'),
  // g4 — 기준 2점 1개 + 턴오버 1개(pts2/eff1/tov1), 동료1 대신 동료2 가 OB
  ev(4, '기준', '2', 'OB'),
  ev(4, '기준', 'T', 'OB'),
  ev(4, '동료2', '2', 'OB'),
  ev(4, '항상', '2', 'OB'),
  ev(4, '상대', '2', 'YB'),
  // g5 — 기준 2점 1개(pts2/eff2). 동료1 이 이번엔 YB(=상대편) — 이 경기는 동료1과 "따로"
  ev(5, '기준', '2', 'OB'),
  ev(5, '항상', '2', 'OB'),
  ev(5, '동료1', '2', 'YB'),
  ev(5, '상대', '2', 'YB'),
];

// 표 D 전용: 기록지 오타로 기준 선수가 g1에서 두 팀(OB·YB) 모두에 기록된 경우.
const EVENTS_TYPO: StatEvent[] = [...EVENTS, ev(1, '기준', '2', 'YB')];

// [신설: 2026-07-27 15:52, 김병현 작성] 표 E 전용 픽스처 — 표 A~D 가 못 밟는 두 규칙만 노린다.
//
// 왜 따로 만드나: 표 A~D 는 자격자가 '동료1' 한 명뿐이라 "자격자끼리 델타로 줄 세우기"가
// 아예 안 돌고(→ 방향 dir 무방비), 모든 델타가 딱 떨어져 부동소수 먼지가 안 생긴다
// (→ 바깥 round1 무방비). 기존 기대값을 건드리지 않으려고 픽스처를 새로 판다.
//
// (A) 자격자 2명: 동료A(함께 g1~g3 = T3/A2), 동료B(함께 g1,g2,g4,g5 = T4/A1). 둘 다 자격 통과.
//     기준의 턴오버를 g4·g5 에만 2개씩 두어 tov 델타 부호를 반대로 만든다
//     → 동료A −2.0(같이 뛰면 실책 줄어듦), 동료B +1.0(늘어남).
//     tov 는 낮을수록 좋으므로 정상이면 동료A 가 1위. BETTER_WHEN.tov 를 'higher' 로 뒤집으면
//     순서가 반드시 뒤집힌다 → 방향 로직이 진짜 도는지 잡힌다.
// (B) 기준의 수비 리바운드를 g1·g2·g4 에 하나씩 두면 동료A 의 reb 이
//     함께 2/3경기 = 0.7, 따로 1/2경기 = 0.5 가 된다. 0.7 − 0.5 는 자바스크립트에서
//     0.19999999999999996 이라 바깥 round1 이 없으면 0.2 와 달라 빨간불이 난다(gotcha 4).
const EVENTS_SORT: StatEvent[] = [
  // g1 — 기준 2점1 + 수비리바1. 동료A·동료B 둘 다 OB(=둘 다와 함께)
  ev(1, '기준', '2', 'OB'),
  ev(1, '기준', 'DR', 'OB'),
  ev(1, '동료A', '2', 'OB'),
  ev(1, '동료B', '2', 'OB'),
  // g2 — g1과 동일 패턴
  ev(2, '기준', '2', 'OB'),
  ev(2, '기준', 'DR', 'OB'),
  ev(2, '동료A', '2', 'OB'),
  ev(2, '동료B', '2', 'OB'),
  // g3 — 동료A만 OB(동료B는 이 경기에 없음 → 동료B의 유일한 "따로" 경기)
  ev(3, '기준', '2', 'OB'),
  ev(3, '동료A', '2', 'OB'),
  // g4 — 동료B만 OB. 기준 턴오버 2 + 수비리바1 (동료A와는 "따로")
  ev(4, '기준', 'T', 'OB'),
  ev(4, '기준', 'T', 'OB'),
  ev(4, '기준', 'DR', 'OB'),
  ev(4, '동료B', '2', 'OB'),
  // g5 — 동료B만 OB. 기준 턴오버 2 (동료A와는 "따로")
  ev(5, '기준', 'T', 'OB'),
  ev(5, '기준', 'T', 'OB'),
  ev(5, '동료B', '2', 'OB'),
];

function main(): void {
  let failures = 0;
  const fail = (msg: string) => {
    failures++;
    console.error(`  ✗ ${msg}`);
  };
  const eq = (label: string, got: unknown, want: unknown) => {
    if (got !== want) fail(`${label}: 기대 ${JSON.stringify(want)}, 실제 ${JSON.stringify(got)}`);
  };
  // 제네릭으로 둬야 실제 넘어온 SynergyRow[] 의 전체 필드(togetherGames 등)가 그대로 유지된다.
  // { teammate: string }[] 로만 받으면 반환 타입이 그 부분 타입으로 좁혀져 나머지 필드가 사라진다.
  function row<T extends { teammate: string }>(rows: T[], name: string): T | undefined {
    return rows.find((r) => r.teammate === name);
  }

  // ── 표 A — synergyReport(events, '기준', 'eff') ─────────────────────
  {
    const r = synergyReport(EVENTS, '기준', 'eff');
    eq('A games', r.games, 5);
    eq('A overall.pts', r.overall.pts, 3.2);
    eq('A overall.eff', r.overall.eff, 3.0);
    eq('A overall.tov', r.overall.tov, 0.2);
    eq('A overall.reb', r.overall.reb, 0);
    eq('A overall.ast', r.overall.ast, 0);
    eq('A overall.stl', r.overall.stl, 0);
    eq('A overall.blk', r.overall.blk, 0);

    eq('A rows.length', r.rows.length, 3);
    eq('A 상대 부재', row(r.rows, '상대'), undefined);

    for (const rw of r.rows) {
      eq(`A ${rw.teammate} together+apart=games`, rw.togetherGames + rw.apartGames, r.games);
    }

    const t1 = row(r.rows, '동료1');
    if (!t1) fail('A 동료1 행 없음');
    else {
      eq('A 동료1 함께', t1.togetherGames, 3);
      eq('A 동료1 따로', t1.apartGames, 2);
      eq('A 동료1 qualified', t1.qualified, true);
      eq('A 동료1 rank', t1.rank, 1);
      eq('A 동료1 value', t1.value, 2.5);
      eq('A 동료1 eff 함께', t1.metrics.eff.together, 4.0);
      eq('A 동료1 eff 따로', t1.metrics.eff.apart, 1.5);
      eq('A 동료1 eff 델타', t1.metrics.eff.delta, 2.5);
      eq('A 동료1 pts 델타', t1.metrics.pts.delta, 2.0);
      eq('A 동료1 tov 델타', t1.metrics.tov.delta, -0.5);
    }

    const t2 = row(r.rows, '동료2');
    if (!t2) fail('A 동료2 행 없음');
    else {
      eq('A 동료2 함께', t2.togetherGames, 1);
      eq('A 동료2 따로', t2.apartGames, 4);
      eq('A 동료2 qualified', t2.qualified, false);
      eq('A 동료2 rank', t2.rank, null);
      eq('A 동료2 eff 델타', t2.metrics.eff.delta, -2.5);
      eq('A 동료2 pts 델타', t2.metrics.pts.delta, -1.5);
      eq('A 동료2 tov 델타', t2.metrics.tov.delta, 1.0);
    }

    const always = row(r.rows, '항상');
    if (!always) fail('A 항상 행 없음');
    else {
      eq('A 항상 함께', always.togetherGames, 5);
      eq('A 항상 따로', always.apartGames, 0);
      eq('A 항상 qualified', always.qualified, false); // 따로 0경기 → 자격 미달(비교 기준선 없음)
      eq('A 항상 rank', always.rank, null);
      eq('A 항상 eff 함께', always.metrics.eff.together, 3.0);
      eq('A 항상 eff 따로', always.metrics.eff.apart, null);
      eq('A 항상 eff 델타', always.metrics.eff.delta, null);
      eq('A 항상 value', always.value, null);
    }

    // 정렬 순서: 자격자(동료1) 먼저 → 미자격은 값 있는 쪽(동료2) 먼저 → null(항상) 맨 뒤.
    eq('A 정렬 순서', r.rows.map((x) => x.teammate).join(','), '동료1,동료2,항상');
  }

  // ── 표 B — synergyReport(events, '기준', 'tov') (방향이 lower) ─────
  {
    const r = synergyReport(EVENTS, '기준', 'tov');
    const t1 = row(r.rows, '동료1');
    if (!t1) fail('B 동료1 행 없음');
    else {
      eq('B 동료1 value', t1.value, -0.5);
      eq('B 동료1 rank', t1.rank, 1); // 자격자 중 유일 → tov 는 낮을수록 좋아 -0.5 가 1위
      eq('B 동료1.tov.together', t1.metrics.tov.together, 0.0);
      eq('B 동료1.tov.apart', t1.metrics.tov.apart, 0.5);
      eq('B 동료1.tov.delta', t1.metrics.tov.delta, -0.5);
    }
  }

  // ── 표 C — 없는 이름 ────────────────────────────────────────────
  {
    const r = synergyReport(EVENTS, '없는선수', 'eff');
    eq('C player', r.player, '없는선수');
    eq('C games', r.games, 0);
    eq('C rows.length', r.rows.length, 0);
    eq('C overall.eff', r.overall.eff, 0);
  }

  // ── 표 D — 기록지 오타(한 경기에서 기준 선수가 두 팀에 기록됨) ──────
  // 결정 1의 상대팀 배제가 자연스럽게 뚫리는 유일한 경로. 버그가 아니라 데이터 문제이므로
  // "이런 입력이면 이렇게 된다"를 값으로 기록만 해 둔다(화면 고지는 AC 42 담당).
  {
    const r = synergyReport(EVENTS_TYPO, '기준', 'eff');
    eq('D games(여전히 5)', r.games, 5);
    const opponent = row(r.rows, '상대');
    if (!opponent) fail('D 상대가 동료로 안 잡힘(오타 시나리오가 재현되지 않음)');
    else {
      eq('D 상대.togetherGames', opponent.togetherGames, 1);
      // 오타가 나도 "함께+따로=전체" 항등식은 깨지지 않는다(분할이라서).
      for (const rw of r.rows) {
        eq(`D ${rw.teammate} together+apart=games`, rw.togetherGames + rw.apartGames, r.games);
      }
    }
  }

  // ── 표 E — 방향(dir) + 이중 반올림 전용 ───────────────────────────
  // 표 A~D 가 못 밟는 두 규칙만 노린다(EVENTS_SORT 주석 참고).
  //  E-1) 자격자 2명의 tov 델타 부호를 반대로 만들어 정렬 방향이 실제로 도는지 본다(AC 17).
  //  E-2) 델타에 부동소수 먼지를 심어 바깥 round1 이 없으면 깨지게 한다(AC 12 / gotcha 4).
  {
    const r = synergyReport(EVENTS_SORT, '기준', 'tov');
    eq('E games', r.games, 5);
    eq('E rows.length', r.rows.length, 2);

    const a = row(r.rows, '동료A');
    const b = row(r.rows, '동료B');
    if (!a || !b) fail('E 동료A/동료B 행 없음');
    else {
      // 자격자 2명이어야 "자격자끼리 델타 비교"가 실제로 실행된다.
      eq('E 동료A qualified', a.qualified, true);
      eq('E 동료B qualified', b.qualified, true);
      eq('E 동료A 함께/따로', `${a.togetherGames}/${a.apartGames}`, '3/2');
      eq('E 동료B 함께/따로', `${b.togetherGames}/${b.apartGames}`, '4/1');

      // E-1: tov 는 낮을수록 좋다 → 델타가 음수인 동료A 가 1위.
      // BETTER_WHEN.tov 를 'higher' 로 뒤집으면 아래 3개가 전부 빨개진다.
      eq('E 동료A tov 델타', a.metrics.tov.delta, -2.0);
      eq('E 동료B tov 델타', b.metrics.tov.delta, 1.0);
      eq('E tov 정렬 순서', r.rows.map((x) => x.teammate).join(','), '동료A,동료B');
      eq('E 동료A rank', a.rank, 1);
      eq('E 동료B rank', b.rank, 2);

      // E-2: 0.7 − 0.5 는 0.19999999999999996 이라 바깥 round1 을 지우면 여기서 빨개진다.
      eq('E 동료A reb 함께', a.metrics.reb.together, 0.7);
      eq('E 동료A reb 따로', a.metrics.reb.apart, 0.5);
      eq('E 동료A reb 델타(이중 반올림)', a.metrics.reb.delta, 0.2);
    }
  }

  // ── 표 F — 같은 픽스처를 'reb' 로 보면 순서가 뒤집힌다(방향이 아니라 값 때문) ──
  // tov 탭에서 1위였던 동료A 가 reb 탭에선 2위다(0.2 < 0.8). "지표마다 순위가 다르다"를 못 박는다.
  {
    const r = synergyReport(EVENTS_SORT, '기준', 'reb');
    eq('F reb 정렬 순서', r.rows.map((x) => x.teammate).join(','), '동료B,동료A');
    const b = row(r.rows, '동료B');
    if (!b) fail('F 동료B 행 없음');
    else {
      eq('F 동료B reb 델타', b.metrics.reb.delta, 0.8);
      eq('F 동료B rank', b.rank, 1);
      eq('F 동료B value=metrics 델타', b.value, b.metrics.reb.delta);
    }
  }

  if (failures === 0) {
    console.log(
      '✓ 검증 통과 — 상대팀 배제, 함께/따로 분할, 자격 경계, 이중 반올림(표E), 정렬 방향(표E·F), 기록지 오타(표D) 전부 일치',
    );
    process.exit(0);
  } else {
    console.error(`\n검증 실패: ${failures}건 불일치`);
    process.exit(1);
  }
}

main();
