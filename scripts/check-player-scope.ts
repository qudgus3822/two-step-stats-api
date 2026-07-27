/**
 * [신설: 2026-07-27 15:00, 김병현 작성] 선수 상세(GET /players/:name) 대회 스코프 배선 검증.
 *
 * DB 없이 서비스+컨트롤러 배선만 확인한다(check-pipeline.ts 와 같은 톤 — ts-node 실행,
 * fail() 카운터, 실패 시 exitCode 1).
 *
 * 핵심 기법: 가짜 저장소(RecordingStore)가 받은 필터를 "기록"하고, 그 필터를 실제로
 * "적용"해서 이벤트를 돌려준다. 결과값만 보지 않고 "무엇으로 조회했는지"까지 확인한다
 * (인자를 버리는 가짜였다면 필터가 안 걸려도 우연히 통과할 수 있어서).
 */
import { NotFoundException } from '@nestjs/common';
import { StatsController } from '../src/stats/stats.controller';
import { StatsService } from '../src/stats/stats.service';
import { StoreService } from '../src/stats/store.service';
import { ParserService } from '../src/stats/parser.service';
import { CompetitionService } from '../src/stats/competition.service';
import { StatEvent } from '../src/stats/types';

// 진짜처럼 동작하는 인메모리 저장소. 넘어온 filter 를 기록하고, 그 필터를 실제로 적용한다.
class RecordingStore {
  readonly calls: ({ competitionId?: number } | undefined)[] = [];
  constructor(private readonly events: StatEvent[]) {}
  async getEvents(filter?: { competitionId?: number }): Promise<StatEvent[]> {
    this.calls.push(filter);
    return filter?.competitionId != null
      ? this.events.filter((e) => e.competitionId === filter.competitionId)
      : this.events;
  }
}

// 스탯 코드 하나 = 이벤트 하나(득점 계산은 aggregate 가 함).
function ev(
  competitionId: number,
  competitionLabel: string,
  week: number,
  game: number,
  player: string,
  team: string,
  stat: string,
): StatEvent {
  return { competitionId, competitionLabel, week, game, quarter: 1, player, stat, team };
}

// 픽스처 — 값이 겹치지 않게 고른다(우연히 맞는 걸 막으려고).
// 대회1(C1) w1g1: 강백호(OB) 3+2=5점, 서태웅(YB) 2×4=8점 → 팀 5:8 → L
// 대회1(C1) w2g1: 강백호(OB) 2+2=4점, 서태웅(YB) 2×1=2점 → 팀 4:2 → W
// 대회2(C2) w1g1: 강백호(OB) 3+3=6점, 정대만(YB) 3×1=3점 → 팀 6:3 → W
// 대회1 합계 9점/2경기, 대회2 6점/1경기, 통산 15점/3경기 — 셋 다 다른 값.
// 서태웅은 대회2에 없음, 정대만은 대회1에 없음.
const EVENTS: StatEvent[] = [
  ev(1, 'C1', 1, 1, '강백호', 'OB', '3'),
  ev(1, 'C1', 1, 1, '강백호', 'OB', '2'),
  ev(1, 'C1', 1, 1, '서태웅', 'YB', '2'),
  ev(1, 'C1', 1, 1, '서태웅', 'YB', '2'),
  ev(1, 'C1', 1, 1, '서태웅', 'YB', '2'),
  ev(1, 'C1', 1, 1, '서태웅', 'YB', '2'),
  ev(1, 'C1', 2, 1, '강백호', 'OB', '2'),
  ev(1, 'C1', 2, 1, '강백호', 'OB', '2'),
  ev(1, 'C1', 2, 1, '서태웅', 'YB', '2'),
  ev(2, 'C2', 1, 1, '강백호', 'OB', '3'),
  ev(2, 'C2', 1, 1, '강백호', 'OB', '3'),
  ev(2, 'C2', 1, 1, '정대만', 'YB', '3'),
];

async function main(): Promise<void> {
  let failures = 0;
  const fail = (msg: string) => {
    failures++;
    console.error(`  ✗ ${msg}`);
  };
  // 필터 객체({competitionId:1} 등)도 값으로 비교해야 해서 문자열화해서 견준다.
  const eq = (label: string, got: unknown, want: unknown) => {
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      fail(`${label}: 기대 ${JSON.stringify(want)}, 실제 ${JSON.stringify(got)}`);
    }
  };

  const store = new RecordingStore(EVENTS);
  const service = new StatsService(store as unknown as StoreService);

  // 1) 대회1 스코프 — 필터·합계·경기 수·상대 점수까지 확인.
  {
    const detail = await service.player('강백호', 1);
    eq('case1 필터', store.calls[store.calls.length - 1], { competitionId: 1 });
    if (!detail) {
      fail('case1: 강백호(대회1) 상세가 null');
    } else {
      eq('case1 totals.pts', detail.totals.pts, 9);
      eq('case1 games.length', detail.games.length, 2);
      for (const g of detail.games) eq(`case1 game ${g.id} competition`, g.competition, 'C1');
      const w1g1 = detail.games.find((g) => g.week === 1 && g.game === 1);
      if (!w1g1) {
        fail('case1: w1g1 경기를 못 찾음');
      } else {
        eq('case1 w1g1 teamScore', w1g1.teamScore, 5);
        eq('case1 w1g1 opponentScore', w1g1.opponentScore, 8);
        eq('case1 w1g1 result', w1g1.result, 'L');
        eq('case1 w1g1 opponent', w1g1.opponent, 'YB');
      }
    }
  }

  // 2) 대회2 스코프.
  {
    const detail = await service.player('강백호', 2);
    eq('case2 필터', store.calls[store.calls.length - 1], { competitionId: 2 });
    if (!detail) {
      fail('case2: 강백호(대회2) 상세가 null');
    } else {
      eq('case2 totals.pts', detail.totals.pts, 6);
      eq('case2 games.length', detail.games.length, 1);
      eq('case2 result', detail.games[0].result, 'W');
    }
  }

  // 3) 스코프 없음(통산) — 기록된 필터의 competitionId 가 undefined 인지까지 확인.
  {
    const detail = await service.player('강백호');
    const lastCall = store.calls[store.calls.length - 1];
    eq('case3 필터 competitionId', lastCall?.competitionId, undefined);
    if (!detail) {
      fail('case3: 강백호(통산) 상세가 null');
    } else {
      eq('case3 totals.pts', detail.totals.pts, 15);
      eq('case3 games.length', detail.games.length, 3);
    }
  }

  // 4) 그 대회에 안 뛴 선수 → null.
  {
    const detail = await service.player('서태웅', 2);
    eq('case4 서태웅(대회2)', detail, null);
  }

  // 5) 컨트롤러 파싱 — 서비스가 실제로 받은 인자를 기록해서 확인("결과"가 아니라 "무엇으로 조회했는지").
  {
    const seen: (number | undefined)[] = [];
    const original = service.player.bind(service);
    // 서비스가 받은 competitionId 를 기록 — "무엇으로 조회했는지"를 검증하려고.
    service.player = ((name: string, competitionId?: number) => {
      seen.push(competitionId);
      return original(name, competitionId);
    }) as typeof service.player;

    const controller = new StatsController(
      null as unknown as ParserService,
      null as unknown as StoreService,
      service,
      null as unknown as CompetitionService,
    );

    await controller.player('강백호', '2');
    eq('case5 "2" → seen 마지막', seen[seen.length - 1], 2);

    for (const raw of ['', '0', 'abc', undefined]) {
      const detail = await controller.player('강백호', raw);
      eq(`case5 "${raw}" → seen 마지막`, seen[seen.length - 1], undefined);
      eq(`case5 "${raw}" → pts`, (detail as { totals: { pts: number } }).totals.pts, 15);
    }

    try {
      await controller.player('서태웅', '2');
      fail('case5: 서태웅(대회2)이 NotFoundException 을 안 던짐');
    } catch (err) {
      if (!(err instanceof NotFoundException)) {
        fail(`case5: 던진 에러 타입이 NotFoundException 이 아님(${(err as Error)?.constructor?.name})`);
      }
    }
  }

  if (failures === 0) {
    console.log('✓ 검증 통과 — 선수 상세 대회 스코프 배선(서비스 필터 전달 + 컨트롤러 파싱) 전부 일치');
    process.exitCode = 0;
  } else {
    console.error(`\n검증 실패: ${failures}건 불일치`);
    process.exitCode = 1;
  }
}

main();
