import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { StatsModule } from './stats/stats.module';

@Module({
  imports: [PrismaModule, StatsModule],
})
export class AppModule {}
