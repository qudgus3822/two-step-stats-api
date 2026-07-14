-- CreateTable
CREATE TABLE "stat_events" (
    "id" SERIAL NOT NULL,
    "season" TEXT NOT NULL,
    "week" INTEGER NOT NULL,
    "game" INTEGER NOT NULL,
    "quarter" INTEGER NOT NULL,
    "player" TEXT NOT NULL,
    "stat" TEXT NOT NULL,
    "team" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stat_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stat_events_season_idx" ON "stat_events"("season");

-- CreateIndex
CREATE INDEX "stat_events_season_week_game_idx" ON "stat_events"("season", "week", "game");

-- CreateIndex
CREATE INDEX "stat_events_player_idx" ON "stat_events"("player");
