import { Module } from '@nestjs/common';
import { StatsController } from './stats.controller';
import { StatsService } from './stats.service';
import { StoreService } from './store.service';
import { ParserService } from './parser.service';
// [변경: 2026-07-14 14:21, 김병현 수정] 시즌 등록부 서비스 등록
import { SeasonService } from './season.service';

@Module({
  controllers: [StatsController],
  providers: [StatsService, StoreService, ParserService, SeasonService],
})
export class StatsModule {}
