import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
// [변경: 2026-07-15 14:10, 김병현 수정] 충돌 감지 응답 타입(GameConflict) 추가.
import { GameConflict, ParsedEvent, StatEvent } from './types';

// 이벤트 로그의 저장/조회를 담당하는 저장소 (Prisma → Postgres).
// 집계 로직은 aggregate.ts 의 순수 함수가 담당하고, 여기선 CRUD만 다룬다.
//
// [변경: 2026-07-14 17:32, 김병현 수정] 대회 모델 대개편 — 쓰기/읽기 이벤트의 모양이 달라졌다.
// 쓸 때는 ParsedEvent(대회 없음) + competitionId 를 붙여서 저장하고, 읽을 때는 competitions
// 테이블을 조인해 competitionLabel 을 붙여 StatEvent 로 돌려준다. createMany 에 competitionLabel
// 을 넣으면 "그런 컬럼 없음" 에러가 나므로, 이 경계에서 쓰기/읽기 모양을 명확히 분리해 다룬다.
@Injectable()
export class StoreService {
  constructor(private readonly prisma: PrismaService) {}

  // [변경: 2026-07-14 14:21, 김병현 수정] 시즌 통째 교체 → '파일에 담긴 경기만' 교체.
  // 엑셀 한 파일 = (대회, 경기) 단위라, 같은 경기를 다시 올리면 그 경기만 덮어쓴다.
  // 파일 안에 등장한 (주차, 경기) 조합만 지우고 새로 넣어, 같은 대회의 다른 경기는 안 건드린다.
  // (DB 스키마는 그대로 — 삭제 범위만 season → (season, week, game)으로 좁힌 것.)
  // [변경: 2026-07-14 17:32, 김병현 수정] season(문자열) → competitionId(FK) 기준으로 전환.
  async replaceGames(competitionId: number, events: ParsedEvent[]): Promise<number> {
    if (events.length === 0) return 0;

    // [변경: 2026-07-15 14:10, 김병현 수정] 인라인 dedup 를 collectGameKeys 로 추출(findExistingGames 와 공유).
    const targets = this.collectGameKeys(events);

    // competitionId AND (그 파일의 경기들 중 하나)에 해당하는 기존 행만 삭제 후 재적재.
    await this.prisma.$transaction([
      this.prisma.statEvent.deleteMany({ where: { competitionId, OR: targets } }),
      this.prisma.statEvent.createMany({
        data: events.map((e) => ({ competitionId, ...e })),
      }),
    ]);
    return events.length;
  }

  // [변경: 2026-07-15 14:10, 김병현 수정] replaceGames 인라인 dedup 를 메서드로 추출(findExistingGames 와 공유).
  // 이 파일에 나온 (주차, 경기) 조합만 추린다(보통 한 개). 중복 제거.
  private collectGameKeys(events: ParsedEvent[]): { week: number; game: number }[] {
    const seen = new Set<string>();
    const targets: { week: number; game: number }[] = [];
    for (const e of events) {
      const key = `${e.week}|${e.game}`;
      if (seen.has(key)) continue;
      seen.add(key);
      targets.push({ week: e.week, game: e.game });
    }
    return targets;
  }

  // [변경: 2026-07-15 14:10, 김병현 수정] 업로드 파일의 (주차,경기)들 중 이 대회에 이미 있는 것만
  // 골라 건수와 함께 돌려준다. 쓰기 전에 "덮어쓸지 물어볼" 대상 목록을 만드는 용도.
  // 겹치는 게 없으면 빈 배열 → 컨트롤러는 그냥 진행한다.
  async findExistingGames(
    competitionId: number,
    events: ParsedEvent[],
  ): Promise<GameConflict[]> {
    const targets = this.collectGameKeys(events);
    if (targets.length === 0) return []; // 빈 파일 등 — 겹칠 게 없다
    const groups = await this.prisma.statEvent.groupBy({
      by: ['week', 'game'],
      where: { competitionId, OR: targets }, // @@index([competitionId,week,game]) 사용
      _count: true,
    });
    return groups.map((g) => ({ week: g.week, game: g.game, existingCount: g._count }));
  }

  // 특정 대회에 이벤트를 추가 (증분 적재)
  // [변경: 2026-07-14 17:32, 김병현 수정] appendSeason → appendCompetition, competitionId 기준.
  async appendCompetition(competitionId: number, events: ParsedEvent[]): Promise<number> {
    if (events.length === 0) return 0;
    const res = await this.prisma.statEvent.createMany({
      data: events.map((e) => ({ competitionId, ...e })),
    });
    return res.count;
  }

  // 전체(또는 대회 필터) 이벤트 조회 → 도메인 StatEvent 형태로 매핑.
  // competitions 를 조인(include)해서 competitionLabel 을 함께 붙인다 — 조인이 없으면
  // row.competition.label 이 undefined 가 된다(주의점).
  async getEvents(filter?: { competitionId?: number }): Promise<StatEvent[]> {
    const rows = await this.prisma.statEvent.findMany({
      where:
        filter?.competitionId != null ? { competitionId: filter.competitionId } : undefined,
      include: { competition: { select: { label: true } } },
      orderBy: [
        { competitionId: 'asc' },
        { week: 'asc' },
        { game: 'asc' },
        { quarter: 'asc' },
        { id: 'asc' },
      ],
    });
    return rows.map((r) => ({
      competitionId: r.competitionId,
      competitionLabel: r.competition.label,
      week: r.week,
      game: r.game,
      quarter: r.quarter,
      player: r.player,
      stat: r.stat,
      team: r.team,
    }));
  }

  // 특정 대회 삭제 (없으면 전체 삭제)
  async clear(competitionId?: number): Promise<number> {
    const res = await this.prisma.statEvent.deleteMany({
      where: competitionId != null ? { competitionId } : undefined,
    });
    return res.count;
  }
}
