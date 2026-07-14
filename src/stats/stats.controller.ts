import {
  BadRequestException,
  Body,
  ConflictException,
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
// [변경: 2026-07-14 17:32, 김병현 수정] 대회 등록부 서비스 주입 (season.service → competition.service 리네임)
import { CompetitionService } from './competition.service';

@Controller()
export class StatsController {
  constructor(
    private readonly parser: ParserService,
    private readonly store: StoreService,
    private readonly stats: StatsService,
    // [변경: 2026-07-14 17:32, 김병현 수정] seasonRegistry → competitionRegistry(타입 CompetitionService)
    private readonly competitionRegistry: CompetitionService,
  ) {}

  // API 인덱스 (사용 가능한 엔드포인트 안내)
  // [변경: 2026-07-14 17:32, 김병현 수정] 대회 모델 대개편으로 엔드포인트 목록 갱신(시즌 문자열 → 대회 FK).
  // @Get()
  // index() {
  //   return {
  //     name: 'two-step-stats-api',
  //     description: '농구 동호회 기록지 박스스코어/랭킹 API',
  //     endpoints: {
  //       'POST /upload?year=&seasonNo=&name=&mode=replace|append':
  //         '엑셀(.xlsx) 업로드 → 대회 upsert 후 이벤트 적재 (replace=파일에 담긴 경기만 교체, append=증분 추가)',
  //       'GET /competitions': '등록된 대회 목록(id, year, seasonNo, name, label)',
  //       'POST /competitions': '대회 등록 { year, seasonNo?, name }',
  //       'DELETE /competitions/:id': '대회 등록 해제(경기 기록이 있으면 409)',
  //       'GET /summary?competitionId=': '데이터 요약(규모·코드 사용)',
  //       'GET /games?competitionId=': '경기 목록(팀 점수/승패)',
  //       'GET /games/:id': '경기 박스스코어(양 팀·선수별)',
  //       'GET /players?competitionId=': '선수 목록(출전 수·누적 득점)',
  //       'GET /players/:name': '선수 상세(누적 + 경기별 추이)',
  //       'GET /leaderboard?metric=pts&limit=20&competitionId=': '지표별 리더보드',
  //       'DELETE /data?competitionId=': '데이터 삭제(대회 지정 없으면 전체)',
  //     },
  //   };
  // }

  @Get('health')
  health() {
    return { ok: true };
  }

  // 엑셀 업로드 → 파싱 → 대회 upsert → 적재
  // - year: 연도(필수, 양의 정수) / seasonNo: 시즌번호(선택, 있으면 양의 정수) / name: 대회명(필수)
  // - mode: replace(기본, 해당 파일의 경기만 교체) | append(증분 추가)
  // [변경: 2026-07-14 17:32, 김병현 수정] season 옵션/파일명 fallback 대신 폼값(year/seasonNo/name)으로
  // 대회를 upsert 하고, 그 id 로 이벤트를 적재한다(파서는 대회를 모름).
  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @Query('year') year?: string,
    @Query('seasonNo') seasonNo?: string,
    @Query('name') name?: string,
    @Query('mode') mode?: string,
  ) {
    if (!file) {
      throw new BadRequestException(
        "엑셀 파일이 없습니다. multipart/form-data 의 'file' 필드로 업로드하세요.",
      );
    }

    const y = Number(year);
    if (!Number.isInteger(y) || y <= 0) {
      throw new BadRequestException('연도(year)를 양의 정수로 입력하세요.');
    }
    const nameTrimmed = (name ?? '').trim();
    if (!nameTrimmed) {
      throw new BadRequestException('대회명(name)을 입력하세요.');
    }
    let seasonNoParsed: number | null = null;
    if (seasonNo !== undefined && seasonNo !== '') {
      const s = Number(seasonNo);
      if (!Number.isInteger(s) || s <= 0) {
        throw new BadRequestException('시즌번호(seasonNo)는 양의 정수여야 합니다.');
      }
      seasonNoParsed = s;
    }

    let parsed;
    try {
      parsed = this.parser.parseWorkbook(file.buffer); // 대회 안 넘김 — 파서는 대회를 모름
    } catch (err) {
      throw new BadRequestException(
        `엑셀 파싱 실패: ${(err as Error).message}`,
      );
    }

    // 대회 upsert(멱등) → 이 id 로 이벤트 적재.
    const competition = await this.competitionRegistry.create(y, seasonNoParsed, nameTrimmed);

    // [변경: 2026-07-14 14:21, 김병현 수정] replace 기본값은 '그 경기만 교체'로 바뀜.
    const useAppend = (mode ?? 'replace').toLowerCase() === 'append';
    const imported = useAppend
      ? await this.store.appendCompetition(competition.id, parsed.events)
      : await this.store.replaceGames(competition.id, parsed.events);

    return {
      ok: true,
      competitionId: competition.id,
      competition: competition.label,
      sheet: parsed.sheet,
      mode: useAppend ? 'append' : 'replace',
      imported,
      unknownCodes: parsed.unknownCodes,
      warnings: parsed.warnings,
    };
  }

  // [변경: 2026-07-14 17:32, 김병현 수정] 옛 GET /seasons(데이터 있는 시즌 문자열 목록) +
  // GET /seasons/registry(등록부)를 하나로 통합 — 등록된 Competition 행 목록을 반환한다.
  @Get('competitions')
  competitions() {
    return this.competitionRegistry.list();
  }

  // 대회 등록 — 연도+시즌번호(선택)+대회명 받아 라벨 자동 생성(멱등 upsert).
  @Post('competitions')
  createCompetition(
    @Body('year') year?: number,
    @Body('seasonNo') seasonNo?: number,
    @Body('name') name?: string,
  ) {
    const y = Number(year);
    if (!Number.isInteger(y) || y <= 0) {
      throw new BadRequestException('연도(year)를 양의 정수로 입력하세요.');
    }
    const nameTrimmed = (name ?? '').trim();
    if (!nameTrimmed) {
      throw new BadRequestException('대회명(name)을 입력하세요.');
    }
    let seasonNoParsed: number | null = null;
    if (seasonNo !== undefined && seasonNo !== null) {
      const s = Number(seasonNo);
      if (!Number.isInteger(s) || s <= 0) {
        throw new BadRequestException('시즌번호(seasonNo)는 양의 정수여야 합니다.');
      }
      seasonNoParsed = s;
    }
    // name 은 upload 경로와 동일하게 trim(뒤 공백으로 label 갈려 멱등 깨지는 것 방지).
    return this.competitionRegistry.create(y, seasonNoParsed, nameTrimmed);
  }

  // 대회 삭제 — FK(onDelete: Restrict) 때문에 경기 기록이 있는 대회는 지울 수 없다(409).
  @Delete('competitions/:id')
  async removeCompetition(@Param('id') id: string) {
    const competitionId = parseInt(id, 10);
    if (!Number.isFinite(competitionId)) {
      throw new BadRequestException('잘못된 대회 id 입니다.');
    }
    const result = await this.competitionRegistry.remove(competitionId);
    switch (result) {
      case 'removed':
        return { ok: true, id: competitionId };
      case 'not-found':
        throw new NotFoundException(`대회를 찾을 수 없습니다: ${competitionId}`);
      case 'has-events':
        throw new ConflictException(
          '이 대회엔 경기 기록이 있어 등록 해제할 수 없어요. 먼저 데이터를 지우세요.',
        );
    }
  }

  // 쿼리 문자열 → 필터용 competitionId. 정수(1 이상)일 때만 필터, 그 외(0/음수/NaN/빈값)는 전체.
  // (빈 문자열이 Number('') === 0 으로 파싱돼 competitionId=0 로 필터되는 자기모순을 막기 위한 가드.)
  private parseCompetitionId(raw?: string): number | undefined {
    const n = Number(raw);
    return Number.isInteger(n) && n > 0 ? n : undefined;
  }

  @Get('summary')
  summary(@Query('competitionId') competitionId?: string) {
    return this.stats.summary(this.parseCompetitionId(competitionId));
  }

  @Get('games')
  games(@Query('competitionId') competitionId?: string) {
    return this.stats.games(this.parseCompetitionId(competitionId));
  }

  @Get('games/:id')
  async game(@Param('id') id: string) {
    const box = await this.stats.boxScore(id);
    if (!box) throw new NotFoundException(`경기를 찾을 수 없습니다: ${id}`);
    return box;
  }

  @Get('players')
  players(@Query('competitionId') competitionId?: string) {
    return this.stats.players(this.parseCompetitionId(competitionId));
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
    @Query('competitionId') competitionId?: string,
  ) {
    const m = (metric ?? 'pts') as LeaderboardMetric;
    if (!LEADERBOARD_METRICS.includes(m)) {
      throw new BadRequestException(
        `지원하지 않는 지표입니다. 사용 가능: ${LEADERBOARD_METRICS.join(', ')}`,
      );
    }
    // [변경: 2026-07-14 17:49, 김병현 수정] limit 양수면 그 수만큼, 생략/0이하면 전체(undefined) 반환.
    const parsed = limit ? parseInt(limit, 10) : NaN;
    const n = Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
    return this.stats.leaderboard(m, n, this.parseCompetitionId(competitionId));
  }

  @Delete('data')
  async clear(@Query('competitionId') competitionId?: string) {
    const cid = this.parseCompetitionId(competitionId);
    const deleted = await this.store.clear(cid);
    return { ok: true, deleted, competitionId: cid ?? null };
  }
}
