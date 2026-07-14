import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StatEvent } from './types';

// 이벤트 로그의 저장/조회를 담당하는 저장소 (Prisma → Postgres).
// 집계 로직은 aggregate.ts 의 순수 함수가 담당하고, 여기선 CRUD만 다룬다.
@Injectable()
export class StoreService {
  constructor(private readonly prisma: PrismaService) {}

  // [변경: 2026-07-14 14:21, 김병현 수정] 시즌 통째 교체 → '파일에 담긴 경기만' 교체.
  // 엑셀 한 파일 = (시즌, 경기) 단위라, 같은 경기를 다시 올리면 그 경기만 덮어쓴다.
  // 파일 안에 등장한 (주차, 경기) 조합만 지우고 새로 넣어, 같은 시즌의 다른 경기는 안 건드린다.
  // (DB 스키마는 그대로 — 삭제 범위만 season → (season, week, game)으로 좁힌 것.)
  async replaceGames(season: string, events: StatEvent[]): Promise<number> {
    if (events.length === 0) return 0;

    // 이 파일에 나온 (주차, 경기) 조합만 추린다(보통 한 개). 중복 제거.
    const seen = new Set<string>();
    const targets: { week: number; game: number }[] = [];
    for (const e of events) {
      const key = `${e.week}|${e.game}`;
      if (seen.has(key)) continue;
      seen.add(key);
      targets.push({ week: e.week, game: e.game });
    }

    // season AND (그 파일의 경기들 중 하나)에 해당하는 기존 행만 삭제 후 재적재.
    await this.prisma.$transaction([
      this.prisma.statEvent.deleteMany({ where: { season, OR: targets } }),
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
