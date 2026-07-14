-- [변경: 2026-07-14 17:32, 김병현 수정] 대회 모델 대개편: 데이터 전량 폐기 후 FK 스키마로 재생성.
-- 요구사항 확정(옵션 A): 기존 데이터는 이관하지 않는다(백필 없음).
DROP TABLE IF EXISTS "stat_events";
DROP TABLE IF EXISTS "seasons";        -- 옛 테이블(이전 스키마) 이름 그대로 — 이 이름으로 드롭해야 실제 옛 표가 지워진다
DROP TABLE IF EXISTS "competitions";   -- 재실행 안전용(이미 새 표가 있으면)

CREATE TABLE "competitions" (
  "id"        SERIAL NOT NULL,
  "year"      INTEGER NOT NULL,
  "seasonNo"  INTEGER,            -- nullable (지정안함 가능)
  "name"      TEXT NOT NULL,
  "label"     TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "competitions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "competitions_label_key" ON "competitions"("label");

CREATE TABLE "stat_events" (
  "id"            SERIAL NOT NULL,
  "competitionId" INTEGER NOT NULL,
  "week"          INTEGER NOT NULL,
  "game"          INTEGER NOT NULL,
  "quarter"       INTEGER NOT NULL,
  "player"        TEXT NOT NULL,
  "stat"          TEXT NOT NULL,
  "team"          TEXT NOT NULL,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "stat_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "stat_events_competitionId_fkey" FOREIGN KEY ("competitionId")
    REFERENCES "competitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "stat_events_competitionId_idx" ON "stat_events"("competitionId");
CREATE INDEX "stat_events_competitionId_week_game_idx" ON "stat_events"("competitionId","week","game");
CREATE INDEX "stat_events_player_idx" ON "stat_events"("player");
