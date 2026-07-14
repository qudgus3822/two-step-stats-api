import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ParserService } from './parser.service';
import { StoreService } from './store.service';
import { StatsService } from './stats.service';
import { LEADERBOARD_METRICS, LeaderboardMetric } from './aggregate';

@Controller()
export class StatsController {
  constructor(
    private readonly parser: ParserService,
    private readonly store: StoreService,
    private readonly stats: StatsService,
  ) {}

  // API 인덱스 (사용 가능한 엔드포인트 안내)
  @Get()
  index() {
    return {
      name: 'two-step-stats-api',
      description: '농구 동호회 기록지 박스스코어/랭킹 API',
      endpoints: {
        'POST /upload?season=&mode=replace|append': '엑셀(.xlsx) 업로드 → 이벤트 적재',
        'GET /seasons': '시즌 목록',
        'GET /summary?season=': '데이터 요약(규모·코드 사용)',
        'GET /games?season=': '경기 목록(팀 점수/승패)',
        'GET /games/:id': '경기 박스스코어(양 팀·선수별)',
        'GET /players?season=': '선수 목록(출전 수·누적 득점)',
        'GET /players/:name': '선수 상세(누적 + 경기별 추이)',
        'GET /leaderboard?metric=pts&limit=20&season=': '지표별 리더보드',
        'DELETE /data?season=': '데이터 삭제(시즌 지정 없으면 전체)',
      },
    };
  }

  @Get('health')
  health() {
    return { ok: true };
  }

  // 엑셀 업로드 → 파싱 → 적재
  // - season: 시즌 라벨(미지정 시 파일명 사용)
  // - mode: replace(기본, 해당 시즌 통째 교체) | append(증분 추가)
  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @Query('season') season?: string,
    @Query('mode') mode?: string,
  ) {
    if (!file) {
      throw new BadRequestException(
        "엑셀 파일이 없습니다. multipart/form-data 의 'file' 필드로 업로드하세요.",
      );
    }

    let result;
    try {
      result = this.parser.parseWorkbook(file.buffer, {
        season,
        filename: file.originalname,
      });
    } catch (err) {
      throw new BadRequestException(
        `엑셀 파싱 실패: ${(err as Error).message}`,
      );
    }

    const useAppend = (mode ?? 'replace').toLowerCase() === 'append';
    const imported = useAppend
      ? await this.store.appendSeason(result.season, result.events)
      : await this.store.replaceSeason(result.season, result.events);

    return {
      ok: true,
      season: result.season,
      sheet: result.sheet,
      mode: useAppend ? 'append' : 'replace',
      imported,
      unknownCodes: result.unknownCodes,
      warnings: result.warnings,
    };
  }

  @Get('seasons')
  seasons() {
    return this.stats.seasons();
  }

  @Get('summary')
  summary(@Query('season') season?: string) {
    return this.stats.summary(season);
  }

  @Get('games')
  games(@Query('season') season?: string) {
    return this.stats.games(season);
  }

  @Get('games/:id')
  async game(@Param('id') id: string) {
    const box = await this.stats.boxScore(id);
    if (!box) throw new NotFoundException(`경기를 찾을 수 없습니다: ${id}`);
    return box;
  }

  @Get('players')
  players(@Query('season') season?: string) {
    return this.stats.players(season);
  }

  @Get('players/:name')
  async player(@Param('name') name: string) {
    const detail = await this.stats.player(name);
    if (!detail) throw new NotFoundException(`선수를 찾을 수 없습니다: ${name}`);
    return detail;
  }

  @Get('leaderboard')
  leaderboard(
    @Query('metric') metric?: string,
    @Query('limit') limit?: string,
    @Query('season') season?: string,
  ) {
    const m = (metric ?? 'pts') as LeaderboardMetric;
    if (!LEADERBOARD_METRICS.includes(m)) {
      throw new BadRequestException(
        `지원하지 않는 지표입니다. 사용 가능: ${LEADERBOARD_METRICS.join(', ')}`,
      );
    }
    const n = limit ? Math.max(1, Math.min(100, parseInt(limit, 10) || 20)) : 20;
    return this.stats.leaderboard(m, n, season);
  }

  @Delete('data')
  async clear(@Query('season') season?: string) {
    const deleted = await this.store.clear(season);
    return { ok: true, deleted, season: season ?? null };
  }
}
