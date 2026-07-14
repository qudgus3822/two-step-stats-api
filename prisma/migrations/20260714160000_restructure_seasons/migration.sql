-- 시즌 등록부를 (연도, 시즌번호) 구조로 변경.
-- 기존: seasons(id, name, createdAt) → 변경: seasons(id, year, season, label, createdAt).
-- 테이블이 비어 있어 NOT NULL 컬럼을 기본값 없이 바로 추가할 수 있다.

-- DropIndex
DROP INDEX "seasons_name_key";

-- AlterTable
ALTER TABLE "seasons" DROP COLUMN "name",
ADD COLUMN "year" INTEGER NOT NULL,
ADD COLUMN "season" INTEGER NOT NULL,
ADD COLUMN "label" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "seasons_label_key" ON "seasons"("label");

-- CreateIndex
CREATE UNIQUE INDEX "seasons_year_season_key" ON "seasons"("year", "season");
