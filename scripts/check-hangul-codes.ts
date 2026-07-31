/**
 * [신설: 2026-07-31 15:00, 김병현 작성] 한글 IME 로 친 스텟 코드 되돌리기(hangulKey.ts·
 * scoring.ts 의 resolveStatCode) 검증 스크립트.
 *
 * DB·Nest 없이 `hangulToQwerty` / `resolveStatCode` / `KNOWN_CODES` 만 직접 부른다
 * (check-new-players.ts 와 같은 스타일: 수동 fail/eq 헬퍼 + process.exit(0|1), jest 아님
 * — 이 레포엔 jest/vitest 가 없다).
 *
 * ⚠ 이 파일은 `npm run build`(= nest build) 로 타입 검사가 안 된다. `tsconfig.build.json` 이
 *   `scripts` 디렉터리를 exclude 하기 때문이다. 반드시 `npm run check:hangul`(ts-node) 로
 *   직접 돌려서 확인할 것.
 *
 * ⚠⚠ 이 파일의 코드 줄에도 (eq/fail 라벨 말고는) 한글 리터럴을 쓰지 않는다. 표준 표기는
 *   `String.fromCharCode(...)` 다(아래 jm() 헬퍼). \uXXXX 이스케이프도 되지만, 앞 작업
 *   구현자가 "이스케이프 표기를 생성하다 진짜 유니코드로 둔갑"하는 사고를 냈고, 이 계획서
 *   자신도 v3(리터럴 한글)·v4(이스케이프가 옮겨지다 한글로 둔갑) 두 번 더 같은 사고를 냈다
 *   — 이 레포에서 다섯 번째다. `String.fromCharCode` 는 인자가 전부 숫자라 그 사고가
 *   구조적으로 불가능하다. 기대값은 전부 ASCII 라 문제없다.
 *
 * ⚠ **"변환되는 한글은 41가지가 전부다."** 근거는 ① 되돌리기가 길이를 안 줄이고 사전
 *   최장 코드가 3글자(그래서 길이 1~3 스윕이면 전수다) ② 표 S6 이 그 전제를 매번 다시
 *   확인한다. → 스윕(S3) 범위를 줄이지 말 것.
 * ⚠ **`KNOWN_CODES` 를 늘리면 표 S6 이 먼저 빨간불을 낸다.** 4글자 코드나 [자음글쇠]→
 *   [모음글쇠] 인접쌍이 있는 코드(예: GK)를 넣는 순간이다. 그때는 S3 의 스윕 길이·알파벳도
 *   같이 늘려야 한다(계획서 §6-b, G14).
 * ⚠ **`seenTables` 와 `seen` 이 왜 있는지.** 이 레포에서 "아무것도 안 봤는데 초록불"이
 *   이미 네 번 났다(계획서 §9-a-2, G15). 표가 통째로 안 돌아도, 대량 루프가 0회 돌아도
 *   예전 방식(불일치 개수만 세기)이면 초록불이었다. `seenTables.size`(어느 표가 실제로
 *   돌았나) 와 각 대량 루프의 `훑은 수`(몇 개를 봤나) 를 매번 같이 단언해서 이 병을 막는다.
 *   지우지 말 것.
 *
 * 정답 표 (총 36개):
 *  그룹1 hangulToQwerty — H1(홑자모) H2(겹자음11) H3(쌍자음·쌍모음7) H4(겹모음7)
 *    H5(음절) H6(받침음절) H7(겹받침·겹모음음절) H8(순수ASCII→null) H9(섞인값) H10(표밖 한글)
 *  그룹2 resolveStatCode — C1~C15(사전 코드 15개, 소문자판·Shift판 각각)
 *  그룹3 부작용 스윕 — S1(ASCII 3글자 전수) S2(음절 전수) S3(길이1~3 전수, 41개 목록 대조)
 *    S4(사전 코드 통과) S5(미등록 ASCII 통과) S6(사전 성질 두 개 — 길이·인접쌍)
 *  그룹4 표 무결성 — T1(51칸 전체 대조) T2(NFKD 교차검증) T3(음절 재구성) T4(소스 한글
 *    리터럴 검사, AST 기반) T5(NFD 교차검증)
 *
 * ⚠⚠ T4 는 `ts.createSourceFile` + 리프 노드 순회로 짠다(스캐너를 손으로 훑는 `scan()`
 *   루프가 아니다). 손으로 짠 scan() 루프는 템플릿 리터럴의 `${}` 를 못 읽어 닫는 백틱이
 *   새 템플릿을 열고 그 뒤 코드를 통째로 삼킨다 — 이 스크립트 자신의 T4-b 테스트 소스에
 *   `${S}` 가 있어서, 이 실수를 그대로 두면 검사기가 자기 자신을 오탐하면서 동시에 그 뒤
 *   코드를 사실상 검사하지 않게 된다(review-v4.md §2 가 재현·확인). AST 방식은 주석은
 *   트리비아라 자동으로 빠지고 템플릿·정규식은 노드라 그대로 남아, 이 구멍이 없다.
 *   **T4-b 자가 점검이 T4(실제 파일 스캔) 보다 먼저 돈다** — T4-b 가 하나라도 깨지면
 *   T4 결과를 믿을 수 없으니 실제 파일 스캔 자체를 건너뛴다.
 *
 * 일부러 깨 보기(6가지) — 구현자가 실제로 hangulKey.ts 에 넣고 `npm run check:hangul` 이
 * 빨간불을 내는 걸 확인한 뒤 되돌렸다:
 *  ① COMPAT_JAMO_KEYS[1](U+3132) 을 'R' → 'rr' → 표 H3 + C14·C15 Shift 케이스
 *  ② idx 10(U+313B) 을 'fa' → 'f' → 표 H2 + C6·C7
 *  ③ resolveStatCode 에서 사전 대조 없이 무조건 채택 → 표 S2·S3
 *  ④ hangulToQwerty 가 null 대신 항상 원본 반환 → 표 H8
 *  ⑤ 중성 인덱스를 CONSONANT_COUNT + jung → 29 + jung → 표 T3·H5·H6·H7
 *  ⑥ 종성 인덱스를 [jong - 1] → [jong] → 표 T3·H6·H7
 */
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import { hangulToQwerty } from '../src/stats/hangulKey';
import { resolveStatCode, KNOWN_CODES } from '../src/stats/scoring';

// 호환 자모 한 칸을 코드포인트 산술로 만든다(리터럴 한글 금지 — 위 헤더 참고).
// jm(0)=U+3131(ㄱ) ... jm(50)=U+3163(ㅣ). hangulKey.ts 의 51칸 표와 같은 인덱스 규칙이다.
function jm(i: number): string {
  return String.fromCharCode(0x3131 + i);
}

// 51칸 "정답" 배열 — hangulKey.ts 의 COMPAT_JAMO_KEYS 를 import 하지 않고 여기 독립적으로
// 다시 적는다(그 배열은 export 되지 않는다 — export 는 hangulToQwerty 하나뿐이어야 한다).
// T1·T2·T3·S6 이 전부 이 독립된 답안지를 기준으로 hangulToQwerty 의 실제 동작을 대조한다.
const EXPECTED_51: readonly string[] = [
  'r', 'R', 'rt', 's', 'sw', 'sg', 'e', 'E', 'f', 'fr',
  'fa', 'fq', 'ft', 'fx', 'fv', 'fg', 'a', 'q', 'Q', 'qt',
  't', 'T', 'd', 'w', 'W', 'c', 'z', 'x', 'v', 'g',
  'k', 'o', 'i', 'O', 'j', 'p', 'u', 'P', 'h', 'hk',
  'ho', 'hl', 'y', 'n', 'nj', 'np', 'nl', 'b', 'm', 'ml',
  'l',
];

// S3 스윕용 알파벳 113자 = 숫자10 + 영문 대소문자52 + 호환자모51.
const ALPHABET_113: string[] = [];
for (let i = 0; i <= 9; i++) ALPHABET_113.push(String.fromCharCode(48 + i)); // '0'..'9'
for (let i = 0; i < 26; i++) ALPHABET_113.push(String.fromCharCode(65 + i)); // 'A'..'Z'
for (let i = 0; i < 26; i++) ALPHABET_113.push(String.fromCharCode(97 + i)); // 'a'..'z'
for (let i = 0; i < 51; i++) ALPHABET_113.push(jm(i)); // 호환 자모 51개

// 보는 범위: 호환 자모(U+3130~U+318F) + 완성형 음절(U+AC00~U+D7A3).
// ⚠ 조합형 자모(U+1100~U+11FF, 맥 파일에 흔한 NFD)는 '안 본다' — 손으로 칠 일이 없어 뺐다.
//   hangulToQwerty 가 NFC 전용인 것과 같은 선택이다(계획서 §10-9).
function isHangulCp(cp: number): boolean {
  return (cp >= 0x3130 && cp <= 0x318f) || (cp >= 0xac00 && cp <= 0xd7a3);
}
function hasHangul(text: string): boolean {
  for (const ch of text) if (isHangulCp(ch.codePointAt(0) as number)) return true;
  return false;
}

// [변경: 2026-07-31 15:33, 김병현 수정] 구현 리뷰(impl-review.md D3) 반영 — 예외를 "인자 위치"가
//   아니라 "값이냐 메시지냐"로 넓힌다. eq/fail 라벨을 봐주는 이유("메시지일 뿐이라 틀려도 동작이
//   안 바뀐다")는 console.* 의 인자에도 글자 그대로 적용된다. 그래서 이 파일 자신의 성공/실패
//   배너·진단 문구도 한국어로 그대로 쓸 수 있게 console.* 인자 전체를 같이 봐준다.
//   ⚠⚠ 리뷰가 준 4줄 술어를 그대로 옮겨 붙이기 전에 실험부터 했다: `n.parent` 를 바로 확인하는
//   방식은 라벨/메시지에 `${}` 치환이 하나라도 들어가면 못 알아본다 — 치환이 있는 템플릿의
//   글자 조각은 부모가 CallExpression 이 아니라 TemplateSpan/TemplateExpression 이기 때문이다
//   (직접 `ts.createSourceFile` 로 찍어 확인함). 그 상태로 "그대로 써라"만 따랐으면 D1·D2 와
//   같은 종류의 "보호하는 척하는 코드"가 또 생겼을 것이다 — 그래서 아래처럼 템플릿 조각을
//   한 겹 벗겨 올라가는 `enclosingArgument` 를 추가했다. eq/fail 은 여전히 '0번째 인자만'
//   예외라(1번째 이후는 데이터라 계속 잡혀야 한다 — T4-b '라벨 다음 인자는 잡는다' 케이스가
//   이 경계를 지킨다), console.* 은 '인자 전부' 예외다.
function enclosingArgument(n: ts.Node): { call: ts.CallExpression; index: number } | null {
  let cur: ts.Node = n;
  let p = cur.parent;
  while (p !== undefined && (ts.isTemplateSpan(p) || ts.isTemplateExpression(p))) {
    cur = p;
    p = cur.parent;
  }
  if (p === undefined || !ts.isCallExpression(p)) return null;
  const index = p.arguments.indexOf(cur as ts.Expression);
  return index === -1 ? null : { call: p, index };
}

// T4 — 소스에 한글 리터럴이 있는지 코드 트리(AST)로 정확히 잡는다.
// 주석은 노드가 아니라 트리비아라 자동으로 빠진다. 문자열·템플릿·정규식 리터럴은 노드라
// 그대로 남는다 — 우리가 원하는 그대로다. eq/fail 의 라벨(첫 인자)과 console.* 의 인자만
// 예외로 둔다 — 둘 다 메시지일 뿐 틀려도 동작이 안 바뀌어서다. 그 외의 값 자리는 예외가 아니다.
function scanSource(src: string): number[] {
  const sf = ts.createSourceFile('x.ts', src, ts.ScriptTarget.Latest, true);
  const bad: number[] = [];
  const walk = (n: ts.Node): void => {
    if (n.getChildCount(sf) === 0) {
      const arg = enclosingArgument(n);
      const isLabel =
        arg !== null &&
        ts.isIdentifier(arg.call.expression) &&
        (arg.call.expression.text === 'eq' || arg.call.expression.text === 'fail') &&
        arg.index === 0;
      // [신설: 2026-07-31 15:33, 김병현 작성] console.log/error(...) 의 인자 전체(치환 포함)를 봐준다.
      const isConsoleMsg =
        arg !== null &&
        ts.isPropertyAccessExpression(arg.call.expression) &&
        ts.isIdentifier(arg.call.expression.expression) &&
        arg.call.expression.expression.text === 'console';
      if (!isLabel && !isConsoleMsg && hasHangul(n.getText(sf))) {
        bad.push(sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1);
      }
    }
    n.forEachChild(walk);
  };
  walk(sf);
  return bad;
}

function main(): void {
  let failures = 0;
  let checks = 0;
  const seenTables = new Set<string>(); // eq 라벨의 앞머리(표 이름)를 모은다. 예: 'T4 자가점검…' -> 'T4'
  const fail = (msg: string) => {
    failures++;
    console.error(`  ✗ ${msg}`);
  };
  const tableNameOf = (label: string): string => {
    const sp = label.indexOf(' ');
    return sp === -1 ? label : label.slice(0, sp);
  };
  const eq = (label: string, got: unknown, want: unknown) => {
    checks++;
    seenTables.add(tableNameOf(label));
    const gotStr = JSON.stringify(got);
    const wantStr = JSON.stringify(want);
    // [변경: 2026-07-31 15:33, 김병현 수정] D3 반영 — fail() 은 여전히 '0번째 인자만' 라벨
    //   예외라(1번째 이후는 값이라 계속 잡혀야 함), 이 템플릿 전체가 fail() 의 0번째 인자다.
    if (gotStr !== wantStr) fail(`${label}: 기대 ${wantStr}, 실제 ${gotStr}`);
  };

  // ── 그룹1 — hangulToQwerty (표 H1~H10) ──────────────────────────
  eq('H1 홑자모 ㄱ', hangulToQwerty(jm(0)), 'r');
  eq('H1 홑자모 ㄴ', hangulToQwerty(jm(3)), 's');
  eq('H1 홑자모 ㅁ', hangulToQwerty(jm(16)), 'a');
  eq('H1 홑자모 ㅇ', hangulToQwerty(jm(22)), 'd');
  eq('H1 홑자모 ㅏ', hangulToQwerty(jm(30)), 'k');
  eq('H1 홑자모 ㅣ', hangulToQwerty(jm(50)), 'l');

  eq('H2 겹자음 ㄳ', hangulToQwerty(jm(2)), 'rt');
  eq('H2 겹자음 ㄵ', hangulToQwerty(jm(4)), 'sw');
  eq('H2 겹자음 ㄶ', hangulToQwerty(jm(5)), 'sg');
  eq('H2 겹자음 ㄺ', hangulToQwerty(jm(9)), 'fr');
  eq('H2 겹자음 ㄻ', hangulToQwerty(jm(10)), 'fa');
  eq('H2 겹자음 ㄼ', hangulToQwerty(jm(11)), 'fq');
  eq('H2 겹자음 ㄽ', hangulToQwerty(jm(12)), 'ft');
  eq('H2 겹자음 ㄾ', hangulToQwerty(jm(13)), 'fx');
  eq('H2 겹자음 ㄿ', hangulToQwerty(jm(14)), 'fv');
  eq('H2 겹자음 ㅀ', hangulToQwerty(jm(15)), 'fg');
  eq('H2 겹자음 ㅄ', hangulToQwerty(jm(19)), 'qt');

  eq('H3 쌍자음 ㄲ', hangulToQwerty(jm(1)), 'R');
  eq('H3 쌍자음 ㄸ', hangulToQwerty(jm(7)), 'E');
  eq('H3 쌍자음 ㅃ', hangulToQwerty(jm(18)), 'Q');
  eq('H3 쌍자음 ㅆ', hangulToQwerty(jm(21)), 'T');
  eq('H3 쌍자음 ㅉ', hangulToQwerty(jm(24)), 'W');
  eq('H3 쌍모음 ㅒ', hangulToQwerty(jm(33)), 'O');
  eq('H3 쌍모음 ㅖ', hangulToQwerty(jm(37)), 'P');

  eq('H4 겹모음 ㅘ', hangulToQwerty(jm(39)), 'hk');
  eq('H4 겹모음 ㅙ', hangulToQwerty(jm(40)), 'ho');
  eq('H4 겹모음 ㅚ', hangulToQwerty(jm(41)), 'hl');
  eq('H4 겹모음 ㅝ', hangulToQwerty(jm(44)), 'nj');
  eq('H4 겹모음 ㅞ', hangulToQwerty(jm(45)), 'np');
  eq('H4 겹모음 ㅟ', hangulToQwerty(jm(46)), 'nl');
  eq('H4 겹모음 ㅢ', hangulToQwerty(jm(49)), 'ml');

  eq('H5 음절 가', hangulToQwerty(String.fromCodePoint(0xac00)), 'rk');
  eq('H6 음절 각(받침)', hangulToQwerty(String.fromCodePoint(0xac01)), 'rkr');
  eq('H7 음절 닭(겹받침)', hangulToQwerty(String.fromCodePoint(0xb2ed)), 'ekfr');
  eq('H7 음절 뷁(겹모음+겹받침)', hangulToQwerty(String.fromCodePoint(0xbdc1)), 'qnpfr');

  eq('H8 순수ASCII DR', hangulToQwerty('DR'), null);
  eq('H8 순수ASCII 2FA', hangulToQwerty('2FA'), null);
  eq('H8 순수ASCII ZZ', hangulToQwerty('ZZ'), null);
  eq('H8 순수ASCII 빈문자열', hangulToQwerty(''), null);

  eq('H9 섞인값 2+ㄻ', hangulToQwerty('2' + jm(10)), '2fa');
  eq('H9 섞인값 1+ㄹ+A', hangulToQwerty('1' + jm(8) + 'A'), '1fA');

  eq('H10 표밖 채움문자', hangulToQwerty(String.fromCharCode(0x3164)), null);
  eq(
    'H10 표밖 조합형NFD',
    hangulToQwerty(String.fromCharCode(0x1100, 0x1161, 0x11a8)),
    null,
  );

  // ── 그룹2 — resolveStatCode 사전 코드 15개 (표 C1~C15, 소문자판·Shift판 각 1건 = 30단언) ──
  eq('C1 소문자 1', resolveStatCode('1'), { code: '1', hangulSource: null });
  eq('C1 Shift 1', resolveStatCode('1'), { code: '1', hangulSource: null });
  eq('C2 소문자 2', resolveStatCode('2'), { code: '2', hangulSource: null });
  eq('C2 Shift 2', resolveStatCode('2'), { code: '2', hangulSource: null });
  eq('C3 소문자 3', resolveStatCode('3'), { code: '3', hangulSource: null });
  eq('C3 Shift 3', resolveStatCode('3'), { code: '3', hangulSource: null });
  eq('C4 소문자 1+ㄹ', resolveStatCode('1' + jm(8)), { code: '1F', hangulSource: '1' + jm(8) });
  eq('C4 Shift 1+ㄹ', resolveStatCode('1' + jm(8)), { code: '1F', hangulSource: '1' + jm(8) });
  eq('C5 소문자 2+ㄹ', resolveStatCode('2' + jm(8)), { code: '2F', hangulSource: '2' + jm(8) });
  eq('C5 Shift 2+ㄹ', resolveStatCode('2' + jm(8)), { code: '2F', hangulSource: '2' + jm(8) });
  eq('C6 소문자 1+ㄻ', resolveStatCode('1' + jm(10)), { code: '1FA', hangulSource: '1' + jm(10) });
  eq('C6 Shift 1+ㄻ', resolveStatCode('1' + jm(10)), { code: '1FA', hangulSource: '1' + jm(10) });
  eq('C7 소문자 2+ㄻ', resolveStatCode('2' + jm(10)), { code: '2FA', hangulSource: '2' + jm(10) });
  eq('C7 Shift 2+ㄻ', resolveStatCode('2' + jm(10)), { code: '2FA', hangulSource: '2' + jm(10) });
  eq('C8 소문자 2+ㅁ', resolveStatCode('2' + jm(16)), { code: '2A', hangulSource: '2' + jm(16) });
  eq('C8 Shift 2+ㅁ', resolveStatCode('2' + jm(16)), { code: '2A', hangulSource: '2' + jm(16) });
  eq('C9 소문자 3+ㅁ', resolveStatCode('3' + jm(16)), { code: '3A', hangulSource: '3' + jm(16) });
  eq('C9 Shift 3+ㅁ', resolveStatCode('3' + jm(16)), { code: '3A', hangulSource: '3' + jm(16) });
  eq('C10 소문자 ㅁ', resolveStatCode(jm(16)), { code: 'A', hangulSource: jm(16) });
  eq('C10 Shift ㅁ', resolveStatCode(jm(16)), { code: 'A', hangulSource: jm(16) });
  eq('C11 소문자 ㄴ', resolveStatCode(jm(3)), { code: 'S', hangulSource: jm(3) });
  eq('C11 Shift ㄴ', resolveStatCode(jm(3)), { code: 'S', hangulSource: jm(3) });
  eq('C12 소문자 ㅠ', resolveStatCode(jm(47)), { code: 'B', hangulSource: jm(47) });
  eq('C12 Shift ㅠ', resolveStatCode(jm(47)), { code: 'B', hangulSource: jm(47) });
  eq('C13 소문자 ㅅ', resolveStatCode(jm(20)), { code: 'T', hangulSource: jm(20) });
  eq('C13 Shift ㅆ', resolveStatCode(jm(21)), { code: 'T', hangulSource: jm(21) });
  eq('C14 소문자 ㅐ+ㄱ', resolveStatCode(jm(31) + jm(0)), { code: 'OR', hangulSource: jm(31) + jm(0) });
  eq('C14 Shift ㅒ+ㄲ', resolveStatCode(jm(33) + jm(1)), { code: 'OR', hangulSource: jm(33) + jm(1) });
  eq('C15 소문자 ㅇ+ㄱ', resolveStatCode(jm(22) + jm(0)), { code: 'DR', hangulSource: jm(22) + jm(0) });
  eq('C15 Shift ㅇ+ㄲ', resolveStatCode(jm(22) + jm(1)), { code: 'DR', hangulSource: jm(22) + jm(1) });

  // [신설] hangulSource 정의 확인(계획서 §3-c) — 앞뒤 공백 두 칸 + 소문자 f 섞은 값도
  // '되돌리기에 넣은 값'(normalizeCode 결과)을 hangulSource 로 돌려준다.
  eq('C7 hangulSource 정의(공백+소문자)', resolveStatCode('  2f' + jm(16) + '  '), {
    code: '2FA',
    hangulSource: '2F' + jm(16),
  });

  // ── 그룹3 — 부작용 스윕 (표 S1~S6) ──────────────────────────────
  let s1Seen = 0;
  let s1Bad = 0;
  for (let i = 32; i <= 126; i++) {
    const c1 = String.fromCharCode(i);
    for (let j = 32; j <= 126; j++) {
      const c2 = String.fromCharCode(j);
      for (let k = 32; k <= 126; k++) {
        const c3 = String.fromCharCode(k);
        s1Seen++;
        if (resolveStatCode(c1 + c2 + c3).hangulSource !== null) s1Bad++;
      }
    }
  }
  eq('S1 훑은 수(ASCII 3글자 전수)', s1Seen, 857375);
  eq('S1 변환 건수', s1Bad, 0);

  let s2Seen = 0;
  let s2Bad = 0;
  for (let cp = 0xac00; cp <= 0xd7a3; cp++) {
    s2Seen++;
    if (resolveStatCode(String.fromCodePoint(cp)).hangulSource !== null) s2Bad++;
  }
  eq('S2 훑은 수(음절 전수)', s2Seen, 11172);
  eq('S2 적중 개수', s2Bad, 0);

  let s3Seen = 0;
  const s3Hits = new Set<string>();
  for (const a of ALPHABET_113) {
    s3Seen++;
    if (resolveStatCode(a).hangulSource !== null) s3Hits.add(a);
  }
  for (const a of ALPHABET_113) {
    for (const b of ALPHABET_113) {
      s3Seen++;
      const combo = a + b;
      if (resolveStatCode(combo).hangulSource !== null) s3Hits.add(combo);
    }
  }
  for (const a of ALPHABET_113) {
    for (const b of ALPHABET_113) {
      for (const c of ALPHABET_113) {
        s3Seen++;
        const combo = a + b + c;
        if (resolveStatCode(combo).hangulSource !== null) s3Hits.add(combo);
      }
    }
  }
  eq('S3 훑은 수(길이1~3 전수)', s3Seen, 1455779);
  eq('S3 적중 개수', s3Hits.size, 41);

  // §6-b 의 41개 목록 — jm() 산술로만 구성한다(리터럴 한글 금지).
  const EXPECTED_41 = [
    jm(3), jm(16), jm(20), jm(21), jm(47),
    '1' + jm(8), '1' + jm(10), '2' + jm(8), '2' + jm(10), '2' + jm(16), '3' + jm(16),
    jm(22) + jm(0), jm(22) + jm(1), jm(22) + 'r', jm(22) + 'R',
    'd' + jm(0), 'd' + jm(1), 'D' + jm(0), 'D' + jm(1),
    jm(31) + jm(0), jm(31) + jm(1), jm(33) + jm(0), jm(33) + jm(1),
    jm(31) + 'r', jm(31) + 'R', jm(33) + 'r', jm(33) + 'R',
    'o' + jm(0), 'o' + jm(1), 'O' + jm(0), 'O' + jm(1),
    '1' + jm(8) + jm(16), '1' + jm(8) + 'A', '1' + jm(8) + 'a', '1F' + jm(16), '1f' + jm(16),
    '2' + jm(8) + jm(16), '2' + jm(8) + 'A', '2' + jm(8) + 'a', '2F' + jm(16), '2f' + jm(16),
  ];
  eq('S3 목록 개수(§6-b 정의)', EXPECTED_41.length, 41);
  let s3ListMismatch = 0;
  for (const v of EXPECTED_41) if (!s3Hits.has(v)) s3ListMismatch++;
  eq('S3 목록이 §6-b 와 일치', s3ListMismatch, 0);

  const DICT_CODES = ['1', '2', '3', '1F', '2F', '1FA', '2FA', '2A', '3A', 'A', 'S', 'B', 'T', 'OR', 'DR'];
  let s4Seen = 0;
  let s4Bad = 0;
  for (const code of DICT_CODES) {
    s4Seen++;
    const r1 = resolveStatCode(code);
    if (r1.code !== code || r1.hangulSource !== null) s4Bad++;
    s4Seen++;
    const r2 = resolveStatCode(code.toLowerCase());
    if (r2.code !== code || r2.hangulSource !== null) s4Bad++;
  }
  eq('S4 훑은 수(사전 코드 15×2)', s4Seen, 30);
  eq('S4 불일치', s4Bad, 0);

  // [변경: 2026-07-31 15:33, 김병현 수정] 구현 리뷰 D1 반영 — 예전엔 `eq(..., 2, 2)` 로 양쪽 다
  //   리터럴 상수였다(항등식이라 루프를 통째로 지워도 초록불). s5Seen 을 실제로 세게 고쳤다.
  let s5Seen = 0;
  let s5Bad = 0;
  for (const code of ['ZZ', 'R']) {
    s5Seen++;
    const r = resolveStatCode(code);
    if (r.code !== code || r.hangulSource !== null) s5Bad++;
  }
  eq('S5 훑은 수(미등록 ASCII)', s5Seen, 2);
  eq('S5 불일치', s5Bad, 0);

  // S6 — KNOWN_CODES 의 성질 두 개(§6-b 증명의 전제)가 지금도 참인지 기계로 다시 확인한다.
  // 두 글쇠 집합은 EXPECTED_51(51칸 정답표)에서 직접 유도한다(하드코딩 금지).
  const CONSONANT_KEYS = new Set<string>();
  for (let i = 0; i < 30; i++) if (EXPECTED_51[i].length === 1) CONSONANT_KEYS.add(EXPECTED_51[i].toUpperCase());
  const VOWEL_KEYS = new Set<string>();
  for (let i = 30; i < 51; i++) if (EXPECTED_51[i].length === 1) VOWEL_KEYS.add(EXPECTED_51[i].toUpperCase());
  eq('S6 자음 글쇠 개수', CONSONANT_KEYS.size, 14);
  eq('S6 모음 글쇠 개수', VOWEL_KEYS.size, 12);

  let s6MaxLen = 0;
  let s6AdjacentViolations = 0;
  for (const code of KNOWN_CODES) {
    s6MaxLen = Math.max(s6MaxLen, code.length);
    for (let i = 0; i < code.length - 1; i++) {
      if (CONSONANT_KEYS.has(code[i]) && VOWEL_KEYS.has(code[i + 1])) s6AdjacentViolations++;
    }
  }
  eq('S6 최장 코드 길이 ≤3', s6MaxLen <= 3, true);
  eq('S6 인접쌍([자음글쇠][모음글쇠]) 개수', s6AdjacentViolations, 0);

  // ── 그룹4 — 표 무결성 (표 T1~T5) ────────────────────────────────
  let t1Bad = 0;
  for (let i = 0; i < 51; i++) {
    if (hangulToQwerty(jm(i)) !== EXPECTED_51[i]) t1Bad++;
  }
  eq('T1 51칸 전체 대조', t1Bad, 0);

  // T2 — NFKD 교차검증. ⚠ 종성 27칸은 이 방식으로 검증이 안 된다(호환자모를 NFKD 하면
  // '초성형'이 나와서 종성형과 안 맞는다 — 27개 중 18개 불일치). 종성 다리는 T3(51칸 표
  // 기준 재구성)과 T5(NFD 산술) 두 개가 대신 지킨다. T2 혼자만 믿으면 안 된다.
  let choPos = 0;
  let t2ChoBad = 0;
  for (let idx = 0; idx < 30; idx++) {
    if (EXPECTED_51[idx].length !== 1) continue;
    const nfkd = jm(idx).normalize('NFKD');
    if ((nfkd.codePointAt(0) as number) !== 0x1100 + choPos) t2ChoBad++;
    choPos++;
  }
  eq('T2 초성 19칸 개수', choPos, 19);
  eq('T2 초성 NFKD 교차검증', t2ChoBad, 0);

  let t2JungBad = 0;
  for (let j = 0; j < 21; j++) {
    const nfkd = jm(30 + j).normalize('NFKD');
    if ((nfkd.codePointAt(0) as number) !== 0x1161 + j) t2JungBad++;
  }
  eq('T2 중성 21칸 NFKD 교차검증', t2JungBad, 0);

  const CHOSEONG_BRIDGE: number[] = [];
  for (let idx = 0; idx < 30; idx++) if (EXPECTED_51[idx].length === 1) CHOSEONG_BRIDGE.push(idx);
  const JONGSEONG_BRIDGE: number[] = [];
  for (let idx = 0; idx < 30; idx++) if (idx !== 7 && idx !== 18 && idx !== 24) JONGSEONG_BRIDGE.push(idx);
  eq('T3 초성 다리 길이', CHOSEONG_BRIDGE.length, 19);
  eq('T3 종성 다리 길이', JONGSEONG_BRIDGE.length, 27);

  let t3Seen = 0;
  let t3Bad = 0;
  for (let cp = 0xac00; cp <= 0xd7a3; cp++) {
    t3Seen++;
    const idx = cp - 0xac00;
    const cho = Math.floor(idx / 588);
    const jung = Math.floor((idx % 588) / 28);
    const jong = idx % 28;
    const expected =
      EXPECTED_51[CHOSEONG_BRIDGE[cho]] +
      EXPECTED_51[30 + jung] +
      (jong > 0 ? EXPECTED_51[JONGSEONG_BRIDGE[jong - 1]] : '');
    if (hangulToQwerty(String.fromCodePoint(cp)) !== expected) t3Bad++;
  }
  eq('T3 훑은 음절 수', t3Seen, 11172);
  eq('T3 재구성 불일치', t3Bad, 0);

  // T4-b — 검사기 자가 점검. 실제 파일 검사(T4) *전에* 돈다. 여기가 깨지면 T4 결과를
  // 믿지 않는다(스캐너를 잘못 배선하면 다시 "아무것도 안 봐도 초록불"이 될 수 있어서다).
  // [변경: 2026-07-31 15:33, 김병현 수정] 구현 리뷰 D4 반영 — `checks` 스냅샷 차이로 "이 블록이
  //   실제로 돌았나"까지 단언한다(별도 wrapper 함수를 새로 만들지 않는다 — `t4b(...)` 같은 새
  //   이름을 쓰면 그 이름이 `eq`/`fail` 이 아니라서 라벨 예외를 다시 넓혀야 하고, 그러면 D3 에서
  //   막 정리한 "예외는 값이 아니라 메시지에만" 경계가 또 흔들린다. `checks` 는 eq() 가 이미 매번
  //   세고 있는 값이라 공짜로 재사용된다). T4-b 라벨이 전부 'T4' 로 접혀 있어(§4-7 v4 설계),
  //   T4-b 를 통째로 지워도 seenTables 만으로는 36 이 그대로 유지돼 못 잡는다 — 그래서 필요하다.
  const failuresBeforeT4b = failures;
  const checksBeforeT4b = checks;
  const S = String.fromCharCode(0x314e); // 한글 한 글자(ASCII 로만 만든다) — 판별용 더미
  eq('T4 자가점검 코드 줄의 한글은 잡는다', scanSource(`const a = '${S}';`).length > 0, true);
  eq('T4 자가점검 주석 속 한글은 무시한다', scanSource(`// ${S} desc`).length > 0, false);
  eq('T4 자가점검 문자열 속 // 에 안 속는다', scanSource(`const b = '// ${S}';`).length > 0, true);
  eq('T4 자가점검 eq 라벨은 봐준다', scanSource(`eq('${S}', 1, 1);`).length > 0, false);
  eq('T4 자가점검 라벨 다음 인자는 잡는다', scanSource(`eq('ok', '${S}', 1);`).length > 0, true);
  // [변경: 2026-07-31 15:33, 김병현 수정] 구현 리뷰 D2 반영 — 예전 소스엔 한글이 0글자라 어떤
  //   구현으로 돌려도 결과가 0 이었다(항상 통과 = 무의미). 템플릿 뒤에 한글 한 글자짜리 주석을
  //   덧붙여, 치환이 삼켜지면 그 주석이 통째로 문자열/코드로 잘못 인식되어 실제로 적발되게 했다
  //   (고장난 scan() 방식으로 나란히 돌려 1건 적발 ↔ 이 AST 방식은 0건, 구분되는 것까지 확인함).
  eq(
    'T4 자가점검 템플릿 안 치환에 안 속는다',
    scanSource(
      'const c = `x' + '${1}' + 'y' + String.fromCharCode(96) + ';\n// ' + S + ' desc',
    ).length,
    0,
  );
  // [신설: 2026-07-31 15:33, 김병현 작성] 구현 리뷰 D3 반영 — console.* 예외의 경계 2케이스.
  // 라벨 예외를 5케이스로 지킨 것과 같은 방식: 봐주는 자리와 안 봐주는 자리를 나란히 확인한다.
  eq('T4 자가점검 console 문구는 봐준다', scanSource(`console.log('${S}');`).length > 0, false);
  eq(
    'T4 자가점검 console 밖 문자열은 잡는다',
    scanSource(`const m = '${S}'; console.log(m);`).length > 0,
    true,
  );
  eq('T4 자가점검 케이스 수', checks - checksBeforeT4b, 8);

  if (failures === failuresBeforeT4b) {
    const hangulKeySrc = fs.readFileSync(
      path.join(__dirname, '../src/stats/hangulKey.ts'),
      'utf8',
    );
    const selfSrc = fs.readFileSync(__filename, 'utf8');
    eq('T4 hangulKey.ts 한글 리터럴 적발', scanSource(hangulKeySrc).length, 0);
    eq('T4 check-hangul-codes.ts 자신 한글 리터럴 적발', scanSource(selfSrc).length, 0);
  } else {
    fail('T4-b 자가 점검 실패 — T4 실제 파일 검사를 건너뜁니다(결과를 신뢰할 수 없음)');
  }

  // T5 — 588/28 산술과 jong-1 오프셋을 유니코드 NFD 로 교차검증한다.
  // 51칸 표를 한 번도 안 본다 → 표를 잘못 베껴도 이 표는 독립적으로 빨간불을 낸다.
  let t5Seen = 0;
  let t5Bad = 0;
  for (let cp = 0xac00; cp <= 0xd7a3; cp++) {
    t5Seen++;
    const d = String.fromCodePoint(cp).normalize('NFD');
    const idx = cp - 0xac00;
    if ((d.codePointAt(0) as number) - 0x1100 !== Math.floor(idx / 588)) t5Bad++;
    else if ((d.codePointAt(1) as number) - 0x1161 !== Math.floor((idx % 588) / 28)) t5Bad++;
    else if ((d.length === 3 ? (d.codePointAt(2) as number) - 0x11a8 + 1 : 0) !== idx % 28) t5Bad++;
  }
  eq('T5 훑은 음절 수', t5Seen, 11172);
  eq('T5 NFD 교차검증 불일치', t5Bad, 0);

  // 표 커버리지 — "아무것도 안 봐도 초록불"을 막는 마지막 장치(§9-a-2, G15, AC 77).
  // MIN_CHECKS 같은 하한선이 아니다. seenTables 는 위에서 실제로 돈 eq 라벨의 앞머리를
  // 모은 Set 이라, 표가 통째로 안 돌면(예: T 그룹 전체 스킵) 정확히 그 개수만큼 모자라진다.
  const tableCount = seenTables.size; // eq() 가 '돈 표의 개수' 자체를 세는 순간 Set 을 한 번 더
  eq('돈 표의 개수', tableCount, 36); //   건드리므로, size 읽기는 그 호출 전에 미리 떠 둔다.

  // [변경: 2026-07-31 15:33, 김병현 수정] 구현 리뷰 D3 반영 — console.* 인자도 T4 예외가 됐으니
  //   다른 check-*.ts 관례대로 한국어로 되돌린다(단, 아래 두 메시지는 반드시 '+' 로 여러 조각을
  //   잇지 않고 템플릿 리터럴 하나로만 쓴다 — enclosingArgument 가 TemplateSpan/TemplateExpression
  //   만 벗기지 BinaryExpression('+')은 안 벗기므로, '+' 로 조각내면 그 조각은 예외에 안 걸려
  //   T4 에 잡힌다 — 즉 '탐지가 새는' 게 아니라 '이 파일이 자기 자신 때문에 빨간불이 나는' 쪽이다).
  if (failures === 0) {
    console.log(
      `OK - 표 ${tableCount}/36, 단언 ${checks}회 · hangulToQwerty(H1~H10) · resolveStatCode 사전코드(C1~C15) · 부작용 스윕(S1~S6) · 표 무결성(T1~T5, T4 는 AST 기반) 전부 일치`,
    );
    process.exit(0);
  } else {
    console.error(`\n검증 실패: ${failures}건 불일치 (표 ${tableCount}/36, 단언 ${checks}회)`);
    process.exit(1);
  }
}

main();
