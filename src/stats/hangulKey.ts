// [신설: 2026-07-31 15:07, 김병현 작성] 한글 IME 를 켠 채로 스텟 코드를 친 값을 두벌식 자판대로
// "되돌리는" 순수 모듈이다. 농구도 사전(KNOWN_CODES)도 DB 도 Nest 도 전혀 모른다 — 이 파일이
// import 하는 건 아무것도 없다. "채택할지 말지"는 이 파일이 아니라 scoring.ts 의
// resolveStatCode() 가 정한다(사전 대조는 그쪽 책임).
//
// 검증: npm run check:hangul (scripts/check-hangul-codes.ts) — 표 36개 + 뮤턴트 6가지.
// 표를 눈으로 보고 싶으면(ASCII 만 있어 안전하게 복붙됨):
//   node -e "for(let i=0;i<51;i++)process.stdout.write(i+':'+String.fromCharCode(0x3131+i)+' ')"
//
// ⚠⚠ 이 파일의 코드 줄에는 한글을 단 한 글자도 쓰지 않는다. 전부 코드포인트 산술로 다룬다.
//   이유 세 가지:
//   (1) 눈으로 구분이 안 된다. U+3150 과 U+3152 는 폰트에 따라 거의 똑같이 보인다.
//       한 칸만 밀려 적어도 리뷰에서 절대 못 잡는다.
//   (2) 조용히 깨진다. 에디터·포매터·복붙 과정에서 자모가 정규화(NFC/NFD)되면 다른 코드포인트가
//       되는데, 문법 오류가 안 나서 아무도 모른다.
//   (3) 이 레포에서 같은 종류의 사고가 이미 다섯 번 났다(자세한 일화는 계획서 §7 갓차 G1).
//   → 그래서 51칸 표는 '글쇠 문자열(ASCII)'만 담고, 어느 자모인지는 U+3131 부터의 순서로만 정한다.
//     이 규칙은 check-hangul-codes.ts 가 소스를 직접 읽어 기계로 검사한다(그룹4 T4 + 자가점검 T4-b).
//   (한국어 주석 자체는 당연히 쓴다. 금지 대상은 문자열·정규식 안의 한글이다.)

// 호환 자모 U+3131 ~ U+3163 (51칸) → 두벌식 글쇠.
// - 겹자모는 '두 글쇠'로 푼다        (예: idx 10 = U+313B → 'fa')
// - 쌍자음/쌍모음은 'shift 한 글쇠'다 (예: idx 1  = U+3132 → 'R'.  'rr' 이 아니다!)
// 배열 순서가 곧 코드포인트 순서다. 한 칸만 밀려도 전부 틀리니 check:hangul 이 51칸을 통째로 대조한다.
const COMPAT_JAMO_KEYS: readonly string[] = [
  // idx 0~9   : U+3131 ~ U+313A
  'r', 'R', 'rt', 's', 'sw', 'sg', 'e', 'E', 'f', 'fr',
  // idx 10~19 : U+313B ~ U+3144
  'fa', 'fq', 'ft', 'fx', 'fv', 'fg', 'a', 'q', 'Q', 'qt',
  // idx 20~29 : U+3145 ~ U+314E  (여기까지가 자음 30개)
  't', 'T', 'd', 'w', 'W', 'c', 'z', 'x', 'v', 'g',
  // idx 30~39 : U+314F ~ U+3158  (여기부터 모음 21개)
  'k', 'o', 'i', 'O', 'j', 'p', 'u', 'P', 'h', 'hk',
  // idx 40~49 : U+3159 ~ U+3162
  'ho', 'hl', 'y', 'n', 'nj', 'np', 'nl', 'b', 'm', 'ml',
  // idx 50    : U+3163
  'l',
];

const CONSONANT_COUNT = 30; // idx 0~29 가 자음, 30~50 이 모음

// 완성형 음절(U+AC00~U+D7A3)은 (초성, 중성, 종성) 세 조각이 규칙적으로 곱해진 것이다.
//   idx = cp - 0xAC00;  초성 = idx / 588,  중성 = (idx % 588) / 28,  종성 = idx % 28 (0이면 받침 없음)
// 문제: 초성/종성 순서는 위 51칸 표 순서와 '다르게 건너뛴다'.
//   - 초성 19개 = 자음 30개에서 겹자음 11개(U+3133 U+3135 U+3136 U+313A~U+3140 U+3144)를 뺀 것
//   - 종성 27개 = 자음 30개에서 U+3138·U+3143·U+3149(쌍디귿·쌍비읍·쌍지읒) 세 개를 뺀 것
//   - 중성 21개 = 51칸 표의 idx 30~50 과 '완전히 같은 순서' → 다리가 필요 없다(30 + 중성번호)
// 그래서 초성·종성만 '몇 번째 칸인가' 다리를 놓는다.
//   초성 다리·중성 산술은 유니코드 NFKD 로 교차 검증된다(T2).
//   ⚠ 종성 다리는 NFKD 로 검증이 안 된다(호환자모를 NFKD 하면 '초성형'이 나온다) — 대신 T3(51칸 표
//     기준 재구성)과 T5(NFD 산술)가 양쪽에서 조인다. 자세한 건 check-hangul-codes.ts 그룹4.
const CHOSEONG_TO_COMPAT: readonly number[] = [
  0, 1, 3, 6, 7, 8, 16, 17, 18, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29,
];
const JONGSEONG_TO_COMPAT: readonly number[] = [
  0, 1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 19, 20, 21, 22, 23, 25, 26, 27, 28, 29,
];

/**
 * 한글로 찍힌 글자를 원래 눌렀을 두벌식 글쇠로 되돌린다.
 *
 * - 한글이 아닌 글자(숫자·영문·기호)는 '그대로' 통과시킨다. 그래서 '2' + U+313B → '2fa' 처럼
 *   중간에 한영 전환을 한 값도 자연스럽게 처리된다.
 * - 되돌릴 한글이 하나도 없으면 null. "아무것도 안 했다"를 호출자가 다시 판별하지 않게 하려는 것이다.
 *   ⚠ 이 null 이 "순수 ASCII 는 절대 안 건드린다"는 약속을 지키는 자리다. 지우지 말 것.
 * - 대소문자는 안 건드린다(글쇠 그대로). 대문자 통일은 부르는 쪽(normalizeCode)이 한다.
 * - 표에 없는 한글(옛한글·채움 문자 U+3164 등)은 손대지 않고 통과시킨다.
 *
 * [계약 2가지 — 모듈 밖에서 여기에 기대고 있다. 바꾸면 계획서 §6-b 증명이 깨진다]
 *  (1) 길이가 줄지 않는다: 한글 한 글자는 반드시 글쇠 1개 이상을 낸다(겹자모 2개, 음절 2~3개).
 *      "사전 최장 코드가 3글자니 길이 3까지만 훑으면 전부 훑은 것"이라는 논거의 뼈대다.
 *  (2) 미리 조합된(NFC) 한글만 다룬다. 맥에서 만든 파일에 흔한 조합형(NFD, U+1100 계열)은
 *      표 밖이라 손대지 않고 null 이 나온다. 실무 영향은 0 이다 — 실제로 변환되는 41가지는
 *      전부 호환 자모(U+3131~)라 NFC/NFD 에 안 흔들린다.
 *      확인: node -e "console.log(String.fromCharCode(0x3141).normalize('NFD').length)"  →  1
 */
export function hangulToQwerty(text: string): string | null {
  let out = '';
  let touched = false;
  // for...of 는 코드포인트 단위로 돈다(서로게이트 쌍 안전).
  for (const ch of text) {
    const cp = ch.codePointAt(0) as number;
    if (cp >= 0xac00 && cp <= 0xd7a3) {
      const idx = cp - 0xac00;
      const cho = Math.floor(idx / 588);
      const jung = Math.floor((idx % 588) / 28);
      const jong = idx % 28;
      out +=
        COMPAT_JAMO_KEYS[CHOSEONG_TO_COMPAT[cho]] +
        COMPAT_JAMO_KEYS[CONSONANT_COUNT + jung] +
        (jong > 0 ? COMPAT_JAMO_KEYS[JONGSEONG_TO_COMPAT[jong - 1]] : '');
      touched = true;
    } else if (cp >= 0x3131 && cp <= 0x3163) {
      out += COMPAT_JAMO_KEYS[cp - 0x3131];
      touched = true;
    } else {
      out += ch;
    }
  }
  return touched ? out : null;
}

// ⚠ jong - 1 을 조심할 것. 종성 번호는 1부터 시작하고(0 = 받침 없음), 배열은 0부터다.
// 이 한 칸이 어긋나면 받침 있는 글자가 전부 틀어진다 — 그래서 check:hangul 뮤턴트 ⑥ 이 이걸 노린다.
