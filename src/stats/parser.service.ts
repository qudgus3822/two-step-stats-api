import { Injectable, Logger } from '@nestjs/common';
import * as XLSX from 'xlsx';
import { ParsedEvent } from './types';
import { KNOWN_CODES, normalizeCode } from './scoring';

// 파싱 중 발견한 경고 (미등록 코드 등). 3년치 파일의 오타를 조기 발견하는 용도.
export interface ParseWarning {
  row: number; // 엑셀 기준 행 번호(1-based)
  player: string;
  code: string;
  message: string;
}

// [변경: 2026-07-14 17:32, 김병현 수정] 대회 모델 대개편 — 파서는 대회를 모른다.
// 엑셀엔 대회 칸이 없고, 대회는 업로드 폼(컨트롤러)이 정해서 적재 시점에 붙인다.
// 그래서 ParseResult 에서 season 필드를 뺐다(옛 season 옵션/파일명 fallback 도 함께 삭제).
export interface ParseResult {
  sheet: string; // 실제로 읽은 시트 이름
  events: ParsedEvent[]; // 정규화된 이벤트 목록(대회 없음)
  warnings: ParseWarning[];
  unknownCodes: string[]; // 발견된 미등록 코드 목록(중복 제거)
}

// 헤더 컬럼을 찾기 위한 키워드 사전. 셀 텍스트에 키워드가 포함되면 해당 필드로 인식.
const HEADER_KEYWORDS: Record<string, string[]> = {
  week: ['주차', 'week'],
  game: ['경기', 'game'],
  quarter: ['쿼터', 'quarter'],
  player: ['선수', '이름', 'player'],
  stat: ['스텟', '스탯', '기록', 'stat'],
  team: ['팀명', '팀', 'team'],
};

type Field = 'week' | 'game' | 'quarter' | 'player' | 'stat' | 'team';
type ColumnMap = Record<Field, number>;

@Injectable()
export class ParserService {
  private readonly logger = new Logger(ParserService.name);

  // 엑셀 버퍼를 파싱해서 정규화된 이벤트로 변환한다.
  // [변경: 2026-07-14 17:32, 김병현 수정] opts(season/filename) 제거 — 대회는 컨트롤러가 정한다.
  parseWorkbook(buffer: Buffer): ParseResult {
    const wb = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = this.pickSheet(wb);
    const ws = wb.Sheets[sheetName];

    // 2차원 배열로 변환 (빈 칸은 null 유지, 빈 행도 유지해서 행 번호를 맞춘다)
    const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, {
      header: 1,
      blankrows: true,
      defval: null,
      raw: true,
    });

    const detected = this.detectHeader(rows);
    if (!detected) {
      throw new Error(
        '헤더(주차/경기/쿼터/선수/스텟/팀명)를 찾지 못했습니다. Rawdata 시트 구조를 확인해주세요.',
      );
    }
    const { headerIndex, cols } = detected;

    const events: ParsedEvent[] = [];
    const warnings: ParseWarning[] = [];
    const unknown = new Set<string>();

    // 병합 셀 대비: 주차/경기/쿼터/팀명은 비어 있으면 직전 값으로 채운다(forward-fill).
    let lastWeek = 0;
    let lastGame = 0;
    let lastQuarter = 0;
    let lastTeam = '';

    for (let r = headerIndex + 1; r < rows.length; r++) {
      const row = rows[r] ?? [];
      const player = this.text(row[cols.player]);
      const rawStat = this.text(row[cols.stat]);

      // 주차/경기/쿼터/팀명 값 확정 (빈 칸이면 직전 값 유지)
      const week = this.int(row[cols.week], lastWeek);
      const game = this.int(row[cols.game], lastGame);
      const quarter = this.int(row[cols.quarter], lastQuarter);
      const teamCell = this.text(row[cols.team]);
      const team = teamCell || lastTeam;
      lastWeek = week;
      lastGame = game;
      lastQuarter = quarter;
      if (teamCell) lastTeam = teamCell;

      // 선수/스텟이 둘 다 없는 행은 데이터가 아님 (오른쪽 범례/빈 행) → 건너뜀
      if (!player || !rawStat) continue;

      const stat = normalizeCode(rawStat);
      if (!KNOWN_CODES.has(stat)) {
        unknown.add(stat);
        warnings.push({
          row: r + 1,
          player,
          code: stat,
          message: `미등록 스텟 코드 '${stat}' (${player}, ${r + 1}행)`,
        });
      }

      // [변경: 2026-07-14 17:32, 김병현 수정] 대회 없는 ParsedEvent 로 push(옛 season 필드 제거).
      events.push({ week, game, quarter, player, stat, team });
    }

    if (warnings.length > 0) {
      this.logger.warn(
        `미등록 코드 ${unknown.size}종 / 경고 ${warnings.length}건 (시트: ${sheetName})`,
      );
    }
    // [변경: 2026-07-14 17:32, 김병현 수정] 로그 문구에서 시즌 언급 제거(파서는 대회를 모름).
    this.logger.log(`파싱 완료: ${events.length}건 이벤트 (시트: ${sheetName})`);

    return {
      sheet: sheetName,
      events,
      warnings,
      unknownCodes: [...unknown],
    };
  }

  // 읽을 시트 선택: 이름이 'rawdata'와 비슷하면 우선, 없으면 첫 번째 시트
  private pickSheet(wb: XLSX.WorkBook): string {
    const raw = wb.SheetNames.find((n) =>
      n.replace(/\s+/g, '').toLowerCase().includes('rawdata'),
    );
    return raw ?? wb.SheetNames[0];
  }

  // 헤더 행 탐지: 앞쪽 행들을 훑어 6개 필드 중 4개 이상이 매칭되는 행을 헤더로 본다.
  private detectHeader(
    rows: unknown[][],
  ): { headerIndex: number; cols: ColumnMap } | null {
    const scanLimit = Math.min(rows.length, 30);
    for (let r = 0; r < scanLimit; r++) {
      const row = rows[r] ?? [];
      const cols: Partial<ColumnMap> = {};
      for (let c = 0; c < row.length; c++) {
        const field = this.matchField(this.text(row[c]));
        // 같은 필드가 여러 컬럼에 걸리면 가장 왼쪽(먼저 만난) 컬럼만 사용
        if (field && cols[field] === undefined) cols[field] = c;
      }
      const matched = Object.keys(cols).length;
      // 선수/스텟 컬럼은 반드시 있어야 하고, 전체 4개 이상 매칭되면 헤더로 확정
      if (matched >= 4 && cols.player !== undefined && cols.stat !== undefined) {
        return { headerIndex: r, cols: this.fillDefaults(cols) };
      }
    }
    return null;
  }

  // 셀 텍스트가 어떤 필드 헤더인지 판별 (우선순위: 키워드 사전 순서)
  private matchField(textValue: string): Field | null {
    const t = textValue.toLowerCase();
    if (!t) return null;
    for (const [field, kws] of Object.entries(HEADER_KEYWORDS)) {
      if (kws.some((kw) => t.includes(kw.toLowerCase()))) return field as Field;
    }
    return null;
  }

  // 탐지 못한 컬럼은 -1로 채워서 안전하게 처리 (해당 값은 forward-fill 기본값으로 대체됨)
  private fillDefaults(cols: Partial<ColumnMap>): ColumnMap {
    return {
      week: cols.week ?? -1,
      game: cols.game ?? -1,
      quarter: cols.quarter ?? -1,
      player: cols.player ?? -1,
      stat: cols.stat ?? -1,
      team: cols.team ?? -1,
    };
  }

  // 셀 → 문자열 (null/undefined는 빈 문자열)
  private text(cell: unknown): string {
    if (cell === null || cell === undefined) return '';
    return String(cell).trim();
  }

  // 셀 → 정수. 숫자나 '3주차' 같은 문자열에서 숫자를 뽑아내고, 없으면 fallback.
  private int(cell: unknown, fallback: number): number {
    if (typeof cell === 'number' && Number.isFinite(cell)) return Math.trunc(cell);
    const m = this.text(cell).match(/-?\d+/);
    return m ? parseInt(m[0], 10) : fallback;
  }
}
