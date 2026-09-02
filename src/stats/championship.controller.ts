import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Post,
  Query,
  // 파일 바이트를 직접 내려보내야 해서 응답 객체(@Res)와 파일 응답 타입이 필요하다.
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';
import { ChampionshipService } from './championship.service';
import { ExportService } from './export.service';

/**
 * [신설: 2026-09-02 김병현 작성] 우승 기록 관리 API.
 *
 * StatsController 에 얹지 않고 파일을 나눈 이유: 저 파일은 이미 500줄이 넘고, 우승은
 * 스탯 집계와 데이터도 규칙도 겹치는 게 없다(경기 기록을 '읽기만' 한다). 붙여 놨다면
 * "대회 id 파싱은 왜 두 벌이지" 같은 걸 매번 되묻게 된다.
 *
 * 경로는 전부 /api/championships 아래다(main.ts 의 setGlobalPrefix('api')).
 */
@Controller('championships')
export class ChampionshipController {
  constructor(
    private readonly championships: ChampionshipService,
    private readonly exporter: ExportService,
  ) {}

  // ⚠ 이 메서드는 다른 GET 보다 위에 있어야 한다.
  //   나중에 GET 'championships/:id' 같은 경로가 생기면 'export' 를 id 로 삼켜 버린다.
  //   지금은 그런 경로가 없지만, 순서를 지켜 두면 나중에 생겨도 안 깨진다.
  //
  // 왜 @Res 를 쓰나: 파일 이름에 날짜가 들어가 매번 달라서 @Header()(고정값)로는 못 붙인다.
  // passthrough:true 라 응답을 직접 끝내지 않는다 — 헤더만 얹고 나머지는 Nest 에 맡긴다.
  //
  // ⚠ 파일 이름과 건수는 본문이 아니라 헤더에 있다. 브라우저 fetch 가 이 헤더를 읽으려면
  //   main.ts 의 enableCors 에 exposedHeaders 로 열어 둬야 한다
  //   (안 열면 에러 없이 파일 이름이 조용히 'download' 가 된다).
  @Get('export')
  async exportChampionships(
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const file = await this.exporter.buildChampionshipWorkbook();
    res.set({
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      // 파일 이름은 ASCII 라 예비값만으로 충분하지만, rawdata 내보내기와 모양을 맞춰
      // RFC 5987 형식도 같이 보낸다(나중에 이름에 한글이 섞여도 안 깨지게).
      'Content-Disposition':
        `attachment; filename="championships.xlsx"; ` +
        `filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
      'X-Championship-Rows': String(file.rowCount),
    });
    return new StreamableFile(file.buffer);
  }

  // 우승 관리 화면의 선수 표. competitionId 는 '지목'이라 필수(없으면 400, 없는 대회면 404).
  // 다른 조회처럼 "생략 = 전체 대회"로 두지 않는 이유: 이 표의 모든 숫자가 '그 대회 안에서
  // 몇 경기'라는 비율이라, 전체 대회에는 뜻이 정의되지 않는다(/growth 가 같은 이유로 필수다).
  @Get('roster')
  roster(@Query('competitionId') competitionId?: string) {
    return this.championships.roster(this.requireCompetitionId(competitionId));
  }

  // 우승 기록 전체 + 선수별 통산 횟수. 둘을 한 번에 주는 이유는 서비스 주석 참고.
  @Get()
  overview() {
    return this.championships.overview();
  }

  // 우승자로 찍기(+). 같은 대회 같은 선수면 몇 번 눌러도 결과가 같다(멱등).
  //
  // ⚠ 팀 이름은 일부러 안 받는다. 서버가 저장 시점에 다시 계산한다 —
  //   화면이 낡은 채 오래 열려 있었으면 엉뚱한 팀이 영구히 박히기 때문이다.
  @Post()
  add(@Body('competitionId') competitionId?: number, @Body('player') player?: string) {
    return this.championships.add(
      this.requireCompetitionId(competitionId),
      player ?? '',
    );
  }

  // 우승 취소. 없는 걸 지워도 에러가 아니다(멱등) — 지워진 줄 수만 알려준다.
  @Delete()
  async remove(
    @Query('competitionId') competitionId?: string,
    @Query('player') player?: string,
  ) {
    const cid = this.requireCompetitionId(competitionId);
    const deleted = await this.championships.remove(cid, player ?? '');
    return { ok: true, competitionId: cid, player: player ?? '', deleted };
  }

  // 쿼리/본문의 대회 id → 양의 정수. 아니면 400.
  //
  // StatsController 의 parseCompetitionId 와 다른 함수인 이유: 저쪽은 "못 읽으면 전체 대회"라
  // undefined 를 돌려주는 관용적인 파서다. 여기선 대회를 못 읽으면 할 수 있는 일이 없다 —
  // 조용히 전체로 넘어가면 엉뚱한 대회에 우승이 박힌다. 그래서 되묻지 않고 끊는다.
  private requireCompetitionId(raw?: string | number): number {
    const n = Number(raw);
    if (!Number.isInteger(n) || n <= 0) {
      throw new BadRequestException('대회(competitionId)를 양의 정수로 지정하세요.');
    }
    return n;
  }
}
