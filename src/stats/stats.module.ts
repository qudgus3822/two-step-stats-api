import { Module } from '@nestjs/common';
import { StatsController } from './stats.controller';
import { StatsService } from './stats.service';
import { StoreService } from './store.service';
import { ParserService } from './parser.service';
// [변경: 2026-07-14 17:32, 김병현 수정] 대회 등록부 서비스 등록 (season.service → competition.service 리네임)
import { CompetitionService } from './competition.service';

@Module({
  controllers: [StatsController],
  providers: [StatsService, StoreService, ParserService, CompetitionService],
})
export class StatsModule {}
