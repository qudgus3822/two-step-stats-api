import { BoxScore, StatEvent } from './types';

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
