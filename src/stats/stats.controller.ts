import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Logger,
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
// [변경: 2026-07-27 16:14, 김병현 수정] 시너지 탭용 지표 목록·타입 추가.
import { SYNERGY_METRICS, SynergyMetric } from './synergy';
// [변경: 2026-07-28 15:00, 김병현 수정] 기량 발전 탭용 지표 목록·타입 추가.
import { GROWTH_METRICS, GrowthMetric } from './growth';
// [변경: 2026-07-14 17:32, 김병현 수정] 대회 등록부 서비스 주입 (season.service → competition.service 리네임)
import { CompetitionService } from './competition.service';
// [신설: 2026-07-29 15:31, 김병현 작성] 처음 보는 선수 이름 판정(순수 모듈).
import { findNewPlayers } from './playerCheck';
import { GameConflict, NewPlayer, UploadConflictBody } from './types';

@Controller()
export class StatsController {
  // [신설: 2026-07-29 15:31, 김병현 작성] 이름 조회 실패를 '조용히 넘기되 흔적은 남기려고' 쓴다.
  private readonly logger = new Logger(StatsController.name);

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
  //       'GET /players/:name?competitionId=': '선수 상세(누적 + 경기별 추이)',
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
    // [변경: 2026-07-15 14:10, 김병현 수정] 덮어쓰기 확인 후 강행 재전송 시 붙는 플래그.
    @Query('force') force?: string,
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
    // [변경: 2026-07-15 14:10, 김병현 수정] replace 인데 force 아니면, 쓰기 전에 중복 경기부터 확인.
    // [변경: 2026-07-29 15:31, 김병현 수정] 위 줄은 옛 동작 설명이다 —
    // 아래 관문 통합으로 조건이 '!useForce' 하나로 넓어졌고, 보는 것도 중복 경기 + 처음 보는 이름 둘이다.
    const useForce = (force ?? '').toLowerCase() === 'true';
    // [변경: 2026-07-29 15:31, 김병현 수정] 확인 관문을 '하나'로 합친다.
    //  - 겹친 경기 검사: 예전 그대로 replace 일 때만 (append 는 덮어쓰는 게 아니라 물을 게 없다)
    //  - 처음 보는 이름 검사: mode 와 무관하게 항상 (append 로도 오타는 똑같이 들어간다)
    // 둘 중 하나라도 걸리면 409 를 '한 번' 던진다. 그래야 사용자가 모달을 두 번 보지 않는다.
    // force=true 는 이 관문 전체를 건너뛴다 = 사용자가 둘 다 확인했다는 뜻.
    if (!useForce) {
      // 두 조회는 서로를 안 기다려도 된다. DB 가 원격(Supabase)이라 왕복 한 번이 아깝다.
      //
      // [신설: 2026-07-29 15:31, 김병현 작성] ⚠ 두 쿼리의 '실패 정책'이 다르다.
      //  - 겹친 경기 조회가 실패하면 → 그대로 터뜨린다(500). 못 물어보고 저장하면 덮어쓰기 사고가 난다.
      //  - 이름 조회가 실패하면 → 삼킨다. 이 검사는 '차단'이 아니라 '확인'이다. 보조 질문 하나가
      //    실패했다고 사용자의 저장을 통째로 막으면, 얻는 것(오타 알림) 없이 잃는 것(업로드 실패)만 남는다.
      // null = "못 물어봤다". 빈 배열 = "정말 아무도 없다"(첫 업로드) 와 반드시 구분한다
      //   — 나중에 "이번엔 이름 확인을 못 했어요" 배너를 붙이려면 이 구분이 있어야 한다.
      const [games, knownPlayerNames] = await Promise.all([
        useAppend
          ? Promise.resolve<GameConflict[]>([])
          : this.store.findExistingGames(competition.id, parsed.events),
        this.store.listKnownPlayerNames().catch((err: unknown) => {
          this.logger.warn(
            `선수 이름 목록 조회 실패 — 이름 확인을 건너뜁니다: ${(err as Error).message}`,
          );
          return null;
        }),
      ]);
      const newPlayers: NewPlayer[] = knownPlayerNames
        ? findNewPlayers(parsed.events.map((e) => e.player), knownPlayerNames)
        : [];
      if (games.length > 0 || newPlayers.length > 0) {
        // satisfies 로 응답 모양을 계약(UploadConflictBody)에 묶는다 — 필드를 빠뜨리면 컴파일이 막는다.
        throw new ConflictException({
          conflict: true,
          competitionId: competition.id,
          competition: competition.label,
          games,
          newPlayers,
          message: this.uploadConflictMessage(games, newPlayers),
        } satisfies UploadConflictBody);
      }
    }
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
      // [신설: 2026-07-31 15:02, 김병현 작성] 한글로 친 코드를 되돌려 인식한 결과(종류·건수).
      // 조용히 바뀌면 안 되니 화면까지 그대로 흘려보낸다.
      hangulCodes: parsed.hangulCodes,
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

  // [신설: 2026-07-29 15:31, 김병현 작성] 409 본문의 사람이 읽는 한 줄.
  // 화면(모달)은 games/newPlayers 배열을 보고 제 문구를 직접 만든다 — 이 문자열은 API 를 직접
  // 두드리는 사람과 로그를 위한 것이다.
  // 이름을 나열하지 않고 '개수만' 쓰는 이유: 이름은 어차피 newPlayers 배열에 다 들어 있다.
  // 여기서 또 잘라 쓰면 '몇 명까지 보여줄까' 규칙이 서버와 모달 두 곳에 서로 다른 값으로 생긴다.
  private uploadConflictMessage(games: GameConflict[], newPlayers: NewPlayer[]): string {
    const parts: string[] = [];
    if (games.length > 0) {
      parts.push(
        `이미 등록된 경기가 ${games.length}개 있어요 (` +
          games.map((g) => `${g.week}주차 ${g.game}경기`).join(', ') +
          ')',
      );
    }
    if (newPlayers.length > 0) {
      parts.push(`처음 보는 선수 이름이 ${newPlayers.length}명 있어요`);
    }
    return `${parts.join(' · ')}. 이대로 진행할까요?`;
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

  // [변경: 2026-07-27 15:00, 김병현 수정] 대회 필터 추가(/players, /leaderboard 와 같은 패턴).
  @Get('players/:name')
  async player(
    @Param('name') name: string,
    @Query('competitionId') competitionId?: string,
  ) {
    const detail = await this.stats.player(name, this.parseCompetitionId(competitionId));
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

  // [변경: 2026-07-27 16:14, 김병현 수정] 시너지 탭용 — 기준 선수 하나에 대한 동료별 WOWY 리포트.
  // player 는 필수(빈 값이면 400), metric 기본값은 eff. 기록이 없는 이름은 404가 아니라 빈 리포트다
  // (이름이 경로가 아니라 '필터'라서 — /players?competitionId= 가 빈 배열을 주는 것과 같은 결).
  @Get('synergy')
  synergy(
    @Query('player') player?: string,
    @Query('metric') metric?: string,
    @Query('competitionId') competitionId?: string,
  ) {
    const name = (player ?? '').trim();
    if (!name) throw new BadRequestException('기준 선수(player)를 지정하세요.');
    const m = (metric ?? 'eff') as SynergyMetric;
    if (!SYNERGY_METRICS.includes(m)) {
      throw new BadRequestException(
        `지원하지 않는 지표입니다. 사용 가능: ${SYNERGY_METRICS.join(', ')}`,
      );
    }
    return this.stats.synergy(name, m, this.parseCompetitionId(competitionId));
  }

  // [변경: 2026-07-28 15:00, 김병현 수정] 기량 발전 탭 — 고른 대회와 그 직전 대회를 비교한 리포트.
  // competitionId 는 '필터'가 아니라 '지목'이라 필수(없으면 400)이고, 없는 대회면 404 다.
  // (다른 조회에서 competitionId 생략 = 전체 대회지만, 여기선 전체 대회에 직전 시즌이 정의되지 않는다.)
  @Get('growth')
  async growth(
    @Query('competitionId') competitionId?: string,
    @Query('metric') metric?: string,
  ) {
    const cid = this.parseCompetitionId(competitionId);
    if (cid == null) throw new BadRequestException('대회(competitionId)를 지정하세요.');
    const m = (metric ?? 'eff') as GrowthMetric;
    if (!GROWTH_METRICS.includes(m)) {
      throw new BadRequestException(
        `지원하지 않는 지표입니다. 사용 가능: ${GROWTH_METRICS.join(', ')}`,
      );
    }
    const report = await this.stats.growth(cid, m);
    if (!report) throw new NotFoundException(`대회를 찾을 수 없습니다: ${cid}`);
    return report;
  }

  // [신설: 2026-07-29 11:10, 김병현 작성] 이벤트 캐시 수동 비우기.
  //
  // 캐시는 TTL 이 없다 — 이 서버를 거친 쓰기(업로드/삭제)에서만 스스로 버린다. 그래서
  // 서버를 안 거치고 DB 를 바꾸면(scripts/seed.ts, scripts/import-legacy-xlsx.ts,
  // Supabase 콘솔 직접 수정) 캐시가 영영 낡은 채로 남는다. 그때 쓰는 탈출구다.
  // 서버 재시작으로도 같은 효과가 나지만, 재시작 없이 처리하려고 둔다.
  //
  // 인증은 없다 — 기존 DELETE /data 와 같은 수준이다(그쪽이 훨씬 위험한데도 열려 있다).
  // 하는 일은 "다음 요청 때 DB 를 한 번 더 읽어라"뿐이라, 눌려도 잠깐 느려질 뿐 데이터는 안전하다.
  @Post('cache/refresh')
  refreshCache() {
    this.store.invalidateAll();
    return { ok: true };
  }

  @Delete('data')
  async clear(@Query('competitionId') competitionId?: string) {
    const cid = this.parseCompetitionId(competitionId);
    const deleted = await this.store.clear(cid);
    return { ok: true, deleted, competitionId: cid ?? null };
  }
}
