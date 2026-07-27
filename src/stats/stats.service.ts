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

// 저장소에서 이벤트를 읽어와 순수 집계 함수에 위임하는 얇은 서비스.
// [변경: 2026-07-14 17:32, 김병현 수정] 대회 모델 대개편 — season?: string → competitionId?: number.
// 옛 seasons() 메서드는 제거(컨트롤러가 CompetitionService.list 로 대체).
@Injectable()
export class StatsService {
  constructor(private readonly store: StoreService) {}

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
}
