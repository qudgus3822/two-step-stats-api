import { BoxScore, StatCodeResolution, StatEvent } from './types';
// [신설: 2026-07-31 15:06, 김병현 작성] 한글로 친 코드를 두벌식 자판대로 되돌리는 순수 함수.
import { hangulToQwerty } from './hangulKey';

// 스텟 코드 → 득점 매핑 (동호회 자체 룰 기준)
//  - 2점 자유투는 한 번만 던지고(2F=2점), 3점슛 파울 시에만 자유투 2개를 던져
//    2점짜리 하나(2F) + 1점짜리 하나(1F)로 기록된다.
//  - 앤드원은 자유투 없이 자동 1점(코드 '1')으로 필드골과 합쳐져 총점이 맞는다.
//    예) 2점 성공 후 앤드원 = '2'(2점) + '1'(1점) = 3점.
export const POINTS: Record<string, number> = {
  '1': 1, // 앤드원 보너스 (자유투 없이 자동 1점)
  '2': 2, // 2점 필드골 성공
  '3': 3, // 3점 필드골 성공
  '1F': 1, // 1점짜리 자유투 성공 (3점슛 파울 시)
  '2F': 2, // 2점짜리 자유투 성공 (한 번만 던짐)
};

// 기록지에서 사용하는 전체 스텟 코드 사전 (오타 조기 발견용)
export const KNOWN_CODES = new Set<string>([
  '1',
  '2',
  '3',
  '1F',
  '2F',
  '1FA',
  '2FA',
  '2A',
  '3A',
  'A', // 어시스트
  'S', // 스틸
  'B', // 블락
  'T', // 턴오버
  'OR', // 공격 리바운드
  'DR', // 수비 리바운드
]);

// 코드 정규화: 앞뒤 공백 제거 + 대문자 통일 (예: '1fa' → '1FA')
export function normalizeCode(raw: string): string {
  return String(raw).trim().toUpperCase();
}

// [신설: 2026-07-31 15:06, 김병현 작성] 셀 값 하나를 '사전에 있는 코드'로 해석한다.
//
// 왜 normalizeCode 를 안 고치고 함수를 따로 만들었나:
//   normalizeCode 는 '모양 다듬기'(공백 제거 + 대문자)라 사전을 몰라야 한다. 그리고 여기선
//   "되돌리기가 일어났는지"를 호출자에게 알려야 하는데(조용히 바뀌는 게 제일 위험하다),
//   string 하나로는 그걸 못 담는다. 어차피 반환형이 달라지므로 별도 함수가 맞다.
//
// ⚠ 이 함수의 3단계가 이 기능의 '유일한' 안전장치다. 업로드 파서는 이상한 코드를 막지 않는다
//   — 경고만 남기고 그냥 저장한다(parser.service.ts). "어차피 업로드가 검사하잖아"는 틀렸다.
//
// 순서가 곧 안전장치다:
//   1) 그대로 사전에 있으면 즉시 끝 — 되돌리기 함수 근처에도 안 간다.
//   2) 한글이 없으면(hangulToQwerty 가 null) 즉시 끝 — 순수 ASCII 는 한 글자도 안 바뀐다.
//   3) 되돌린 결과가 사전에 있을 때'만' 채택. 아니면 원본 유지 → 지금처럼 미등록 경고가 뜬다.
//      (엉뚱한 한글이 우연히 아무 코드로 둔갑하는 걸 막는 문지기다.)
//      ⚠ 단 이 문지기는 '코드가 맞나'만 본다. '뜻이 맞나'는 못 본다 — 스틸 뜻으로 손으로 적은 자모
//        하나가 턴오버로 읽힐 수 있다(계획서 §6-b·갓차 G13). 그래서 화면이 목록을 보여 준다.
//
// ⚠ KNOWN_CODES 에 코드를 더할 사람에게: 검증 스크립트(check-hangul-codes.ts)의 표 S6 을 먼저
//   보라. 4글자 코드나 '자음글쇠+모음글쇠' 모양(예: GK)을 넣으면 "변환되는 한글은 41가지가
//   전부다"라는 증명이 깨진다. S6 이 먼저 빨간불을 내고, 그때는 스윕(S3)의 길이·알파벳도
//   같이 늘려야 한다.
//
// hangulSource 는 '파일에 있던 글자 그대로'가 아니라 '되돌리기에 넣은 값'(= 아래 code)이다.
//   종류를 묶는 열쇠라서 그렇다(계획서 §3-c). types.ts 의 두 주석과 같은 정의다.
export function resolveStatCode(raw: string): StatCodeResolution {
  const code = normalizeCode(raw);
  if (KNOWN_CODES.has(code)) return { code, hangulSource: null };

  const typed = hangulToQwerty(code);
  if (typed === null) return { code, hangulSource: null };

  const recovered = normalizeCode(typed);
  if (!KNOWN_CODES.has(recovered)) return { code, hangulSource: null };
  return { code: recovered, hangulSource: code };
}

// 코드 하나의 득점 (매핑에 없으면 0점)
export function pointsForStat(code: string): number {
  return POINTS[code] ?? 0;
}

// 0으로 초기화된 빈 박스스코어
function emptyBox(): BoxScore {
  return {
    pts: 0,
    fgm: 0,
    fga: 0,
    fg2m: 0,
    fg2a: 0,
    fg3m: 0,
    fg3a: 0,
    ftm: 0,
    fta: 0,
    andOne: 0,
    oreb: 0,
    dreb: 0,
    reb: 0,
    ast: 0,
    stl: 0,
    blk: 0,
    tov: 0,
  };
}

// 이벤트 배열을 집계해 박스스코어를 만든다.
export function computeBoxScore(events: StatEvent[]): BoxScore {
  const b = emptyBox();
  let fg2miss = 0;
  let fg3miss = 0;
  let ftmiss = 0;

  for (const e of events) {
    b.pts += pointsForStat(e.stat);
    switch (e.stat) {
      case '2':
        b.fg2m++;
        break;
      case '2A':
        fg2miss++;
        break;
      case '3':
        b.fg3m++;
        break;
      case '3A':
        fg3miss++;
        break;
      case '1F': // 1점 자유투 성공
      case '2F': // 2점 자유투 성공
        b.ftm++;
        break;
      case '1FA': // 자유투 실패
      case '2FA':
        ftmiss++;
        break;
      case '1':
        b.andOne++;
        break;
      case 'A':
        b.ast++;
        break;
      case 'S':
        b.stl++;
        break;
      case 'B':
        b.blk++;
        break;
      case 'T':
        b.tov++;
        break;
      case 'OR':
        b.oreb++;
        break;
      case 'DR':
        b.dreb++;
        break;
      default:
        // 미등록 코드는 득점/스탯 집계에 반영하지 않음 (파서에서 경고로 잡힘)
        break;
    }
  }

  b.fg2a = b.fg2m + fg2miss;
  b.fg3a = b.fg3m + fg3miss;
  b.fgm = b.fg2m + b.fg3m;
  b.fga = b.fg2a + b.fg3a;
  b.fta = b.ftm + ftmiss;
  b.reb = b.oreb + b.dreb;
  return b;
}
