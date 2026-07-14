// 정규화된 스탯 이벤트: 엑셀 Rawdata 시트의 왼쪽 표 한 행 = 한 이벤트
// (주차, 경기, 쿼터, 선수, 스텟, 팀명) 6개 컬럼을 그대로 롱 포맷으로 담는다.
export interface StatEvent {
  season: string; // 시즌/파일 라벨 (예: "2026-시즌2-나이배")
  week: number; // 주차
  game: number; // 주차 내 경기 번호
  quarter: number; // 쿼터
  player: string; // 선수 이름
  stat: string; // 스텟 코드 (대문자 정규화된 원본 코드)
  team: string; // 팀명 (예: OB / YB)
}

// 이벤트들을 집계해서 만든 박스스코어(누적 스탯). 전부 원시 카운트만 담는다.
export interface BoxScore {
  pts: number; // 득점
  fgm: number; // 필드골 성공 (2점+3점)
  fga: number; // 필드골 시도 (2점+3점)
  fg2m: number; // 2점 성공
  fg2a: number; // 2점 시도
  fg3m: number; // 3점 성공
  fg3a: number; // 3점 시도
  ftm: number; // 자유투 성공 (1F + 2F)
  fta: number; // 자유투 시도 (성공 + 1FA + 2FA)
  andOne: number; // 앤드원 보너스 횟수
  oreb: number; // 공격 리바운드
  dreb: number; // 수비 리바운드
  reb: number; // 총 리바운드
  ast: number; // 어시스트
  stl: number; // 스틸
  blk: number; // 블락
  tov: number; // 턴오버
}

// 박스스코어에 야투율 등 파생 비율을 붙인 응답용 형태
export interface BoxScoreView extends BoxScore {
  fgPct: number | null; // 필드골 성공률(%) — 시도 0이면 null
  fg2Pct: number | null; // 2점 성공률(%)
  fg3Pct: number | null; // 3점 성공률(%)
  ftPct: number | null; // 자유투 성공률(%)
}

// 한 선수의 경기별/누적 스탯 라인 (박스스코어 + 선수/팀 정보)
export interface PlayerLine extends BoxScoreView {
  player: string;
  team: string;
}

// 경기 목록에서 쓰는 요약 정보
export interface GameSummary {
  id: string; // URL-safe 경기 식별자
  season: string;
  week: number;
  game: number;
  teams: { team: string; score: number }[];
  winner: string | null; // 무승부면 null
  events: number; // 이 경기의 이벤트 수
}
