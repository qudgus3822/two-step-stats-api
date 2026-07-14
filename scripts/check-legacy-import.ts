/**
 * 과거 xlsx 파서 검증 스크립트 (DB·실제 파일·client 재생성 전부 불필요).
 *
 * check-pipeline.ts 와 같은 스타일: 수동 assert + process.exit (jest 아님).
 * 오직 legacyXlsxReader(Prisma·Nest 0 의존)만 import 하므로, 생성된 Prisma client 가
 * 낡아도(=아직 옛 Season) 이 환경에서 그대로 돈다.
 *
 * 메모리에서 엑셀 한 장을 만들어(aoa_to_sheet) 파서에 먹이고, 실제 파싱 결과를 값까지 대조한다.
 * 특히 (1) INDEX 보조컬럼 무시, (2) 병합셀 forward-fill, (3) 시즌 경계에서 주차/경기 이월 리셋,
 * (4) (week,game) 쌍 기준 distinct 경기 수 — 이 네 가지가 실제로 동작하는지 못 박는다.
 */
import * as XLSX from 'xlsx';
import { parseLegacyWorkbook, summarizeRows } from './legacyXlsxReader';

// 검증용 메모리 엑셀. 실제 원본 레이아웃(연도/시즌/주차/경기/쿼터/선수/스텟 + INDEX 3종)을 흉내낸다.
// 2번째 대회(2023 시즌2) 첫 행(D)의 주차/경기를 '빈칸'으로 둔 게 핵심 —
// 시즌 경계 리셋이 없으면 앞 대회의 주차(2)/경기(1)가 D 로 이월돼 버린다.
const AOA: unknown[][] = [
  ['2023 과거기록'], // 행0: 제목(헤더 아님 → 스캔이 건너뜀)
  ['연도', '시즌', '주차', '경기', '쿼터', '선수', '스텟', 'INDEX', 'INDEX', '시즌index'], // 행1: 헤더
  [2023, 1, 1, 1, 1, '김진우1', '3A', 'x', 'x', 'x'], // 행2 A: (2023,시즌1) w1 g1 q1
  ['', '', '', '', '', '김진우1', 'dr', 'x', 'x', 'x'], // 행3 B: 전부 병합빈칸 → forward-fill, 'dr'→'DR'
  ['', '', 2, 1, 1, '이준', '2', 'x', 'x', 'x'], // 행4 C: 주차=2 → lastWeek=2 (여전히 시즌1) w2 g1
  [2023, 2, '', '', '', '박현', 'S', 'x', 'x', 'x'], // 행5 D: 시즌 경계!(2023,시즌2) 주/경/쿼 빈칸
  ['', '', '', '', '', '', '', '', '', ''], // 행6 E: 선수·스텟 없음 → skip
  [2023, 1, 1, 1, 1, '최고', 'ZZ', 'x', 'x', 'x'], // 행7 F: 미등록 코드 ZZ (다시 시즌1)
];

function buildWorkbookBuffer(): Buffer {
  const ws = XLSX.utils.aoa_to_sheet(AOA);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Rawdata');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

function main(): void {
  const res = parseLegacyWorkbook(buildWorkbookBuffer());

  let failures = 0;
  const fail = (msg: string) => {
    failures++;
    console.error(`  ✗ ${msg}`);
  };
  const eq = (label: string, got: unknown, want: unknown) => {
    if (got !== want) fail(`${label}: 기대 ${JSON.stringify(want)}, 실제 ${JSON.stringify(got)}`);
  };

  // 1) 데이터 행 수: A,B,C,D,F = 5 (E 빈 행 제외)
  eq('행 수', res.rows.length, 5);

  // 2) INDEX 무시: 파싱된 행에 index 관련 필드가 없어야 함
  const keys0 = res.rows[0] ? Object.keys(res.rows[0]).sort().join(',') : '';
  eq('행 키(INDEX 미포함)', keys0, 'game,player,quarter,seasonNo,stat,week,year');

  // 3) forward-fill: B 행이 A 의 연도/시즌/주차/경기/쿼터를 그대로 물려받음 + 'dr'→'DR'
  const b = res.rows[1];
  eq('B forward-fill 전체', JSON.stringify(b), JSON.stringify({
    year: 2023, seasonNo: 1, week: 1, game: 1, quarter: 1, player: '김진우1', stat: 'DR',
  }));

  // 4) player 접미사 유지 (절삭 금지)
  eq('player 원본 유지', res.rows[0]?.player, '김진우1');

  // 5) stat 정규화 ('dr' → 'DR')
  eq('stat 정규화', res.rows[1]?.stat, 'DR');

  // 6) 시즌 경계 리셋(REAL): D(박현)의 주차/경기가 앞 대회(2/1)로 이월되지 않고 0 + 경고여야 함.
  //    → 리셋 로직을 지우면 week 가 2 로 새고 경고가 안 떠서 이 assert 가 실패한다.
  const d = res.rows[3];
  eq('D 박현', d?.player, '박현');
  eq('D week 리셋(2 이월 아님)', d?.week, 0);
  eq('D game 리셋(1 이월 아님)', d?.game, 0);
  const dRowWarnings = res.warnings.filter((w) => w.row === 6); // 박현 = 엑셀 6행
  if (!dRowWarnings.some((w) => w.message.includes('주차 미해결'))) fail('D 주차 미해결 경고 없음');
  if (!dRowWarnings.some((w) => w.message.includes('경기 미해결'))) fail('D 경기 미해결 경고 없음');

  // 7) 미등록 코드: ZZ 만 잡히고 경고에도 존재
  eq('unknownCodes', res.unknownCodes.join(','), 'ZZ');
  if (!res.warnings.some((w) => w.code === 'ZZ')) fail('ZZ 미등록 경고 없음');

  // 8) distinct (week,game) 쌍: (2023,시즌1)은 (1,1)·(2,1) = 2. Set(game) 로 세면 1 이 되는 함정을 잡는다.
  const summary = summarizeRows(res.rows);
  const s1 = summary.find((c) => c.year === 2023 && c.seasonNo === 1);
  if (!s1) fail('요약에서 (2023,시즌1) 대회를 못 찾음');
  else {
    eq('(2023,시즌1) distinct (week,game)', s1.distinctGames, 2);
    eq('(2023,시즌1) rowCount', s1.rowCount, 4); // A,B,C,F
    eq('(2023,시즌1) distinct 주차', s1.distinctWeeks, 2); // 1, 2
  }

  if (failures === 0) {
    console.log('✓ 검증 통과 — 파싱 5행, INDEX 무시, forward-fill, 시즌 경계 리셋, (week,game) 쌍 집계 전부 일치');
    process.exit(0);
  } else {
    console.error(`\n검증 실패: ${failures}건 불일치`);
    process.exit(1);
  }
}

main();
