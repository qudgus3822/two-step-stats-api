import { Module } from '@nestjs/common';
import { StatsController } from './stats.controller';
import { StatsService } from './stats.service';
import { StoreService } from './store.service';
import { ParserService } from './parser.service';

@Module({
  controllers: [StatsController],
  providers: [StatsService, StoreService, ParserService],
})
export class StatsModule {}
