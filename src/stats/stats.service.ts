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

  async player(name: string) {
    const events = await this.store.getEvents();
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
}
