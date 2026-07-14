/**
 * 시드 스크립트: 실제 기록지 이벤트(fixtures/real-stats.json)를 Postgres에 적재한다.
 * 실행: npx ts-node scripts/seed.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  const fixturePath = path.join(__dirname, 'fixtures', 'real-stats.json');
  const fx = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'));
  const season: string = String(fx.source).replace(/\.[^.]+$/, '');

  const data = fx.events.map(
    (e: {
      week: number;
      game: number;
      quarter: number;
      player: string;
      stat: string;
      team: string;
    }) => ({
      season,
      week: e.week,
      game: e.game,
      quarter: e.quarter,
      player: e.player,
      stat: e.stat,
      team: e.team,
    }),
  );

  // 같은 시즌 데이터를 교체(중복 방지)
  await prisma.$transaction([
    prisma.statEvent.deleteMany({ where: { season } }),
    prisma.statEvent.createMany({ data }),
  ]);

  const count = await prisma.statEvent.count({ where: { season } });
  console.log(`시드 완료: 시즌 "${season}" 이벤트 ${count}건 적재`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('시드 실패:', err);
  process.exit(1);
});
