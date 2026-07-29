/**
 * [신설: 2026-07-29 21:55, 김병현 작성] "이미 저장된 이름 중 공백 든 것을 새 규칙에 맞춘다" — 옛 데이터 일회성 정리.
 *
 * 왜 필요한가: 새 업로드만 정규화하면 '김 병현'(옛 행)과 '김병현'(새 행)이 영원히 두 사람으로 남는다.
 * 정규화의 효과가 절반만 난다.
 *
 * 실행: `npm run fix:playerspaces`(미리보기) / `npm run fix:playerspaces -- --apply`(실행).
 *
 * 안전성 메모:
 * - 몇 번 돌려도 안전하다(멱등). 이미 정규화된 이름은 2단계 필터에서 걸러진다.
 * - 트랜잭션으로 안 묶는다 — 중간에 죽어도 "일부만 정리된 상태"이고, 다시 돌리면 마저 된다.
 * - `StatEvent` 에 `player` 유니크 제약이 없어서(`schema.prisma:48` 은 `@@index([player])` 뿐),
 *   합치기가 에러 없이 그냥 된다. 에러가 안 난다는 게 곧 안전하다는 뜻은 아니다 — 그래서 아래 경고가 있다.
 * - `schema.prisma` / 마이그레이션은 안 건드린다. 값만 고친다.
 *
 * ⚠ 이 스크립트가 하는 일은 위험도가 완전히 다른 두 가지다.
 *   - 이름 바꾸기: 새 이름이 아직 DB 에 없다 → 사실상 되돌릴 수 있다(값만 되돌리면 됨).
 *   - ⚠ 합치기: 새 이름이 이미 DB 에 있거나, 서로 다른 옛 이름 둘 이상이 같은 새 이름으로 모인다
 *     → 두 사람이 한 사람이 된다. 어느 행이 어느 쪽이었는지 사라져 영영 되돌릴 수 없다.
 *   깊은 모듈은 복잡함을 숨기는 것이지, 되돌릴 수 없는 결정에 필요한 사실을 숨기는 게 아니다.
 *   → 미리보기가 '이름 정리'와 '⚠ 합침'을 반드시 구분해서 찍는다.
 */
import { PrismaClient } from '@prisma/client';
import { normalizePlayerName } from '../src/stats/playerCheck'; // 규칙은 절대 다시 쓰지 않는다

const apply = process.argv.includes('--apply'); // 없으면 미리보기(dry-run)
const prisma = new PrismaClient();

async function main(): Promise<void> {
  // 1) 이름과 행 수를 한 번에 읽는다
  const groups = await prisma.statEvent.groupBy({ by: ['player'], _count: true });
  // 이름 → 행수 표. "새 이름이 이미 DB 에 있나"를 여기서 공짜로 알 수 있다.
  const rowsByName = new Map(groups.map((g) => [g.player, g._count]));

  // 2) 바꿀 대상을 고른다 — ⚠ 빈 이름은 여기서 바로 떼어낸다.
  const all = groups.map((g) => ({ from: g.player, to: normalizePlayerName(g.player), rows: g._count }));

  // ⚠ 빈 이름이 되는 건 '대상'이 아니다. 반드시 여기서 먼저 떼어낸다.
  //   뒤로 미루면 세 가지가 한꺼번에 깨진다:
  //     ① arrivals[''] 가 오염돼 있지도 않은 '빈 이름으로 합치기'가 뜨고 합치기 건수가 부푼다
  //     ② 같은 행이 '⚠ 합침' 과 '⚠ 건너뜀' 으로 두 번, 서로 모순되게 찍힌다
  //     ③ 7단계 updateMany 가 player='' 를 DB 에 실제로 써 버린다 (AC 20 위반)
  const skipped = all.filter((t) => t.to !== t.from && t.to === ''); // '   ' 같은 쓰레기 행
  const targets = all.filter((t) => t.to !== t.from && t.to !== ''); // 진짜 대상

  // 3) '합치기'인지 판정한다.
  // ⚠ 함정: '새 이름이 DB 에 이미 있나'만 보면 부족하다.
  //   서로 다른 옛 이름 둘이 같은 새 이름으로 모이면('김 병현', '김병 현' → 둘 다 '김병현'),
  //   그 새 이름이 DB 에 없어도 결과는 똑같이 '합치기'다. 도착지별로 세어서 그것도 잡는다.
  const arrivals = new Map<string, number>(); // 새 이름 → 여기로 오는 옛 이름 개수
  for (const t of targets) arrivals.set(t.to, (arrivals.get(t.to) ?? 0) + 1);

  const isMerge = (t: { to: string }) => rowsByName.has(t.to) || (arrivals.get(t.to) ?? 0) > 1;

  // 4) 미리보기 출력 — 두 종류를 반드시 구분해서 찍는다. 합치기는 '도착지' 기준으로 묶어 한 줄에 출력한다.
  const renames = targets.filter((t) => !isMerge(t));
  const merges = targets.filter(isMerge);

  for (const t of renames) {
    console.log(`  이름 정리: '${t.from}'(${t.rows}행) → '${t.to}'`);
  }

  const mergeGroups = new Map<string, { from: string; rows: number }[]>();
  for (const t of merges) {
    const list = mergeGroups.get(t.to) ?? [];
    list.push({ from: t.from, rows: t.rows });
    mergeGroups.set(t.to, list);
  }
  for (const [to, parts] of mergeGroups) {
    const existingRows = rowsByName.get(to);
    const pieces = [
      ...(existingRows != null ? [`기존 '${to}'(${existingRows}행)`] : []),
      ...parts.map((p) => `'${p.from}'(${p.rows}행)`),
    ];
    const totalRows = (existingRows ?? 0) + parts.reduce((sum, p) => sum + p.rows, 0);
    console.log(`⚠ 합침:    ${pieces.join(' + ')} → '${to}'(${totalRows}행)          ← 되돌릴 수 없음`);
  }

  // 5) 건너뛴 것 알리기 — 2단계에서 이미 떼어낸 skipped 를 찍기만 한다.
  //    지우는 건 이 스크립트 일이 아니다. 빈 이름을 DB 에 절대 쓰지 않는다 — 애초에 targets 에 없다.
  for (const t of skipped) {
    console.log(`⚠ 건너뜀(빈 이름이 됨): ${JSON.stringify(t.from)}(${t.rows}행)`);
  }

  console.log(
    `\n이름 ${targets.length}개 변경 (그중 ⚠ 합치기 ${merges.length}건) / 총 ${targets.reduce((s, t) => s + t.rows, 0)}행`,
  );
  if (merges.length > 0) {
    console.log('⚠ 합치기는 되돌릴 수 없습니다. 위 건이 정말 같은 사람인지 확인하세요.');
  }

  // 6) --apply 가 없으면 여기서 끝
  if (!apply) {
    console.log('미리보기입니다. 실제로 바꾸려면: npm run fix:playerspaces -- --apply');
    await prisma.$disconnect();
    return;
  }

  // 7) --apply 가 있으면 대상마다 바꾼다.
  // targets 에는 빈 이름이 없다(2단계에서 제외) → player='' 가 저장될 길이 없다.
  for (const t of targets) {
    await prisma.statEvent.updateMany({ where: { player: t.from }, data: { player: t.to } });
  }

  // 8) 끝나면 반드시 안내 출력
  console.log(
    `✅ 이름 ${targets.length}개 / ${targets.reduce((s, t) => s + t.rows, 0)}행 정리 완료 (그중 ⚠ 합치기 ${merges.length}건).`,
  );
  console.log('⚠ 이 스크립트는 서버를 거치지 않고 DB를 바꿉니다. 서버의 이벤트 캐시가 낡은 상태예요.');
  console.log('   POST /api/cache/refresh 를 부르거나 서버를 재시작하세요.');

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
