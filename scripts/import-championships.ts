/**
 * 기록 엑셀의 '우승' 시트 → championship_wins 테이블에 넣는 시드 스크립트.
 *
 * 실행:
 *   npm run import:championships                       # 기본 파일(scripts/fixtures/rawdata.xlsx) 적재
 *   npm run import:championships -- --dry-run          # DB 안 건드리고 요약만
 *   npm run import:championships -- ./어떤파일.xlsx     # 다른 파일로
 *   ( npm 은 `--` 뒤 인자를 스크립트로 넘긴다. `--` 빼먹으면 인자가 전달되지 않는다. )
 *
 * 전제: `npx prisma migrate dev` 로 championship_wins 표가 이미 만들어져 있어야 한다.
 *
 * ── 이 스크립트의 어려운 지점 하나 ────────────────────────────────────────
 * 시트는 우승을 (연도, 시즌N) 으로 적어 놓았는데, DB 는 competitionId(대회 행) 로 가리킨다.
 * 그래서 둘을 이어 붙여야 하는데, 이게 항상 되는 게 아니다:
 *   - 그 대회가 아직 DB 에 없을 수 있다 (rawdata 를 아직 안 올렸다)
 *   - 같은 (연도, 시즌) 대회가 둘 이상일 수 있다 (대회명이 달라서)
 * 둘 중 어느 쪽이든 **조용히 넘어가지 않고 표로 보고하고 건너뛴다**. 아무거나 골라 붙이면
 * 엉뚱한 대회에 우승이 박히고, 나중에 눈으로는 절대 못 찾는다.
 * --dry-run 으로 먼저 이 연결 표부터 확인하는 걸 권한다.
 *
 * ⚠ teamName 은 시트의 우승팀 이름을 그대로 쓴다(경기 기록에서 다시 계산하지 않는다).
 *   화면의 [+] 버튼은 계산해서 넣지만, 여기선 사람이 이미 확정해 적어 둔 값이 원본이다.
 */
import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import {
  ChampionshipSheetResult,
  ChampionshipSheetRow,
  parseChampionshipSheet,
  readSheetWinCounts,
} from './championshipSheetReader';

// 우승 시트엔 있는데 그 대회 경기 기록엔 없는 (대회, 선수) 한 건.
interface GhostWinner {
  label: string; // 대회 라벨
  player: string; // 시트에 적힌 이름
  similar: string[]; // 그 대회에 실제로 뛴 비슷한 이름(숫자 접미사만 다른 것)
}

// 인자를 안 주면 읽을 기본 파일. 이 저장소의 원본 기록지다.
const DEFAULT_FILE = path.join(__dirname, 'fixtures', 'rawdata.xlsx');

/**
 * [신설: 2026-09-02 김병현 작성] 엑셀 '우승' 시트의 알려진 이름 오류 정정표.
 *
 * 왜 필요한가: '우승' 시트는 동명이인 접미사(1/2)가 rawdata 시트와 어긋나 있다.
 * 그대로 넣으면 "그 대회에 뛴 기록이 없는 우승자"가 생기고, 그 선수의 승률 분모(뛴 시즌)가
 * 0이 돼 승률을 못 낸다. DB 를 손으로 고쳐도 이 시드를 다시 돌리면 **틀린 이름이 되살아난다**
 * (upsert 는 새 이름을 추가할 뿐 옛 줄을 지우지 않아서, 한 대회에 우승자가 둘이 된다).
 * 그래서 정정을 여기 못박아 둔다 — 몇 번을 돌려도 같은 답이 나오게.
 *
 * 확인 출처: 사용자 확인 (2026-09-02)
 *   - 김진우2 는 김진우 와 같은 사람이다 (김진우2 는 경기 기록이 0건인 유령 이름).
 *   - 2023 시즌1 우승자로 적힌 '김진우' 는 실제로는 김진우1 이다 (그 시즌엔 김진우1 만 뛰었다).
 *
 * ⚠ 진짜 해결은 엑셀 원본을 고치는 것이다. 이 표는 그때까지의 다리다.
 *   원본을 고치면 여기 줄을 지워도 결과가 같아진다(정정할 게 없어져서 그냥 안 걸린다).
 *
 * (대회, 시트에 적힌 이름) → 실제 이름
 */
const NAME_FIXES: { year: number; seasonNo: number; from: string; to: string }[] = [
  { year: 2023, seasonNo: 1, from: '김진우', to: '김진우1' },
  { year: 2024, seasonNo: 1, from: '김진우2', to: '김진우' },
];

// 정정표를 한 우승 기록에 적용한다. 걸리는 게 없으면 원본을 그대로 돌려준다.
// 바뀐 게 있으면 무엇을 바꿨는지 같이 돌려준다 — 조용히 바꾸면 안 되기 때문이다.
function applyNameFixes(row: ChampionshipSheetRow): {
  row: ChampionshipSheetRow;
  applied: { from: string; to: string }[];
} {
  const fixes = NAME_FIXES.filter((f) => f.year === row.year && f.seasonNo === row.seasonNo);
  if (fixes.length === 0) return { row, applied: [] };

  const applied: { from: string; to: string }[] = [];
  const players = row.players.map((p) => {
    const hit = fixes.find((f) => f.from === p);
    if (!hit) return p;
    applied.push({ from: hit.from, to: hit.to });
    return hit.to;
  });
  if (applied.length === 0) return { row, applied: [] };
  return { row: { ...row, players }, applied };
}

// 우승 1건이 DB 의 어느 대회에 붙었는지(또는 왜 못 붙었는지).
interface Resolution {
  row: ChampionshipSheetRow;
  competitionId: number | null;
  label: string | null;
  // 못 붙은 이유. 붙었으면 null.
  problem: '대회 없음' | '대회 후보 2개 이상' | null;
}

// (연도, 시즌) → 대회 를 이어 붙인다. 후보가 정확히 1개일 때만 연결한다.
async function resolveCompetitions(
  prisma: PrismaClient,
  rows: ChampionshipSheetRow[],
): Promise<Resolution[]> {
  // 대회 등록부는 통째로 한 번만 읽는다. 우승 줄마다 DB 를 치면 왕복이 11번 난다
  // (DB 가 원격 Supabase 라 왕복 한 번이 비싸다). 대회는 많아야 수십 개다.
  const competitions = await prisma.competition.findMany();

  return rows.map((row) => {
    const matches = competitions.filter(
      (c) => c.year === row.year && c.seasonNo === row.seasonNo,
    );
    if (matches.length === 1) {
      return { row, competitionId: matches[0].id, label: matches[0].label, problem: null };
    }
    return {
      row,
      competitionId: null,
      label: matches.length > 1 ? matches.map((m) => m.label).join(' / ') : null,
      problem: matches.length === 0 ? '대회 없음' : '대회 후보 2개 이상',
    };
  });
}

/**
 * [신설: 2026-09-02 김병현 작성] "그 대회에 뛴 기록이 없는 우승자" 찾기.
 *
 * 왜 필요한가: 화면의 [+] 버튼은 서버가 이 검사를 한다(안 뛴 사람은 400 으로 막힌다).
 * 그런데 이 시드는 시트를 곧이곧대로 믿고 넣어서 그 관문을 건너뛴다. 그래서 같은 검사를
 * 여기서도 해 준다 — 안 그러면 두 경로가 서로 다른 규칙을 갖게 된다.
 *
 * ⚠ 찾아도 **건너뛰지는 않는다.** 시트는 사람이 남긴 역사 기록이라, 이름이 좀 틀렸다고
 *   우승 사실 자체를 버리면 정보가 사라진다. 대신 시끄럽게 알려서 사람이 고치게 한다.
 *   (실제로 이 저장소 데이터엔 '김진우 / 김진우1 / 김진우2' 접미사가 우승 시트에만 안 붙어
 *    생긴 건이 2개 있다.)
 */
async function findGhostWinners(
  prisma: PrismaClient,
  resolutions: Resolution[],
): Promise<GhostWinner[]> {
  // (선수, 대회) 쌍 = "그 사람이 그 대회에 나왔다"는 사실 한 줄. 한 번에 다 읽어 메모리에서 대조한다.
  const pairs = await prisma.statEvent.groupBy({ by: ['player', 'competitionId'] });
  const played = new Set(pairs.map((x) => `${x.competitionId}|${x.player}`));

  // 이름에서 끝 숫자를 뗀 것이 같으면 '비슷한 이름'으로 본다(김진우2 ↔ 김진우1 ↔ 김진우).
  const baseOf = (name: string) => name.replace(/\d+$/, '');

  const ghosts: GhostWinner[] = [];
  for (const r of resolutions) {
    if (r.competitionId == null) continue;
    for (const player of r.row.players) {
      if (played.has(`${r.competitionId}|${player}`)) continue;
      ghosts.push({
        label: r.label ?? String(r.competitionId),
        player,
        similar: pairs
          .filter((x) => x.competitionId === r.competitionId && baseOf(x.player) === baseOf(player))
          .map((x) => x.player),
      });
    }
  }
  return ghosts;
}

function printGhostWinners(ghosts: GhostWinner[]): void {
  if (ghosts.length === 0) {
    console.log('\n이름 확인: 우승자 전원이 그 대회 경기 기록에 있어요. ✓');
    return;
  }
  console.log(`\n⚠ 그 대회 경기 기록이 없는 우승자 ${ghosts.length}명 (그래도 적재는 합니다):`);
  for (const g of ghosts) {
    const hint = g.similar.length
      ? `그 대회에 뛴 비슷한 이름: ${g.similar.join(', ')}`
      : '비슷한 이름도 없음';
    console.log(`  · ${g.label} | ${g.player} → ${hint}`);
  }
  console.log(
    '    → 엑셀 우승 시트의 이름에 동명이인 접미사(1/2)가 빠졌을 가능성이 큽니다.\n' +
      '      시트를 고쳐 다시 돌리거나, 우승횟수 관리 화면에서 직접 취소/등록하면 됩니다.',
  );
}

// 붙은 것들만 실제로 넣는다. 같은 (대회, 선수) 는 upsert 라 몇 번 돌려도 결과가 같다(멱등).
async function loadIntoDb(
  prisma: PrismaClient,
  resolutions: Resolution[],
): Promise<{ inserted: number; competitions: number }> {
  let inserted = 0;
  let competitions = 0;

  for (const r of resolutions) {
    if (r.competitionId == null) continue;
    competitions++;
    for (const player of r.row.players) {
      await prisma.championshipWin.upsert({
        where: {
          competitionId_player: { competitionId: r.competitionId, player },
        },
        // 이미 있으면 팀 이름을 덮어쓰지 않는다 — 화면에서 사람이 고쳐 둔 값을
        // 시드를 다시 돌렸다고 시트 값으로 되돌리면 안 된다.
        update: {},
        create: { competitionId: r.competitionId, player, teamName: r.row.teamName },
      });
      inserted++;
    }
  }
  return { inserted, competitions };
}

// ── 화면에 찍는 것들 ───────────────────────────────────────────────────────

function printParseSummary(filePath: string, result: ChampionshipSheetResult): void {
  console.log(`\n파일: ${filePath}`);
  console.log(`시트: ${result.sheet}`);
  console.log(`읽은 우승 기록: ${result.rows.length}건`);
  for (const r of result.rows) {
    console.log(
      `  - ${r.year} 시즌${r.seasonNo} · ${r.teamName} — ${r.players.length}명: ${r.players.join(', ')}`,
    );
  }
  if (result.skipped.length) {
    console.log(`\n건너뛴 줄 ${result.skipped.length}개:`);
    for (const s of result.skipped) {
      console.log(`  · [${s.excelRow}행] ${s.reason}`);
    }
  }
}

function printResolution(resolutions: Resolution[]): void {
  const ok = resolutions.filter((r) => r.competitionId != null);
  const bad = resolutions.filter((r) => r.competitionId == null);

  console.log(`\nDB 대회와 연결: 성공 ${ok.length}건 / 실패 ${bad.length}건`);
  for (const r of ok) {
    console.log(
      `  ✓ ${r.row.year} 시즌${r.row.seasonNo} → [${r.competitionId}] ${r.label} (${r.row.players.length}명)`,
    );
  }
  for (const r of bad) {
    const detail = r.label ? ` — 후보: ${r.label}` : '';
    console.log(`  ✗ ${r.row.year} 시즌${r.row.seasonNo}: ${r.problem}${detail}`);
  }
  if (bad.length) {
    console.log(
      "    → '대회 없음' 이면 그 시즌 rawdata 를 먼저 업로드(또는 import:legacy)한 뒤 다시 실행하세요.",
    );
  }
}

/**
 * 내가 읽은 값 vs '선수명' 시트에 사람이 세둔 우승횟수 대조.
 *
 * 이 대조는 **틀린 걸 고치려는 게 아니라 눈으로 확인하려는 것**이다. 우리가 믿는 원본은
 * '우승' 시트고, '선수명' 시트의 숫자는 그걸 손으로 센 값이다. 실제로 지금 파일에는
 * 김진우2 한 명이 어긋나 있다('우승' 시트엔 2024 시즌1 멤버인데 '선수명' 시트는 0).
 * 그래서 "불일치 0건"을 목표로 삼지 않는다 — 불일치가 '아는 그 한 건'인지만 보면 된다.
 */
function printCrossCheck(rows: ChampionshipSheetRow[], sheetCounts: Map<string, number> | null): void {
  const derived = new Map<string, number>();
  for (const r of rows) {
    for (const p of r.players) derived.set(p, (derived.get(p) ?? 0) + 1);
  }

  console.log(`\n파생 우승횟수: 선수 ${derived.size}명`);
  if (!sheetCounts) {
    console.log("  ('선수명' 시트나 우승횟수 칸이 없어 대조를 건너뜁니다)");
    return;
  }

  const names = new Set([...derived.keys(), ...sheetCounts.keys()]);
  const diffs = [...names]
    .map((n) => ({ name: n, mine: derived.get(n) ?? 0, sheet: sheetCounts.get(n) ?? 0 }))
    .filter((d) => d.mine !== d.sheet)
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'));

  console.log(`'선수명' 시트의 우승횟수 칸과 대조: 불일치 ${diffs.length}건`);
  for (const d of diffs) {
    console.log(`  · ${d.name}: 내가 읽은 값 ${d.mine} / 시트 값 ${d.sheet}`);
  }
}

// 인자 파싱: 경로 = '--'로 시작하지 않는 첫 인자(없으면 기본 파일). dry-run = 플래그 또는 환경변수.
function parseArgs(argv: string[]): { filePath: string; dryRun: boolean } {
  const args = argv.slice(2);
  const filePath = args.find((a) => !a.startsWith('--')) ?? DEFAULT_FILE;
  const dryRun = args.includes('--dry-run') || process.env.DRY_RUN === '1';
  return { filePath, dryRun };
}

async function main(): Promise<void> {
  const { filePath, dryRun } = parseArgs(process.argv);
  if (!fs.existsSync(filePath)) {
    console.error(`파일을 찾을 수 없습니다: ${filePath}`);
    console.error('사용법: npm run import:championships -- [xlsx경로] [--dry-run]');
    process.exit(1);
  }

  const buffer = fs.readFileSync(filePath);
  const result = parseChampionshipSheet(buffer);
  printParseSummary(filePath, result);
  printCrossCheck(result.rows, readSheetWinCounts(buffer));

  // 연결 표는 DB 를 읽어야 만들 수 있다 — dry-run 에서도 이건 봐야 의미가 있어서 연결한다
  // (읽기만 하고 쓰기는 안 한다).
  const prisma = new PrismaClient();
  try {
    // 정정표를 먼저 적용한다. 대회 연결·이름 확인·적재가 전부 '고쳐진 이름'을 보게 하려고
    // 여기 한 곳에서 한 번만 바꾼다(각 단계가 따로 고치면 반드시 한 곳이 빠진다).
    const fixed = result.rows.map(applyNameFixes);
    const appliedFixes = fixed.flatMap((f) =>
      f.applied.map((a) => `${f.row.year} 시즌${f.row.seasonNo}: ${a.from} → ${a.to}`),
    );
    if (appliedFixes.length > 0) {
      console.log(`\n알려진 이름 오류 ${appliedFixes.length}건 자동 정정 (NAME_FIXES):`);
      for (const line of appliedFixes) console.log(`  · ${line}`);
    }

    const resolutions = await resolveCompetitions(prisma, fixed.map((f) => f.row));
    printResolution(resolutions);
    // 이름 확인도 읽기 전용이라 dry-run 에서도 돌린다 — 적재 전에 미리 보는 게 이 검사의 요점이다.
    printGhostWinners(await findGhostWinners(prisma, resolutions));

    if (dryRun) {
      console.log('\n[dry-run] DB 에 쓰지 않았습니다. 위 연결 표를 확인한 뒤 --dry-run 없이 다시 실행하세요.');
      return;
    }

    const { inserted, competitions } = await loadIntoDb(prisma, resolutions);
    console.log(`\n적재 완료: 대회 ${competitions}개 · 우승 줄 ${inserted}개 (같은 줄 재실행은 그대로 유지).`);
    console.log('※ 우승 기록은 스탯 캐시와 무관해서 서버 재시작이나 캐시 비우기가 필요 없어요.');
  } finally {
    await prisma.$disconnect();
  }
}

// 다른 파일에서 import 될 땐 실행하지 않는다(재사용 대비). 직접 실행할 때만 main.
if (require.main === module) {
  main().catch((err) => {
    console.error('import 실패:', err);
    process.exit(1);
  });
}
