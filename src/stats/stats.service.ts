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
@Injectable()
export class StatsService {
  constructor(private readonly store: StoreService) {}

  async games(season?: string) {
    const events = await this.store.getEvents({ season });
    return listGames(events);
  }

  async boxScore(id: string) {
    const events = await this.store.getEvents();
    return boxScoreForGame(events, id);
  }

  async players(season?: string) {
    const events = await this.store.getEvents({ season });
    return listPlayers(events);
  }

  async player(name: string) {
    const events = await this.store.getEvents();
    return playerDetail(events, name);
  }

  async leaderboard(metric: LeaderboardMetric, limit: number, season?: string) {
    const events = await this.store.getEvents({ season });
    return leaderboard(events, metric, limit);
  }

  async summary(season?: string) {
    const events = await this.store.getEvents({ season });
    return summary(events);
  }

  async seasons() {
    return this.store.seasons();
  }
}
