import { Injectable } from '@nestjs/common';
import { StoreService } from './store.service';
import {
  boxScoreForGame,
  leaderboard,
  LeaderboardMetric,
  listGames,
  listPlayers,
  playerDetail,
  summary,
} from './aggregate';
// [변경: 2026-07-27 16:14, 김병현 수정] 시너지 탭용 순수 리포트 함수 + 지표 타입 추가.
import { synergyReport, SynergyMetric } from './synergy';
// [변경: 2026-07-28 15:00, 김병현 수정] 기량 발전 탭용 순수 리포트 함수 + 지표 타입 추가.
import { growthReport, previousCompetitionId, GrowthMetric } from './growth';
// [변경: 2026-07-28 15:00, 김병현 수정] 직전 시즌을 알아내려면 대회 등록부가 필요해서 주입한다.
import { CompetitionService } from './competition.service';

// 저장소에서 이벤트를 읽어와 순수 집계 함수에 위임하는 얇은 서비스.
// [변경: 2026-07-14 17:32, 김병현 수정] 대회 모델 대개편 — season?: string → competitionId?: number.
// 옛 seasons() 메서드는 제거(컨트롤러가 CompetitionService.list 로 대체).
@Injectable()
export class StatsService {
  // [변경: 2026-07-28 15:00, 김병현 수정] 기량 발전 탭 — 직전 시즌을 알아내려면 대회 등록부가 필요해서
  // CompetitionService 를 주입한다(StatsModule 에 이미 provider 로 있어 모듈 파일은 안 건드린다).
  constructor(
    private readonly store: StoreService,
    private readonly competitionRegistry: CompetitionService,
  ) {}

  async games(competitionId?: number) {
    const events = await this.store.getEvents({ competitionId });
    return listGames(events);
  }

  async boxScore(id: string) {
    const events = await this.store.getEvents();
    return boxScoreForGame(events, id);
  }

  async players(competitionId?: number) {
    const events = await this.store.getEvents({ competitionId });
    return listPlayers(events);
  }

  // [변경: 2026-07-27 15:00, 김병현 수정] 선수 상세도 대회 필터를 받는다.
  // 다른 조회들과 같은 규칙 — competitionId 없으면 통산(전체 대회).
  // 필터는 여기(저장소 호출)에서만 건다. 집계 함수 playerDetail 은 순수하게 둔다.
  async player(name: string, competitionId?: number) {
    const events = await this.store.getEvents({ competitionId });
    return playerDetail(events, name);
  }

  // [변경: 2026-07-14 17:49, 김병현 수정] limit 선택적 — 생략 시 전체 반환.
  async leaderboard(metric: LeaderboardMetric, limit?: number, competitionId?: number) {
    const events = await this.store.getEvents({ competitionId });
    return leaderboard(events, metric, limit);
  }

  async summary(competitionId?: number) {
    const events = await this.store.getEvents({ competitionId });
    return summary(events);
  }

  // [변경: 2026-07-27 16:14, 김병현 수정] 시너지 리포트 위임 추가(형제 메서드와 같은 모양).
  async synergy(player: string, metric: SynergyMetric, competitionId?: number) {
    const events = await this.store.getEvents({ competitionId });
    return synergyReport(events, player, metric);
  }

  // [변경: 2026-07-28 15:00, 김병현 수정] 기량 발전 리포트 위임.
  // 이벤트를 통째로 읽지 않고 "이번 + 직전" 두 대회만 읽는다(전체 조회는 테이블 전부를 끌어온다).
  // 등록부에 없는 대회면 DB 를 건드리지 않고 바로 null → 컨트롤러가 404.
  // ⚠ 여기서 previousCompetitionId 를 부르는 건 "읽을 대회를 고르려는 것"이고, 진짜 '직전 시즌'
  //   판정은 growthReport 안에서 한 번 더 한다(순수 함수를 자족적으로 두려고 일부러 두 번 돈다).
  //   규칙을 바꿀 땐 growth.ts 한 곳만 고치면 양쪽이 같이 바뀐다.
  async growth(competitionId: number, metric: GrowthMetric) {
    const competitions = await this.competitionRegistry.list();
    if (!competitions.some((c) => c.id === competitionId)) return null;

    const prevId = previousCompetitionId(competitions, competitionId);
    const batches = await Promise.all([
      this.store.getEvents({ competitionId }),
      prevId == null ? Promise.resolve([]) : this.store.getEvents({ competitionId: prevId }),
    ]);
    return growthReport(batches.flat(), competitions, competitionId, metric);
  }
}
