-- [신설: 2026-09-02 김병현 작성] 우승 기록 테이블 — "한 줄 = 선수 한 명의 우승 하나".
-- 기존 표(competitions / stat_events)는 전혀 건드리지 않는다. 순수 추가라 되돌리기도 DROP 한 줄이다.

CREATE TABLE "championship_wins" (
  "id"            SERIAL NOT NULL,
  "competitionId" INTEGER NOT NULL,
  "player"        TEXT NOT NULL,
  "teamName"      TEXT NOT NULL,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "championship_wins_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "championship_wins_competitionId_fkey" FOREIGN KEY ("competitionId")
    REFERENCES "competitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- "같은 대회에서 같은 선수가 두 번 우승"을 DB가 막는다.
-- 이게 있어야 [+] 버튼이 몇 번 눌려도 안전하다(멱등) — 서버는 upsert 한 번만 던지면 된다.
CREATE UNIQUE INDEX "championship_wins_competitionId_player_key"
  ON "championship_wins"("competitionId", "player");

-- 통산 우승횟수는 "선수 이름으로 줄 세기"라 player 단독 인덱스가 그 조회를 받쳐 준다.
CREATE INDEX "championship_wins_player_idx" ON "championship_wins"("player");
