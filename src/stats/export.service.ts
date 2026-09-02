import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import * as XLSX from 'xlsx';
// [변경: 2026-09-02 김병현 수정] 우승 기록 내보내기 — 데이터는 이쪽이 쥐고 있다.
import { ChampionshipService } from './championship.service';
import {
  CHAMPIONSHIP_SHEET_COUNTS,
  CHAMPIONSHIP_SHEET_TITLES,
  championshipFileName,
  toCountsGrid,
  toTitlesGrid,
} from './championshipExport';
import { CompetitionService } from './competition.service';
import { buildRawDataRows, rawDataFileName, toSheetGrid } from './rawExport';
import { StoreService } from './store.service';
import { ChampionshipExport, RawDataCell, RawDataExport } from './types';

/**
 * [신설: 2026-08-25 16:40, 김병현 작성]
 *
 * "원본(rawdata) 엑셀 내려받기" 담당.
 *
 * 밖에서 보이는 건 메서드 하나(buildWorkbook)뿐이고, 대회를 찾고 · 이벤트를 읽고 ·
 * 12칸으로 되돌리고 · 엑셀 바이트로 굽고 · 파일 이름까지 짓는 일은 전부 안에 숨는다.
 * 컨트롤러는 "만들어 줘 → 받은 걸 그대로 흘려보내"만 하면 된다.
 *
 * 시트 이름을 'rawdata' 로 쓰는 건 그냥 취향이 아니다 — 업로드 파서(parser.service.ts)의
 * pickSheet() 가 이름에 'rawdata' 가 들어간 시트를 우선으로 고른다. 즉 여기서 내보낸
 * 파일을 그대로 다시 업로드하면 파서가 같은 시트를 집는다(왕복이 닫힌다).
 */
@Injectable()
export class ExportService {
  private readonly logger = new Logger(ExportService.name);

  // 시트 이름 — 위 주석대로 업로드 파서가 이 이름을 보고 시트를 고른다. 바꾸지 말 것.
  private static readonly SHEET_NAME = 'rawdata';

  constructor(
    private readonly store: StoreService,
    private readonly competitions: CompetitionService,
    // [변경: 2026-09-02 김병현 수정] 우승 기록 내보내기용.
    private readonly championships: ChampionshipService,
  ) {}

  /**
   * 대회 하나(또는 전체)의 원본 데이터를 .xlsx 바이트로 만든다.
   *
   * competitionId 를 주면 그 대회만, 안 주면 전체 대회를 한 파일에 담는다
   * (원본 rawdata.xlsx 도 3년치가 한 시트에 다 들어 있는 모양이라 그 결을 따랐다).
   *
   * ⚠ competitionId 는 '필터'가 아니라 '지목'이다 — 없는 대회 id 면 404 를 던진다.
   *   다른 조회(/players 등)는 없는 id 에 빈 배열을 주지만, 내려받기에서 그렇게 하면
   *   사용자는 "헤더만 있는 빈 파일"을 받고 뭐가 잘못됐는지 알 길이 없다.
   *   (/growth 가 같은 이유로 404 를 쓴다.)
   */
  async buildWorkbook(competitionId?: number): Promise<RawDataExport> {
    const started = Date.now();

    // 대회 목록과 이벤트는 서로를 안 기다려도 된다. DB 가 원격(Supabase)이라 왕복이 아깝다.
    // (이벤트 쪽은 보통 StoreService 캐시에서 바로 나온다.)
    const [competitions, events] = await Promise.all([
      this.competitions.list(),
      this.store.getEvents({ competitionId }),
    ]);

    // 지목한 대회가 등록부에 없으면 여기서 끊는다(위 ⚠ 참고).
    const target = competitionId != null
      ? competitions.find((c) => c.id === competitionId) ?? null
      : null;
    if (competitionId != null && target === null) {
      throw new NotFoundException(`대회를 찾을 수 없습니다: ${competitionId}`);
    }

    const { rows, skipped } = buildRawDataRows(events, competitions);
    if (skipped > 0) {
      // 등록부에 없는 대회를 참조하는 이벤트 = 정상 경로로는 생길 수 없다(FK 가 막는다).
      // 그래도 생겼다면 행이 조용히 사라지는 것이므로 반드시 로그를 남긴다.
      this.logger.warn(`대회 정보를 못 찾아 건너뛴 이벤트 ${skipped}건 — 등록부를 확인하세요.`);
    }

    const sheet = XLSX.utils.aoa_to_sheet(toSheetGrid(rows));
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, ExportService.SHEET_NAME);
    // type:'buffer' 는 Node Buffer 를 준다(브라우저용 base64/binary 문자열이 아니라).
    // compression:true 는 xlsx 내부 zip 을 실제로 압축한다 — 7만 행짜리에서 파일이 몇 배 작아진다.
    const buffer = XLSX.write(book, {
      type: 'buffer',
      bookType: 'xlsx',
      compression: true,
    }) as Buffer;

    const fileName = rawDataFileName(target, this.todayStamp());
    this.logger.log(
      `원본 데이터 내보내기: ${rows.length.toLocaleString()}행 · ${fileName} · ${Date.now() - started}ms`,
    );
    return { buffer, fileName, rowCount: rows.length };
  }

  /**
   * [신설: 2026-09-02 김병현 작성] 우승 기록을 시트 2장짜리 .xlsx 로 만든다.
   *
   *   '우승'     — 연도 헤더줄 + (시즌 | 팀명 | 멤버들). 원본 rawdata.xlsx 의 '우승' 시트 모양.
   *   '우승횟수' — 선수명 | 우승횟수. 원본 '선수명' 시트의 우승횟수 칸을 뽑아낸 표.
   *
   * rawdata 내보내기와 달리 **대회를 고르지 않는다** — 우승 기록은 통산으로 보는 게 기본이고
   * (표의 요점이 '누가 몇 번'이다), 전부 합쳐야 수백 줄이라 나눌 이유가 없다.
   *
   * 기록이 하나도 없어도 에러가 아니다. 헤더만 있는 파일이 정상적인 답이다
   * (rawdata 쪽이 404 를 던지는 건 '없는 대회를 지목했을 때'라 상황이 다르다).
   */
  async buildChampionshipWorkbook(): Promise<ChampionshipExport> {
    const started = Date.now();
    const { wins, playerWins } = await this.championships.overview();

    const book = XLSX.utils.book_new();
    this.appendSheet(book, CHAMPIONSHIP_SHEET_TITLES, toTitlesGrid(wins));
    this.appendSheet(book, CHAMPIONSHIP_SHEET_COUNTS, toCountsGrid(playerWins));

    const buffer = XLSX.write(book, {
      type: 'buffer',
      bookType: 'xlsx',
      compression: true,
    }) as Buffer;

    const fileName = championshipFileName(this.todayStamp());
    this.logger.log(
      `우승 기록 내보내기: 우승 ${wins.length}줄 · 선수 ${playerWins.length}명 · ${fileName} · ${Date.now() - started}ms`,
    );
    // rowCount 는 '우승 줄 수'다 — 화면이 "몇 건 받았어요"로 보여주는 값.
    return { buffer, fileName, rowCount: wins.length };
  }

  // 격자 하나를 시트로 만들어 통에 붙인다. 시트가 둘 이상이라 세 줄이 반복돼서 묶어 뒀다.
  private appendSheet(book: XLSX.WorkBook, name: string, grid: RawDataCell[][]): void {
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(grid), name);
  }

  // 파일 이름에 붙일 오늘 날짜(YYYYMMDD). 서버 지역시간 기준 — 이 앱은 한 지역에서만 쓴다.
  // 날짜를 붙이는 이유: 같은 대회를 여러 번 내려받아도 다운로드 폴더에서 서로 안 덮어쓴다.
  private todayStamp(): string {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${now.getFullYear()}${month}${day}`;
  }
}
