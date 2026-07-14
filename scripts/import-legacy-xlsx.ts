/**
 * 과거 기록 엑셀(xlsx) → 새 FK 스키마로 넣는 단발성 import 스크립트.
 *
 * 실행:
 *   npm run import:legacy -- <xlsx경로>            # 실제 적재
 *   npm run import:legacy -- <xlsx경로> --dry-run  # DB 안 건드리고 요약만
 *   DRY_RUN=1 npm run import:legacy -- <xlsx경로>   # 위와 동일
 *   ( npm 은 `--` 뒤 인자를 스크립트로 넘긴다. `--` 빼먹으면 경로가 안 전달된다. )
 *
 * 전제: 새 FK 스키마(Competition, StatEvent.competitionId)가 이미 적용돼 있고
 *   `npx prisma generate` 로 client 가 재생성돼 있어야 한다(안 그러면 prisma.competition 타입 없음).
 *
 * 데이터엔 팀·대회명 칸이 없다 → team='-', name='-' 로 채운다(사용자 지정).
 * 엑셀 '시즌' 칸 → seasonNo, '연도' → year. 라벨은 앱의 competitionLabel() 을 그대로 재사용한다.
 */
import * as fs from 'fs';
import { PrismaClient } from '@prisma/client';
import {
  parseLegacyWorkbook,
  summarizeRows,
  ParseResult,
} from './legacyXlsxReader';
// 앱의 정본 라벨 규칙을 재사용한다 → 업로드 화면이 만드는 라벨과 import 가 만드는 라벨이 문자까지
// 같아, 같은 label 로 upsert 되어 같은 Competition 행에 수렴한다(라벨 규칙의 단일 진실원).
// (이 import 는 competition.service 를 거쳐 @nestjs/common·PrismaService 를 끌어오지만,
//  런타임에 클래스를 인스턴스화하지 않으니 무해하다 — ts-node 가 모듈을 로드만 한다.)
import { competitionLabel } from '../src/stats/competition.service';

// 원본에 팀·대회명이 없어서 쓰는 상수. 나중에 실제 값이 생기면 그때 갱신한다.
const TEAM = '-';
const NAME = '-';

// 적재 결과 요약(사람이 눈으로 확인하는 값).
interface LoadSummary {
  competitions: {
    year: number;
    seasonNo: number;
    name: string; // 항상 '-'
    label: string; // 예: '2023 시즌1 · -'
    competitionId: number; // upsert 로 얻은 competitions.id
    inserted: number; // 이 대회에 createMany 로 넣은 이벤트 수
  }[];
  totalInserted: number; // 전 대회 insert 합
  unknownCodes: string[]; // 파싱에서 발견된 미등록 코드(중복 제거)
}

// 파싱 결과를 DB에 멱등 적재하고 요약을 돌려준다.
// 멱등 범위 = 파일에 든 대회((year,seasonNo) 그룹)뿐. competitionId 로만 지우고 다시 넣으니
// 다른 대회는 안 건드린다. 같은 파일을 다시 돌려도 결과가 같다.
async function loadIntoDb(
  prisma: PrismaClient,
  result: ParseResult,
): Promise<LoadSummary> {
  // (year, seasonNo) 로 그룹핑(대회 단위).
  const groups = new Map<string, ParseResult['rows']>();
  for (const r of result.rows) {
    const key = `${r.year}|${r.seasonNo}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(r);
    else groups.set(key, [r]);
  }

  const competitions: LoadSummary['competitions'] = [];
  let totalInserted = 0;

  for (const groupRows of groups.values()) {
    const { year, seasonNo } = groupRows[0];
    const label = competitionLabel(year, seasonNo, NAME); // 예: '2023 시즌1 · -'

    // 대회 upsert — 같은 label 이면 기존 행 그대로(멱등).
    const competition = await prisma.competition.upsert({
      where: { label },
      update: {},
      create: { year, seasonNo, name: NAME, label },
    });
    const competitionId = competition.id;

    const data = groupRows.map((r) => ({
      competitionId,
      week: r.week,
      game: r.game,
      quarter: r.quarter,
      player: r.player,
      stat: r.stat,
      team: TEAM,
    }));

    // 이 대회의 기존 이벤트를 지우고 새로 넣는다(한 트랜잭션 = 멱등 장치. StatEvent 엔 유니크가 없어
    // per-event upsert 가 안 되므로 delete-then-create 로 통째 교체).
    await prisma.$transaction([
      prisma.statEvent.deleteMany({ where: { competitionId } }),
      prisma.statEvent.createMany({ data }),
    ]);

    competitions.push({
      year,
      seasonNo,
      name: NAME,
      label,
      competitionId,
      inserted: data.length,
    });
    totalInserted += data.length;
  }

  return { competitions, totalInserted, unknownCodes: result.unknownCodes };
}

// 인자 파싱: 경로 = '--'로 시작하지 않는 첫 인자. dry-run = 플래그 또는 환경변수.
function parseArgs(argv: string[]): { filePath: string | null; dryRun: boolean } {
  const args = argv.slice(2);
  const filePath = args.find((a) => !a.startsWith('--')) ?? null;
  const dryRun = args.includes('--dry-run') || process.env.DRY_RUN === '1';
  return { filePath, dryRun };
}

function printUsage(): void {
  console.error('사용법: npm run import:legacy -- <xlsx경로> [--dry-run]');
  console.error('  예:   npm run import:legacy -- ./data/2023.xlsx');
  console.error('  드라이런(DB 안 건드림): npm run import:legacy -- ./data/2023.xlsx --dry-run');
}

// 파싱 요약(공통): 시트명 + 대회별 라벨/행수/distinct 주차/(week,game) + 미등록 코드 + 경고 수.
function printParseSummary(filePath: string, result: ParseResult): void {
  console.log(`\n파일: ${filePath}`);
  console.log(`시트: ${result.sheet}`);
  console.log(`파싱된 이벤트: ${result.rows.length}건`);
  console.log('대회별 요약:');
  for (const c of summarizeRows(result.rows)) {
    const label = competitionLabel(c.year, c.seasonNo, NAME);
    console.log(
      `  - ${label}: ${c.rowCount}건 · 주차 ${c.distinctWeeks}종 · 경기(주차,경기 쌍) ${c.distinctGames}개`,
    );
  }
  if (result.unknownCodes.length) {
    console.log(`미등록 스텟 코드: ${result.unknownCodes.join(', ')}`);
  }
  if (result.warnings.length) {
    console.log(`경고 ${result.warnings.length}건 (처음 10건):`);
    for (const w of result.warnings.slice(0, 10)) {
      console.log(`  · [${w.row}행] ${w.message}`);
    }
  }
}

function printLoadSummary(summary: LoadSummary): void {
  console.log('\n적재 완료:');
  for (const c of summary.competitions) {
    console.log(`  - ${c.label} (competitionId=${c.competitionId}): ${c.inserted}건`);
  }
  console.log(`총 ${summary.totalInserted}건 적재.`);
  if (summary.unknownCodes.length) {
    console.log(`※ 미등록 코드 ${summary.unknownCodes.length}종: ${summary.unknownCodes.join(', ')}`);
  }
}

async function main(): Promise<void> {
  const { filePath, dryRun } = parseArgs(process.argv);
  if (!filePath) {
    printUsage();
    process.exit(1);
  }
  if (!fs.existsSync(filePath)) {
    console.error(`파일을 찾을 수 없습니다: ${filePath}`);
    process.exit(1);
  }

  const buffer = fs.readFileSync(filePath);
  const result = parseLegacyWorkbook(buffer);
  printParseSummary(filePath, result);

  if (dryRun) {
    console.log('\n[dry-run] DB 는 건드리지 않았습니다. 위 요약을 확인한 뒤 --dry-run 없이 다시 실행하세요.');
    return; // PrismaClient 아예 생성 안 함.
  }

  const prisma = new PrismaClient(); // 실제 적재 때만 DB 연결.
  try {
    const summary = await loadIntoDb(prisma, result);
    printLoadSummary(summary);
  } finally {
    await prisma.$disconnect();
  }
}

// 다른 파일에서 import 될 땐 실행하지 않는다(테스트/재사용 대비). 직접 실행할 때만 main.
if (require.main === module) {
  main().catch((err) => {
    console.error('import 실패:', err);
    process.exit(1);
  });
}
