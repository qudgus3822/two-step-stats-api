// [변경: 2026-07-14 17:32, 김병현 수정] 대회 모델 대개편 — "엑셀에서 갓 파싱된 행(ParsedEvent)"과
// "집계용 이벤트(StatEvent)"를 분리했다. 엑셀엔 대회 칸이 없어 파서는 대회를 모른다(원래 season
// 필드가 파일명/옵션에서 억지로 채워졌던 것을 없앰). 대회는 업로드 폼이 정해서, 적재 시점에
// competitionId 를 붙인다. StatEvent 는 여기에 조회용 competitionLabel(불투명 표시 문자열)을 더 얹는다.

// 엑셀 Rawdata 시트의 왼쪽 표 한 행 = 한 이벤트. 대회 정보는 없음(대회는 업로드 폼이 정한다).
// (주차, 경기, 쿼터, 선수, 스텟, 팀명) 6개 컬럼을 그대로 롱 포맷으로 담는다.
export interface ParsedEvent {
  week: number; // 주차
  game: number; // 주차 내 경기 번호
  quarter: number; // 쿼터
  player: string; // 선수 이름
  stat: string; // 스텟 코드 (대문자 정규화된 원본 코드)
  team: string; // 팀명 (예: OB / YB)
}

// 집계용 이벤트: ParsedEvent 에 "어느 대회인지(competitionId)"와 "어떻게 보이는지(competitionLabel)"를
// 함께 실어 보낸다. aggregate 는 competitionLabel 을 '불투명 문자열'로 그대로 출력만 한다
// (라벨을 만드는 규칙은 competition.service.competitionLabel() 한 곳에만 있다).
export interface StatEvent extends ParsedEvent {
  competitionId: number; // competitions.id — 그룹핑/게임id 생성에 쓰는 값
  competitionLabel: string; // 대회 표시 라벨 — 화면에 그대로 출력만 되는 값
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
  id: string; // URL-safe 경기 식별자 (c{competitionId}_w{week}_g{game})
  competition: string; // [변경: 2026-07-14 17:32, 김병현 수정] 값은 competitionLabel(표시 라벨)
  week: number;
  game: number;
  teams: { team: string; score: number }[];
  winner: string | null; // 무승부면 null
  events: number; // 이 경기의 이벤트 수
}

// [변경: 2026-07-15 14:10, 김병현 수정] 업로드 중복 경기 감지 — 충돌 한 건과 409 응답 모양.
// 충돌 경기 하나: 파일의 (주차,경기)가 이미 DB에 있고 그 기존 행이 몇 개인지.
export interface GameConflict {
  week: number; // 주차
  game: number; // 주차 내 경기 번호
  existingCount: number; // 이미 DB에 있는 이 경기의 이벤트 행 수
}
// 409 Conflict 응답 body. conflict:true 가 "덮어쓰기 확인용"임을 알리는 판별 필드.
export interface UploadConflictBody {
  conflict: true;
  competitionId: number;
  competition: string; // 표시 라벨
  games: GameConflict[];
  message: string; // 사람이 읽는 안내
}
