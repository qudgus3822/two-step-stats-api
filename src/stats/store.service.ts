import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
// [변경: 2026-07-15 14:10, 김병현 수정] 충돌 감지 응답 타입(GameConflict) 추가.
import { GameConflict, ParsedEvent, StatEvent } from './types';

// [신설: 2026-07-29 11:10, 김병현 작성] '전체 대회'(competitionId 없음) 캐시 칸의 키.
// 문자열 'all' 이 아니라 심볼인 이유: 키 타입이 number | symbol 이라, 혹시라도 대회 id 와
// 값이 겹칠 수가 없다. 대회 id 는 숫자고 심볼은 세상에 이 하나뿐이다.
const ALL_KEY = Symbol('all-competitions');

// 이벤트 로그의 저장/조회를 담당하는 저장소 (Prisma → Postgres).
// 집계 로직은 aggregate.ts 의 순수 함수가 담당하고, 여기선 CRUD만 다룬다.
//
// [변경: 2026-07-14 17:32, 김병현 수정] 대회 모델 대개편 — 쓰기/읽기 이벤트의 모양이 달라졌다.
// 쓸 때는 ParsedEvent(대회 없음) + competitionId 를 붙여서 저장하고, 읽을 때는 competitions
// 테이블을 조인해 competitionLabel 을 붙여 StatEvent 로 돌려준다. createMany 에 competitionLabel
// 을 넣으면 "그런 컬럼 없음" 에러가 나므로, 이 경계에서 쓰기/읽기 모양을 명확히 분리해 다룬다.
//
// [변경: 2026-07-29 11:10, 김병현 수정] 읽은 이벤트를 메모리에 들고 있는다(TTL 없음).
//
// 왜: DB 가 원격 Postgres(Supabase)라 요청 하나마다 인터넷 왕복이 든다. 그런데 이 데이터는
// "엑셀을 업로드할 때만" 바뀐다 — 시간이 지났다고 낡지 않는다. 그래서 시간(TTL)이 아니라
// "쓰기가 일어났을 때"만 버린다. 읽기 100번이든 1000번이든 DB 는 대회당 딱 한 번만 간다.
//
// 무엇을 캐싱하나 — "가공된 응답"이 아니라 "원본 이벤트"다. 응답(리더보드·시너지·기량발전)을
// 캐싱하면 키가 (선수 × 지표 × 대회) 로 수천 개까지 불어나지만, 원본은 대회 하나당 한 칸이라
// 칸 수가 대회 개수(+전체 1칸)로 딱 묶인다. 집계는 어차피 메모리 위에서 도는 순수 계산이라 빠르다.
//
// ⚠ 이 캐시가 낡을 수 있는 유일한 경우: 이 서버를 거치지 않고 DB 를 바꿨을 때
//   (scripts/seed.ts, scripts/import-legacy-xlsx.ts, Supabase 콘솔에서 직접 수정 등).
//   그때는 서버를 재시작하거나 POST /api/cache/refresh 를 부르면 된다.
@Injectable()
export class StoreService {
  private readonly logger = new Logger(StoreService.name);

  // 대회별 이벤트 캐시. 키는 competitionId, '전체 대회'는 ALL_KEY 한 칸.
  //
  // 값이 배열이 아니라 Promise 인 이유(중요): 캐시가 비어 있을 때 요청 3개가 동시에 들어오면
  // 값으로 담을 경우 셋 다 "없네" 하고 각자 DB 를 친다(같은 쿼리 3번). 약속(Promise)을 먼저
  // 꽂아 두면 뒤따라온 둘은 그 약속에 매달려 기다린다 → DB 는 1번만 간다.
  // 대시보드가 summary 와 games 를 동시에 부르는데 둘 다 같은 키를 쓰므로 실제로 자주 겹친다.
  private readonly cache = new Map<number | typeof ALL_KEY, Promise<StatEvent[]>>();

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
    // [변경: 2026-07-29 11:10, 김병현 수정] 이 대회 데이터가 갈렸으니 캐시를 버린다.
    // (위 early return 자리에선 안 부른다 — 이벤트가 0건이면 DB 에 쓴 것도 없어서 낡을 게 없다.)
    this.invalidate(competitionId);
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
    // [변경: 2026-07-29 11:10, 김병현 수정] 증분 적재도 이 대회 데이터를 바꾼다 → 캐시 버림.
    this.invalidate(competitionId);
    return res.count;
  }

  // 전체(또는 대회 필터) 이벤트 조회. 캐시에 있으면 DB 를 안 간다.
  //
  // ⚠ 돌려주는 배열은 캐시가 들고 있는 바로 그 배열이다(복사본 아님). 받은 쪽이 sort() 같은
  //   제자리 변형을 하면 캐시가 오염돼 다음 요청부터 엉뚱한 값이 나온다.
  //   지금은 aggregate.ts / synergy.ts / growth.ts 의 집계 함수가 전부 순수해서(입력을 안 건드리고
  //   새 배열을 만들어 정렬한다) 안전하다. 새 집계를 붙일 때도 이 계약을 지켜야 한다.
  //   (매번 복사하면 안전하지만, 이벤트 수만큼 배열을 새로 만드는 값을 매 요청 치르게 된다.)
  async getEvents(filter?: { competitionId?: number }): Promise<StatEvent[]> {
    const key = filter?.competitionId ?? ALL_KEY;
    const cached = this.cache.get(key);
    if (cached) return cached;

    const started = Date.now();
    // 약속을 먼저 만들고 그 약속을 캐시에 꽂는다(위 필드 주석의 "동시 요청 합치기").
    const pending: Promise<StatEvent[]> = this.fetchEvents(filter?.competitionId)
      .then((events) => {
        this.logger.log(
          `이벤트 캐시 채움 [${String(key)}] ${events.length}건 · ${Date.now() - started}ms`,
        );
        return events;
      })
      .catch((err: unknown) => {
        // 실패한 약속을 남겨 두면 그 대회는 서버를 재시작할 때까지 영영 에러만 돌려준다.
        // 지우고 다시 던져서, 다음 요청이 처음부터 새로 시도하게 한다.
        // 내가 꽂은 약속이 아직 그대로일 때만 지운다 — 그 사이 업로드가 캐시를 갈아치웠으면
        // 남의 (멀쩡한) 약속을 지우는 셈이 된다.
        if (this.cache.get(key) === pending) this.cache.delete(key);
        throw err;
      });

    this.cache.set(key, pending);
    return pending;
  }

  // 실제 DB 조회. 캐시 미스일 때만 불린다.
  // competitions 를 조인(include)해서 competitionLabel 을 함께 붙인다 — 조인이 없으면
  // row.competition.label 이 undefined 가 된다(주의점).
  private async fetchEvents(competitionId?: number): Promise<StatEvent[]> {
    const rows = await this.prisma.statEvent.findMany({
      where: competitionId != null ? { competitionId } : undefined,
      include: { competition: { select: { label: true } } },
      orderBy: [
        { competitionId: 'asc' },
        { week: 'asc' },
        { game: 'asc' },
        { quarter: 'asc' },
        { id: 'asc' },
      ],
    });
    // [변경: 2026-07-29 12:10, 김병현 수정] 저장소는 언제나 '원본 그대로' 돌려준다.
    //
    // (기록: 한때 여기서 연장경기 흡수(mergeOvertimeGames)까지 하고 내보냈다. 그러면 경기 목록도
    //  같이 합쳐져서 "화면엔 연장을 따로, 스탯만 합치기"가 불가능했다. 그래서 흡수는 스탯 경로
    //  한 곳(stats.service.ts 의 statEvents)으로 옮겼다 — 저장소는 규칙을 모르는 게 맞다.)
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
    // [변경: 2026-07-29 11:10, 김병현 수정] 지웠으면 캐시도 버린다.
    this.invalidate(competitionId);
    return res.count;
  }

  // ── 캐시 무효화 ────────────────────────────────────────────────────────
  // [신설: 2026-07-29 11:10, 김병현 작성]

  // 쓰기가 일어난 뒤 낡은 칸을 버린다. 다음 읽기가 DB 에서 새로 채운다(지금 미리 안 채운다 —
  // 업로드 응답을 그만큼 늦출 이유가 없고, 어차피 화면이 곧바로 다시 부른다).
  //
  // 대회 하나를 건드려도 '전체 대회' 칸(ALL_KEY)까지 같이 버려야 한다. 그 칸은 모든 대회의
  // 이벤트를 담고 있어서, 그중 한 대회가 바뀌면 통째로 낡기 때문이다.
  // (대시보드 박스스코어가 이 칸을 쓴다 — StatsService.boxScore 는 필터 없이 부른다.)
  private invalidate(competitionId?: number): void {
    if (competitionId == null) {
      // 대회를 안 집었다 = 전부 지운 것 → 캐시도 전부.
      this.invalidateAll();
      return;
    }
    this.cache.delete(competitionId);
    this.cache.delete(ALL_KEY);
    this.logger.log(`이벤트 캐시 버림 [${competitionId}] + [전체]`);
  }

  // 캐시를 통째로 비운다.
  // 이 서버를 안 거치고 DB 가 바뀐 경우(scripts/seed.ts, scripts/import-legacy-xlsx.ts,
  // Supabase 콘솔에서 직접 수정 등)를 위한 수동 탈출구. 컨트롤러의 POST /cache/refresh 가 쓴다.
  invalidateAll(): void {
    this.cache.clear();
    this.logger.log('이벤트 캐시 전부 버림');
  }
}
