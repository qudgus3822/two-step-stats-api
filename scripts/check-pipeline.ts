/**
 * 집계 엔진 검증 스크립트 (DB 불필요).
 * 실제 기록지에서 뽑은 이벤트(scripts/fixtures/real-stats.json)를 입력으로,
 * aggregate.ts 가 계산한 박스스코어가 기존 ETL 결과와 정확히 일치하는지 확인한다.
 */
import * as fs from 'fs';
import * as path from 'path';
import { boxScoreForGame, gameId, listGames } from '../src/stats/aggregate';
import { StatEvent } from '../src/stats/types';

interface Fixture {
  source: string;
  events: Omit<StatEvent, 'season'>[];
  expectedPlayerGameStats: Record<string, number | null>[];
  expectedGame: {
    week: number;
    game: number;
    teams: Record<string, number>;
    winner: string;
  };
}

// 기대 컬럼명 → 내부 필드명 매핑
const FIELD: Record<string, string> = {
  PTS: 'pts',
  '2PM': 'fg2m',
  '2PA': 'fg2a',
  '3PM': 'fg3m',
  '3PA': 'fg3a',
  FGM: 'fgm',
  FGA: 'fga',
  FTM: 'ftm',
  FTA: 'fta',
  AND1: 'andOne',
  OREB: 'oreb',
  DREB: 'dreb',
  REB: 'reb',
  AST: 'ast',
  STL: 'stl',
  BLK: 'blk',
  TOV: 'tov',
  '2P%': 'fg2Pct',
  '3P%': 'fg3Pct',
  'FG%': 'fgPct',
  'FT%': 'ftPct',
};

function main(): void {
  const fixturePath = path.join(__dirname, 'fixtures', 'real-stats.json');
  const fx: Fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'));
  const season = fx.source.replace(/\.[^.]+$/, '');
  const events: StatEvent[] = fx.events.map((e) => ({ ...e, season }));

  let failures = 0;
  const fail = (msg: string) => {
    failures++;
    console.error(`  ✗ ${msg}`);
  };

  // 1) 경기 요약(팀 점수/승자) 검증
  const games = listGames(events);
  if (games.length !== 1) fail(`경기 수 기대 1, 실제 ${games.length}`);
  const g = games[0];
  for (const [team, score] of Object.entries(fx.expectedGame.teams)) {
    const got = g.teams.find((t) => t.team === team)?.score;
    if (got !== score) fail(`팀 점수 ${team}: 기대 ${score}, 실제 ${got}`);
  }
  if (g.winner !== fx.expectedGame.winner) {
    fail(`승자: 기대 ${fx.expectedGame.winner}, 실제 ${g.winner}`);
  }

  // 2) 선수별 박스스코어 검증
  const id = gameId(season, fx.expectedGame.week, fx.expectedGame.game);
  const box = boxScoreForGame(events, id);
  if (!box) {
    fail(`경기 박스스코어를 찾지 못함 (id=${id})`);
  } else {
    const lines = new Map(
      box.teams.flatMap((t) => t.players.map((p) => [p.player, p])),
    );
    for (const expected of fx.expectedPlayerGameStats) {
      const player = expected.player as unknown as string;
      const line = lines.get(player) as unknown as Record<string, unknown>;
      if (!line) {
        fail(`선수 라인 없음: ${player}`);
        continue;
      }
      for (const [col, field] of Object.entries(FIELD)) {
        const want = expected[col];
        const got = line[field];
        if (want !== got) {
          fail(`${player} ${col}: 기대 ${want}, 실제 ${got}`);
        }
      }
    }
  }

  const totalPlayers = fx.expectedPlayerGameStats.length;
  if (failures === 0) {
    console.log(
      `✓ 검증 통과 — 선수 ${totalPlayers}명 박스스코어 + 팀 점수(OB ${fx.expectedGame.teams.OB} : ${fx.expectedGame.teams.YB} YB) 전부 일치`,
    );
    process.exit(0);
  } else {
    console.error(`\n검증 실패: ${failures}건 불일치`);
    process.exit(1);
  }
}

main();
