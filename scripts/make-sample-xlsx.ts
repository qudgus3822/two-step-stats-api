/**
 * 실제 기록지 구조를 흉내 낸 샘플 .xlsx 생성기 (업로드/파서 테스트용).
 * - 왼쪽 6개 컬럼(주차/경기/쿼터/선수/스텟/팀명) = 실제 데이터
 * - 오른쪽에 범례 표(코드/설명)를 넣어 파서가 무시하는지 확인
 * - 주차/경기/쿼터는 값이 바뀔 때만 기록(병합 셀 흉내) → forward-fill 검증
 * 실행: npx ts-node scripts/make-sample-xlsx.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import * as XLSX from 'xlsx';

const fixturePath = path.join(__dirname, 'fixtures', 'real-stats.json');
const fx = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'));

// 오른쪽 범례(파서가 무시해야 하는 영역)
const legend: [string, string][] = [
  ['코드', '설명'],
  ['1', '앤드원(자동 1점)'],
  ['2', '2점 성공'],
  ['3', '3점 성공'],
  ['1F', '자유투 1점 성공'],
  ['2F', '자유투 2점 성공'],
  ['S', '스틸'],
  ['B', '블락'],
];

const rows: unknown[][] = [];
// 제목 행 (헤더가 0행이 아닌 경우도 파서가 찾는지 확인)
rows.push(['2026 시즌2 나이배 기록지']);
// 헤더 행: 왼쪽 데이터 표 + (빈 칸) + 오른쪽 범례 헤더
rows.push(['주차', '경기', '쿼터', '선수', '스텟', '팀명', '', legend[0][0], legend[0][1]]);

let prevWeek: number | null = null;
let prevGame: number | null = null;
let prevQuarter: number | null = null;

fx.events.forEach(
  (
    e: { week: number; game: number; quarter: number; player: string; stat: string; team: string },
    i: number,
  ) => {
    // 병합 셀 흉내: 값이 이전과 같으면 빈 칸으로 둔다
    const week = e.week === prevWeek ? '' : e.week;
    const game = e.game === prevGame ? '' : e.game;
    const quarter = e.quarter === prevQuarter ? '' : e.quarter;
    prevWeek = e.week;
    prevGame = e.game;
    prevQuarter = e.quarter;

    const row: unknown[] = [week, game, quarter, e.player, e.stat, e.team];
    // 오른쪽 범례를 앞쪽 몇 행에 나란히 배치
    const lg = legend[i + 1];
    if (lg) {
      row[6] = '';
      row[7] = lg[0];
      row[8] = lg[1];
    }
    rows.push(row);
  },
);

const ws = XLSX.utils.aoa_to_sheet(rows);
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, 'Rawdata');

const outPath = path.join(__dirname, 'fixtures', 'sample-기록지.xlsx');
XLSX.writeFile(wb, outPath);
console.log(`샘플 엑셀 생성: ${outPath} (이벤트 ${fx.events.length}건)`);
