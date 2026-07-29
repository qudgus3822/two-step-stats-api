// [신설: 2026-07-29 21:05, 김병현 작성] 선수 이름에 관한 규칙은 전부 여기 있다.
//   ① 어떻게 생겨야 하나 — normalizePlayerName (저장할 모양으로 만든다)
//   ② 처음 보는 이름은 누구인가 — findNewPlayers (업로드 확인 모달에 띄울 대상 판정)
// DB·Nest 를 전혀 모르는 순수 모듈이라 ts-node 로 그냥 부를 수 있다.
// 검증은 `npm run check:newplayers` (scripts/check-new-players.ts).
import { KnownName, NewPlayer } from './types';

// [신설: 2026-07-29 21:05, 김병현 작성] 선수 이름을 '저장할 모양'으로 만든다.
//
// 규칙 하나뿐: 공백을 전부 없앤다(앞뒤·가운데 가리지 않고).
// 왜 이렇게까지: 이름은 문자열 그대로 묶여서 집계된다. '김 병현' 과 '김병현' 이 따로 저장되면
// 화면엔 같은 사람이 두 명으로 보인다. 공백 차이는 100% 실수라 물어볼 필요조차 없다 — 그냥 없앤다.
//
// ⚠ 공백 '만' 없앤다. 오타 교정(김병헌 → 김병현)은 절대 안 한다 — 그건 사람이 정할 일이라
//   업로드 확인 모달로 물어본다(findNewPlayers). 진짜 신입일 수도 있으니까.
//
// 문자 클래스가 \s 보다 넓은 이유:
//   \s 는 스페이스·탭·개행에 더해 NBSP(U+00A0)·전각 공백(U+3000)·BOM(U+FEFF) 까지 잡는다.
//   못 잡는 건 '폭 없는 공백' 세 개뿐 — U+200B(ZWSP)·U+200C(ZWNJ)·U+200D(ZWJ).
//   엑셀에 복붙하다 딸려 들어오는 대표적인 유령 문자라 범위로 넣는다.
//   (\uFEFF 는 \s 에 이미 들어 있지만, "유령문자는 다 지운다"는 의도를 눈에 보이게 하려고 같이 적는다.)
//   확인: node -e 로 /\s/.test('\uFEFF') 는 true, U+200B(ZWSP) 한 글자는 false — \s 가 못 잡는다는 뜻.
//
// ⚠⚠ 유령문자를 '리터럴'로 쓰지 말 것. 반드시 \uXXXX 이스케이프로 적는다. 이유 두 가지:
//   (1) 리뷰어가 읽을 수 없다 — 소스만 봐서는 클래스 안에 문자가 몇 개 들었는지 알 방법이 없다.
//   (2) 조용히 깨진다 — 포매터·에디터의 '보이지 않는 문자 정리'·복붙 중 하나만 유령문자를 먹으면
//       위 정규식이 [\s-\uFEFF] 로 깨진다(U+200B~200D 셋이 통째로 '-' 하나로 뭉개진다). u 플래그가 없어 SyntaxError 도 안 나고,
//       '-' 가 범위 연산자로 해석돼 이름 속 하이픈이 지워진다.
//       실제로 확인함: '김-병현' → '김병현'.  이 함수는 DB 에 쓰는 값을 만든다 = 조용한 데이터 손상.
export function normalizePlayerName(raw: string): string {
  return raw.replace(/[\s\u200B-\u200D\uFEFF]/g, '');
}

const MAX_SUGGESTIONS = 3; // 제안은 최대 3개까지만(그 이상은 고르는 게 더 피곤하다)
const MIN_COMPARE_LENGTH = 2; // 1글자 이름끼리는 편집거리 1이 "아무 이름이나 비슷"이 돼 버린다

// 편집거리가 1 이하인가(= 한 글자 바꾸기/넣기/빼기로 서로 같아지나).
// 전체 편집거리 표(DP)를 만들 필요가 없다 — "1 이하냐"만 알면 되니 양쪽에서 훑으며 세면 끝난다.
//
// ⚠ 문자열 인덱싱은 UTF-16 코드 유닛 기준이다. 한글(가~힣)·영문·숫자는 전부 1칸이라 정확하다.
//   이모지처럼 서로게이트 쌍인 글자가 이름에 들어오면 글자 수를 잘못 센다(현실적으로 없음).
function isWithinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  const short = a.length <= b.length ? a : b;
  const long = a.length <= b.length ? b : a;
  if (long.length - short.length > 1) return false; // 길이가 2 이상 차이나면 볼 것도 없다
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < short.length && j < long.length) {
    if (short[i] === long[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (short.length === long.length) {
      i++;
      j++;
    } // 길이가 같다 → 한 글자 바꾸기
    else j++; // 길이가 다르다 → 긴 쪽에서 한 글자 빼기
  }
  return true; // 여기까지 왔으면 남은 꼬리는 최대 1글자라 편집 1회 안에 들어온다
}

// normalizedNew 와 비슷한 기존 이름을 최대 3개. 정렬은 (대소문자만 다른 것 먼저) → (가나다).
// 정렬을 못 박는 이유: 순서가 흔들리면 검증 스크립트가 못 잡고, 화면 문구도 매번 달라진다.
function suggestSimilarNames(
  normalizedNew: string,
  knownNames: readonly KnownName[], // 이미 정규화·길이필터를 마친 목록
): string[] {
  if (normalizedNew.length < MIN_COMPARE_LENGTH) return [];
  const scored: { name: string; rank: number }[] = [];
  for (const { raw, norm } of knownNames) {
    if (Math.abs(norm.length - normalizedNew.length) > 1) continue; // 빠른 탈락
    if (norm.toLowerCase() === normalizedNew.toLowerCase()) {
      scored.push({ name: raw, rank: 0 });
      continue;
    }
    if (isWithinOneEdit(norm, normalizedNew)) scored.push({ name: raw, rank: 1 });
  }
  scored.sort((x, y) => x.rank - y.rank || x.name.localeCompare(y.name, 'ko'));
  return scored.slice(0, MAX_SUGGESTIONS).map((s) => s.name);
}

/**
 * 파일에 나온 이름들 중 "여태 DB에 없던 이름"만 골라낸다.
 *
 * - fileNames: 파싱된 이벤트의 player 값 전부(이미 normalizePlayerName 을 거친 값, 중복 있어도 됨)
 * - knownNames: DB 에 기록이 있는 선수 이름 전부(중복 없음, 전체 대회)
 *
 * 규칙 3가지:
 *  1) knownNames 가 비어 있으면 무조건 빈 배열. (DB 가 텅 빔 = 첫 업로드 = 전원 신규가 당연.
 *     여기서 물어봐야 사용자는 "당연하지" 밖에 할 말이 없다.)
 *  2) 신규 판정은 '글자 그대로' 비교한다 — 정규화해서 비교하지 않는다.
 *     [신설: 2026-07-29 21:05, 김병현 작성] 왜 정규화 비교가 아닌가:
 *       파일 이름은 이미 정규화돼 들어온다. 그런데 DB 옛 행에는 아직 공백 든 이름이 남아 있을 수
 *       있다(정리 스크립트를 아직 안 돌렸거나 일부만 돌렸을 때). 그때 정규화해서 비교하면
 *       '같은 사람'으로 보고 조용히 넘어가는데, 저장은 새 이름으로 되니 결국 DB 엔 두 사람이 남는다.
 *       글자 그대로 비교하면 "처음 보는 이름 김병현 / 혹시 '김 병현'?" 이라고 떠서 사용자가 알아챈다.
 *       ⚠ 단 이건 '알림'이지 '해결책'이 아니다 — 앞뒤 공백·ZWSP 는 화면에서 구분이 거의 안 된다(§10 지적 8).
 *          진짜 해결은 fix:playerspaces 를 돌리는 것이다.
 *     → 정규화(normalizePlayerName)는 '제안 계산'에만 쓴다.
 *  3) 결과의 name 은 파일에서 온 값 그대로다(= 저장될 값). 파일 안 중복 제거도 이 값 기준.
 */
export function findNewPlayers(
  fileNames: readonly string[],
  knownNames: readonly string[],
): NewPlayer[] {
  if (knownNames.length === 0) return [];

  const knownExact = new Set(knownNames); // 판정용 — 글자 그대로
  const knownForSuggest: KnownName[] = knownNames // 제안용 — 정규화는 기존 이름당 딱 한 번
    .map((raw) => ({ raw, norm: normalizePlayerName(raw) }))
    .filter((k) => k.norm.length >= MIN_COMPARE_LENGTH); // 후보 쪽 길이 가드 (표 O 가 지킨다)

  const seen = new Set<string>();
  const result: NewPlayer[] = [];
  for (const name of fileNames) {
    if (!name) continue; // 빈 이름은 이벤트가 아니다
    if (seen.has(name)) continue; // 같은 파일 안 같은 이름은 한 번만
    seen.add(name);
    if (knownExact.has(name)) continue; // 이미 아는 사람
    result.push({
      name,
      suggestions: suggestSimilarNames(normalizePlayerName(name), knownForSuggest),
    });
  }
  return result;
}
