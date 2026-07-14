import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StatEvent } from './types';

// 이벤트 로그의 저장/조회를 담당하는 저장소 (Prisma → Postgres).
// 집계 로직은 aggregate.ts 의 순수 함수가 담당하고, 여기선 CRUD만 다룬다.
@Injectable()
export class StoreService {
  constructor(private readonly prisma: PrismaService) {}

  // 특정 시즌의 이벤트를 통째로 교체 (엑셀 재업로드 시 중복 없이 최신화)
  async replaceSeason(season: string, events: StatEvent[]): Promise<number> {
    await this.prisma.$transaction([
      this.prisma.statEvent.deleteMany({ where: { season } }),
      this.prisma.statEvent.createMany({ data: events }),
    ]);
    return events.length;
  }

  // 특정 시즌에 이벤트를 추가 (증분 적재)
  async appendSeason(_season: string, events: StatEvent[]): Promise<number> {
    if (events.length === 0) return 0;
    const res = await this.prisma.statEvent.createMany({ data: events });
    return res.count;
  }

  // 전체(또는 시즌 필터) 이벤트 조회 → 도메인 StatEvent 형태로 매핑
  async getEvents(filter?: { season?: string }): Promise<StatEvent[]> {
    const rows = await this.prisma.statEvent.findMany({
      where: filter?.season ? { season: filter.season } : undefined,
      orderBy: [
        { season: 'asc' },
        { week: 'asc' },
        { game: 'asc' },
        { quarter: 'asc' },
        { id: 'asc' },
      ],
    });
    return rows.map((r) => ({
      season: r.season,
      week: r.week,
      game: r.game,
      quarter: r.quarter,
      player: r.player,
      stat: r.stat,
      team: r.team,
    }));
  }

  // 저장된 시즌 목록
  async seasons(): Promise<string[]> {
    const rows = await this.prisma.statEvent.findMany({
      distinct: ['season'],
      select: { season: true },
      orderBy: { season: 'asc' },
    });
    return rows.map((r) => r.season);
  }

  // 특정 시즌 삭제 (없으면 전체 삭제)
  async clear(season?: string): Promise<number> {
    const res = await this.prisma.statEvent.deleteMany({
      where: season ? { season } : undefined,
    });
    return res.count;
  }
}
