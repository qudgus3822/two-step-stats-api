/**
 * 시드 스크립트: 실제 기록지 이벤트(fixtures/real-stats.json)를 Postgres에 적재한다.
 * 실행: npx ts-node scripts/seed.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
// [변경: 2026-07-14 17:32, 김병현 수정] 대회 모델 대개편 — Competition 을 upsert 해서 얻은 id 로
// 이벤트를 적재한다. 라벨 규칙은 competition.service.competitionLabel() 한 곳만 쓴다(중복 정의 방지).
import { competitionLabel } from '../src/stats/competition.service';

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  const fixturePath = path.join(__dirname, 'fixtures', 'real-stats.json');
  const fx = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'));
  // 이 픽스처는 2026 시즌2(나이배) 기록.
  const YEAR = 2026;
  const SEASON_NO = 2;
  const NAME = '나이배';
  const label = competitionLabel(YEAR, SEASON_NO, NAME);

  // 대회 등록부에도 이 대회를 등록(멱등) — 새 모델에서 대회는 competitions 테이블로 관리한다.
  const competition = await prisma.competition.upsert({
    where: { label },
    update: {},
    create: { year: YEAR, seasonNo: SEASON_NO, name: NAME, label },
  });

  const data = fx.events.map(
    (e: {
      week: number;
      game: number;
      quarter: number;
      player: string;
      stat: string;
      team: string;
    }) => ({
      competitionId: competition.id,
      week: e.week,
      game: e.game,
      quarter: e.quarter,
      player: e.player,
      stat: e.stat,
      team: e.team,
    }),
  );

  // 같은 대회 데이터를 교체(중복 방지)
  await prisma.$transaction([
    prisma.statEvent.deleteMany({ where: { competitionId: competition.id } }),
    prisma.statEvent.createMany({ data }),
  ]);

  const count = await prisma.statEvent.count({ where: { competitionId: competition.id } });
  console.log(`시드 완료: 대회 "${label}" 이벤트 ${count}건 적재`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('시드 실패:', err);
  process.exit(1);
});
