/**
 * [신설: 2026-07-29 21:20, 김병현 작성] 선수 이름 규칙(playerCheck.ts) 검증 스크립트.
 *
 * DB·Nest 없이 `normalizePlayerName` / `findNewPlayers` 만 직접 부른다(check-growth.ts 와
 * 같은 스타일: 수동 fail/eq 헬퍼 + process.exit(0|1), jest 아님 — 이 레포엔 jest/vitest 가 없다).
 *
 * ⚠ 이 파일은 `npm run build`(= nest build) 로 타입 검사가 안 된다. `tsconfig.build.json` 이
 *   `scripts` 디렉터리를 exclude 하기 때문이다. 반드시 `npm run check:newplayers`(ts-node) 로
 *   직접 돌려서 확인할 것.
 *
 * ⚠⚠ 이 파일의 테스트 입력에 든 유령문자(전각공백·NBSP·ZWSP·ZWNJ·ZWJ·BOM)도 반드시
 *    \uXXXX 이스케이프로 적는다. 리터럴로 박으면 이 표가 뭘 검사하는지 아무도 읽을 수 없고,
 *    포매터가 먹으면 조용히 다른 걸 검사하게 된다(playerCheck.ts 헤더와 같은 이유).
 *
 * 정답 표 (총 21개):
 *  그룹1 normalizePlayerName — P1(가운데 공백) P2(앞뒤+탭) P3(전각공백) P4(NBSP)
 *    P5(폭없는공백 3종) P6(BOM·공백만·접미어·영문·하이픈 보존 — N1 사고 안전망)
 *  그룹2 findNewPlayers — A(기존이름0명 건너뜀) B(전부 아는이름) C(오타1글자) D(옛데이터 방어)
 *    E(중복1건+순서유지) F(대소문자만다름) G(안비슷함) H(제안 최대3+가나다) I(대상1글자)
 *    J(원문그대로) K(빈문자열무시) L(길이차2+) M(편집거리2,같은길이) N(rank0우선) O(후보1글자제외)
 *
 * 일부러 깨 보기(6가지) — 구현자가 실제로 playerCheck.ts 에 넣고 `npm run check:newplayers` 가
 * 빨간불을 내는 걸 확인한 뒤 되돌렸다:
 *  ① `if (knownNames.length === 0) return []` 삭제 → 표 A
 *  ② `normalizePlayerName` 을 `raw.trim()` 으로 축소 → 표 P1·P3·P4·P5
 *  ③ `isWithinOneEdit` 의 `edits > 1` → `edits > 2` → 표 M (⚠ 표 G/L 로는 안 잡힘)
 *  ④ `scored.sort` 에서 `x.rank - y.rank` 삭제 → 표 N (⚠ 표 H 로는 안 잡힘)
 *  ⑤ 판정을 `knownExact` 대신 정규화 Set 으로 바꾸기 → 표 D
 *  ⑥ `knownForSuggest` 의 `.filter(k => k.norm.length >= MIN_COMPARE_LENGTH)` 삭제 → 표 O (⚠ 표 I 로는 안 잡힘)
 */
import { normalizePlayerName, findNewPlayers } from '../src/stats/playerCheck';

function main(): void {
  let failures = 0;
  const fail = (msg: string) => {
    failures++;
    console.error(`  ✗ ${msg}`);
  };
  const eq = (label: string, got: unknown, want: unknown) => {
    const gotStr = JSON.stringify(got);
    const wantStr = JSON.stringify(want);
    if (gotStr !== wantStr) fail(`${label}: 기대 ${wantStr}, 실제 ${gotStr}`);
  };

  // ── 그룹1 — normalizePlayerName (표 P1~P6) ──────────────────────
  eq('P1 가운데 공백 제거', normalizePlayerName('김 병현'), '김병현');
  eq('P2 앞뒤 공백+탭 제거', normalizePlayerName('  김병현\t'), '김병현');
  eq('P3 전각 공백 제거', normalizePlayerName('김\u3000병현'), '김병현');
  eq('P4 NBSP 제거', normalizePlayerName('김\u00A0병현'), '김병현');
  eq('P5 폭없는공백 3종 제거', normalizePlayerName('김\u200B병\u200C현\u200D'), '김병현');
  eq('P6 BOM 제거', normalizePlayerName('김\uFEFF병현'), '김병현');
  eq('P6 공백만이면 빈 문자열', normalizePlayerName('   '), '');
  eq('P6 접미어 유지', normalizePlayerName('김진우1'), '김진우1');
  eq('P6 영문 유지', normalizePlayerName('Kevin'), 'Kevin');
  eq('P6 하이픈 보존(N1 사고 안전망)', normalizePlayerName('김-병현'), '김-병현');

  // ── 그룹2 — findNewPlayers (표 A~O) ─────────────────────────────
  eq('A 기존이름 0명이면 검사 건너뜀', findNewPlayers(['김병현', '홍길동'], []), []);
  eq('B 전부 아는 이름', findNewPlayers(['김병현'], ['김병현', '홍길동']), []);
  eq(
    'C 오타 1글자 → 신규+제안',
    findNewPlayers(['김병헌'], ['김병현', '홍길동']),
    [{ name: '김병헌', suggestions: ['김병현'] }],
  );
  eq(
    'D 옛 데이터 방어(공백 든 기존 이름)',
    findNewPlayers(['김병현'], ['김 병현']),
    [{ name: '김병현', suggestions: ['김 병현'] }],
  );
  eq(
    'E 같은 파일 안 중복 1건, 순서 유지',
    findNewPlayers(['박신입', '김병현', '박신입', '최신입'], ['김병현']).map((p) => p.name),
    ['박신입', '최신입'],
  );
  eq(
    'F 대소문자만 다름 → 신규+제안',
    findNewPlayers(['kevin'], ['Kevin', '홍길동']),
    [{ name: 'kevin', suggestions: ['Kevin'] }],
  );
  eq(
    'G 안 비슷하면 제안 없음',
    findNewPlayers(['홍길동'], ['김병현']),
    [{ name: '홍길동', suggestions: [] }],
  );
  eq(
    'H 제안 최대 3개 + 가나다 정렬',
    findNewPlayers(['김병현'], ['김병연', '김병훈', '김병준', '김병찬', 'KIM'])[0]?.suggestions,
    ['김병연', '김병준', '김병찬'],
  );
  eq(
    'I 대상(새 이름) 1글자면 제안 안 만듦',
    findNewPlayers(['가'], ['나', '다']),
    [{ name: '가', suggestions: [] }],
  );
  eq('J 결과 name 이 입력과 글자 그대로 같음', findNewPlayers(['김병현'], ['홍길동'])[0]?.name, '김병현');
  eq('K 빈 문자열은 무시', findNewPlayers(['', '박신입'], ['김병현']).length, 1);
  eq('K 빈 문자열은 무시(남은 건 박신입)', findNewPlayers(['', '박신입'], ['김병현'])[0]?.name, '박신입');
  eq(
    'L 길이 차이 2 이상은 제안 아님(조기 탈락)',
    findNewPlayers(['김병'], ['김병현우']),
    [{ name: '김병', suggestions: [] }],
  );
  eq(
    'M 편집거리 2는 제안 아님(같은 길이)',
    findNewPlayers(['김철수'], ['김병현']),
    [{ name: '김철수', suggestions: [] }],
  );
  eq(
    'N rank 0(대소문자만 다름)이 가나다보다 먼저',
    findNewPlayers(['kevin'], ['aevin', 'Kevin'])[0]?.suggestions,
    ['Kevin', 'aevin'],
  );
  eq(
    'O 후보(기존 이름)가 1글자면 제안에서 빠짐',
    findNewPlayers(['가나'], ['가', '홍길동']),
    [{ name: '가나', suggestions: [] }],
  );

  if (failures === 0) {
    console.log(
      '✓ 검증 통과 — normalizePlayerName 공백류 6종(표P1~P6) + findNewPlayers 신규판정·제안·' +
        '정렬·길이가드·중복제거·빈문자열(표A~O) 총 21개 표 전부 일치',
    );
    process.exit(0);
  } else {
    console.error(`\n검증 실패: ${failures}건 불일치`);
    process.exit(1);
  }
}

main();
