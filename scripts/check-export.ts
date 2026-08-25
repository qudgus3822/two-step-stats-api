/**
 * [신설: 2026-08-25 16:40, 김병현 작성] 원본(rawdata) 내보내기 검증 스크립트.
 *
 * 실행: npm run check:export
 *
 * DB·Nest 없이 돈다. 실제 원본 파일(scripts/fixtures/rawdata.xlsx)을 재료로 써서
 * "읽기 → 내보내기 → 다시 읽기" 왕복을 메모리 안에서 통째로 돌린다.
 * (다른 check-*.ts 와 같은 스타일: 수동 eq/fail 헬퍼 + process.exit(0|1). 이 레포엔 jest 가 없다.)
 *
 * ⚠ 이 파일은 `npm run build`(= nest build) 로 타입 검사가 안 된다 — tsconfig.build.json 이
 *   scripts 를 exclude 한다. 반드시 `npm run check:export` 로 직접 돌려서 확인할 것.
 *
 * ⚠ "아무것도 안 봤는데 초록불"을 막는 장치: 표마다 '훑은 수'를 같이 단언한다.
 *   루프가 0회 돌면 불일치도 0이라 그냥 세기만 해서는 초록불이 나온다.
 *
 * 검증 표
 *  E1 칸 이름·순서    — 내보낸 시트 첫 줄이 원본 12칸과 글자까지 같은가
 *  E2 파생값 대조     — 주차인덱스·득점을 원본 파일의 실제 값과 전 행 비교 (제일 중요)
 *  E3 행 수 보존      — 넣은 이벤트 수 = 내보낸 데이터 행 수 (조용히 사라지는 행 없음)
 *  E4 왕복(업로드)    — 내보낸 파일을 업로드 파서(parser.service)가 그대로 되읽는가
 *                       (원본에 있던 오타 코드까지 그대로 보존되는지 포함)
 *  E5 정렬            — 연도 → 시즌 → 주차 → 경기 → 쿼터 오름차순인가
 *  E6 빈칸 규칙       — 팀index·활동여부는 항상 빈칸, 0점 코드의 득점도 빈칸인가
 *  E7 파일 이름       — 대회 라벨/전체·금지문자 치환
 */
import * as fs from 'fs';
import * as path from 'path';
import * as XLSX from 'xlsx';
import { ParserService } from '../src/stats/parser.service';
import {
  RAWDATA_HEADERS,
  buildRawDataRows,
  rawDataFileName,
  toSheetGrid,
  type CompetitionMeta,
} from '../src/stats/rawExport';
import { pointsForStat } from '../src/stats/scoring';
import type { StatEvent } from '../src/stats/types';
import { parseLegacyWorkbook } from './legacyXlsxReader';

const FIXTURE = path.join(__dirname, 'fixtures', 'rawdata.xlsx');

let failures = 0;
let checks = 0;

function eq(label: string, actual: unknown, expected: unknown): void {
  checks++;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failures++;
    console.error(`  ✗ ${label}\n      기대: ${JSON.stringify(expected)}\n      실제: ${JSON.stringify(actual)}`);
  } else {
    console.log(`  ✓ ${label}`);
  }
}

// ── 재료 준비: 원본 파일 → (가짜) 대회 목록 + 이벤트 목록 ────────────────────
// DB 를 안 쓰므로 대회 행은 여기서 만들어 낸다. (연도, 시즌번호) 조합마다 id 를 하나씩 준다 —
// 실제 적재 스크립트(import-legacy-xlsx.ts)가 하는 그룹핑과 같은 기준이다.
function loadFixture(): {
  events: StatEvent[];
  competitions: CompetitionMeta[];
  unknownCodes: string[];
} {
  const buffer = fs.readFileSync(FIXTURE);
  const parsed = parseLegacyWorkbook(buffer);

  const competitions: CompetitionMeta[] = [];
  const idByKey = new Map<string, number>();
  const events: StatEvent[] = [];

  for (const row of parsed.rows) {
    const key = `${row.year}|${row.seasonNo}`;
    let id = idByKey.get(key);
    if (id === undefined) {
      id = competitions.length + 1;
      idByKey.set(key, id);
      competitions.push({ id, year: row.year, seasonNo: row.seasonNo, name: '-' });
    }
    events.push({
      competitionId: id,
      competitionLabel: `${row.year} 시즌${row.seasonNo} · -`,
      week: row.week,
      game: row.game,
      quarter: row.quarter,
      player: row.player,
      stat: row.stat,
      team: row.team,
    });
  }
  // 원본에 이미 있는 미등록 코드(사람이 낸 오타)도 같이 넘긴다 — E4 가 '보존'을 확인하는 데 쓴다.
  return { events, competitions, unknownCodes: parsed.unknownCodes };
}

// 행 배열 → 엑셀 바이트 → 다시 2차원 배열. 실제 서비스가 굽는 방식과 같게 맞춘다.
function roundTrip(grid: unknown[][]): { buffer: Buffer; grid: unknown[][] } {
  const sheet = XLSX.utils.aoa_to_sheet(grid);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'rawdata');
  const buffer = XLSX.write(book, { type: 'buffer', bookType: 'xlsx', compression: true }) as Buffer;

  const reread = XLSX.read(buffer, { type: 'buffer' });
  const back = XLSX.utils.sheet_to_json<unknown[]>(reread.Sheets['rawdata'], {
    header: 1,
    blankrows: true,
    defval: null,
    raw: true,
  });
  return { buffer, grid: back };
}

function main(): void {
  if (!fs.existsSync(FIXTURE)) {
    console.error(`원본 파일이 없습니다: ${FIXTURE}`);
    process.exit(1);
  }

  console.log('원본 파일 읽는 중…');
  const { events, competitions, unknownCodes: sourceUnknown } = loadFixture();
  console.log(`  이벤트 ${events.length.toLocaleString()}건 · 대회 ${competitions.length}개\n`);

  const { rows, skipped } = buildRawDataRows(events, competitions);
  const grid = toSheetGrid(rows);
  const { buffer, grid: back } = roundTrip(grid);

  // ── E1 칸 이름·순서 ────────────────────────────────────────────────────────
  console.log('E1 칸 이름·순서');
  eq('헤더 12칸', back[0], RAWDATA_HEADERS);
  eq('칸 개수', RAWDATA_HEADERS.length, 12);
  // 원본 파일의 헤더와 글자까지 같은지 — 이게 어긋나면 기존 엑셀 수식이 깨진다.
  const originalBook = XLSX.read(fs.readFileSync(FIXTURE), { type: 'buffer' });
  const originalGrid = XLSX.utils.sheet_to_json<unknown[]>(originalBook.Sheets['rawdata'], {
    header: 1,
    raw: true,
    defval: null,
  });
  eq('원본 파일 헤더와 일치', originalGrid[0], RAWDATA_HEADERS);

  // ── E2 파생값 대조 (제일 중요) ─────────────────────────────────────────────
  // 우리가 계산해 채우는 주차인덱스·득점을, 원본 파일에 사람이 넣어 둔 실제 값과 비교한다.
  // 원본 행과 우리 행은 순서가 다를 수 있으므로 "원본 행 → 기대값" 방향으로 직접 검사한다.
  console.log('\nE2 파생값 대조 (원본 파일의 실제 값과 비교)');
  let scanned = 0;
  let weekIndexBad = 0;
  let pointsBad = 0;
  for (let r = 1; r < originalGrid.length; r++) {
    const row = originalGrid[r];
    if (!row || row[5] == null || row[6] == null) continue; // 선수/스텟 없는 줄은 데이터가 아님
    scanned++;
    const [year, season, week, game] = row as [number, number, number, number];
    const code = String(row[6]).trim().toUpperCase();
    if (String(row[10]) !== `${year}S${season}W${week}G${game}`) weekIndexBad++;
    const filePoints = row[11] === '' || row[11] == null ? 0 : Number(row[11]);
    if (pointsForStat(code) !== filePoints) pointsBad++;
  }
  // '훑은 수'를 먼저 단언한다 — 루프가 0회 돌아 생기는 가짜 초록불을 막는다.
  eq('훑은 원본 행 수 > 70,000', scanned > 70000, true);
  eq('주차인덱스 불일치', weekIndexBad, 0);
  eq('득점 불일치', pointsBad, 0);

  // ── E3 행 수 보존 ──────────────────────────────────────────────────────────
  console.log('\nE3 행 수 보존');
  eq('건너뛴 이벤트', skipped, 0);
  eq('행 수 = 이벤트 수', rows.length, events.length);
  eq('시트 데이터 줄 수 = 행 수', back.length - 1, rows.length);

  // ── E4 왕복: 내보낸 파일을 업로드 파서가 되읽는가 ──────────────────────────
  // 이게 이 기능의 존재 이유다 — 내려받은 파일을 그대로 다시 올릴 수 있어야 한다.
  console.log('\nE4 왕복 (내보낸 파일 → 업로드 파서)');
  const reparsed = new ParserService().parseWorkbook(buffer);
  eq('파서가 고른 시트', reparsed.sheet, 'rawdata');
  eq('되읽은 이벤트 수', reparsed.events.length, rows.length);
  // '미등록 코드가 없어야 한다'가 아니라 '원본과 똑같아야 한다'로 본다.
  // 원본 rawdata.xlsx 엔 이미 사람이 낸 오타 코드가 들어 있다(예: 'R' 1건). 내보내기는
  // 그걸 고치는 기능이 아니라 **있는 그대로 보존**하는 기능이다 — 없애 버리면 오히려 사고다.
  // 그래서 여기서 보는 건 "내보내기가 새 오타를 만들지도, 있던 오타를 지우지도 않았나"다.
  eq(
    '미등록 코드가 원본 그대로 보존됨',
    [...reparsed.unknownCodes].sort(),
    [...sourceUnknown].sort(),
  );
  // 앞뒤 표본이 아니라 전 행을 대조한다(중간만 어긋나는 사고를 잡으려면 전수여야 한다).
  let mismatched = 0;
  for (let i = 0; i < rows.length; i++) {
    const a = rows[i];
    const b = reparsed.events[i];
    if (
      !b ||
      a.week !== b.week ||
      a.game !== b.game ||
      a.quarter !== b.quarter ||
      a.player !== b.player ||
      String(a.stat) !== b.stat ||
      a.team !== b.team
    ) {
      mismatched++;
    }
  }
  eq('대조한 행 수', rows.length > 70000, true);
  eq('왕복 불일치 행', mismatched, 0);

  // ── E5 정렬 ────────────────────────────────────────────────────────────────
  console.log('\nE5 정렬 (연도 → 시즌 → 주차 → 경기 → 쿼터)');
  let outOfOrder = 0;
  for (let i = 1; i < rows.length; i++) {
    const p = rows[i - 1];
    const c = rows[i];
    const keyP = [p.year, Number(p.seasonNo), p.week, p.game, p.quarter];
    const keyC = [c.year, Number(c.seasonNo), c.week, c.game, c.quarter];
    for (let k = 0; k < keyP.length; k++) {
      if (keyP[k] < keyC[k]) break;
      if (keyP[k] > keyC[k]) {
        outOfOrder++;
        break;
      }
    }
  }
  eq('순서 어긋난 행', outOfOrder, 0);

  // ── E6 빈칸 규칙 ───────────────────────────────────────────────────────────
  console.log('\nE6 빈칸 규칙');
  const teamIndexFilled = rows.filter((r) => r.teamIndex !== '').length;
  const activeFilled = rows.filter((r) => r.active !== '').length;
  eq('팀index 는 항상 빈칸', teamIndexFilled, 0);
  eq('활동여부 는 항상 빈칸', activeFilled, 0);
  // 0점 코드(DR/A/S/T/…)는 득점이 빈칸, 점수 나는 코드는 숫자여야 한다.
  const zeroCodeWithNumber = rows.filter(
    (r) => pointsForStat(String(r.stat)) === 0 && r.points !== '',
  ).length;
  const scoringCodeWithBlank = rows.filter(
    (r) => pointsForStat(String(r.stat)) > 0 && r.points === '',
  ).length;
  eq('0점 코드인데 숫자가 찍힌 행', zeroCodeWithNumber, 0);
  eq('득점 코드인데 빈칸인 행', scoringCodeWithBlank, 0);
  // 숫자만으로 된 코드는 숫자 셀이어야 한다(엑셀 경고 삼각형 방지).
  const digitCodeNotNumber = rows.filter(
    (r) => /^\d+$/.test(String(r.stat)) && typeof r.stat !== 'number',
  ).length;
  eq('숫자 코드가 문자열로 저장된 행', digitCodeNotNumber, 0);

  // ── E7 파일 이름 ───────────────────────────────────────────────────────────
  console.log('\nE7 파일 이름');
  eq('전체', rawDataFileName(null, '20260825'), 'rawdata_전체_20260825.xlsx');
  eq(
    '시즌번호 있는 대회',
    rawDataFileName({ id: 1, year: 2023, seasonNo: 1, name: '나이배' }, '20260825'),
    'rawdata_2023 시즌1 · 나이배_20260825.xlsx',
  );
  eq(
    '시즌번호 없는 대회',
    rawDataFileName({ id: 1, year: 2026, seasonNo: null, name: '나이배' }, '20260825'),
    'rawdata_2026 나이배_20260825.xlsx',
  );
  eq(
    '파일 이름 금지문자 치환',
    rawDataFileName({ id: 1, year: 2026, seasonNo: null, name: 'a/b:c*d?' }, '20260825'),
    'rawdata_2026 a_b_c_d__20260825.xlsx',
  );

  // ── 마무리 ─────────────────────────────────────────────────────────────────
  console.log(
    `\n생성된 파일 크기: ${(buffer.length / 1024 / 1024).toFixed(2)} MB (${rows.length.toLocaleString()}행)`,
  );
  console.log(`\n총 ${checks}개 검사 · 실패 ${failures}개`);
  if (failures > 0) {
    console.error('❌ 실패');
    process.exit(1);
  }
  console.log('✅ 전부 통과');
  process.exit(0);
}

main();
