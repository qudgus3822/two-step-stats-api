import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// [변경: 2026-07-14 17:32, 김병현 수정] 대회 모델 대개편 — (연도, 시즌번호(선택), 대회명) 기준.
// 대회는 이제 stat_events 가 FK 로 참조하는 "진짜 행"이다. 업로드 화면은 연도+시즌번호(선택)+
// 대회명을 골라 이 서비스로 upsert 하고, 그 id 를 이벤트 적재에 쓴다. 라벨 규칙(competitionLabel)과
// 멱등 등록(create)·정렬(list)·안전 삭제(remove)를 모두 여기 한 곳에 모아, 소비자는 "무엇을"만
// 알면 되고 "어떻게(NULL 함정 회피, FK 에러코드 해석)"는 몰라도 된다.

export interface CompetitionRow {
  id: number;
  year: number;
  seasonNo: number | null;
  name: string;
  label: string;
  createdAt: Date;
}

// 연도+시즌번호(선택)+대회명 → 표시 라벨. 시즌번호가 있으면 "2026 시즌3 · 나이배",
// 없으면 "2026 나이배". 이 규칙을 한 곳에 모아 프론트/DB가 같은 값을 쓰게 한다.
//
// 왜 label 이 유니크 키인가: seasonNo 는 NULL 이 가능한데, Postgres 는 유니크 인덱스에서
// NULL 을 서로 다른 값으로 취급한다. 그래서 @@unique([year, seasonNo, name]) 로는
// (2026, NULL, "나이배") 가 여러 번 중복 등록될 수 있다(멱등이 깨짐). label 은 항상 non-null
// 문자열이라 이 함정을 피하고, upsert({ where: { label } }) 로 멱등을 보장할 수 있다.
export function competitionLabel(
  year: number,
  seasonNo: number | null | undefined,
  name: string,
): string {
  return seasonNo != null ? `${year} 시즌${seasonNo} · ${name}` : `${year} ${name}`;
}

@Injectable()
export class CompetitionService {
  constructor(private readonly prisma: PrismaService) {}

  // 등록된 대회 목록. 최신 대회부터: 연도 내림차순 → 시즌번호 내림차순(NULL 은 맨 뒤) →
  // 대회명 오름차순. (예: 2026 시즌3, 2026 시즌1, 2026 나이배, 2025 시즌2 …)
  list(): Promise<CompetitionRow[]> {
    return this.prisma.competition.findMany({
      orderBy: [
        { year: 'desc' },
        { seasonNo: { sort: 'desc', nulls: 'last' } },
        { name: 'asc' },
      ],
    });
  }

  // 대회 등록. 라벨로 upsert → 같은 조합(연도+시즌번호+대회명)을 또 등록해도
  // 에러 없이 기존 행을 그대로 반환한다(멱등).
  create(year: number, seasonNo: number | null, name: string): Promise<CompetitionRow> {
    const label = competitionLabel(year, seasonNo, name);
    return this.prisma.competition.upsert({
      where: { label },
      update: {}, // 이미 있으면 그대로
      create: { year, seasonNo, name, label },
    });
  }

  // 대회 삭제. FK(onDelete: Restrict) 때문에 경기 기록이 있는 대회는 지울 수 없다
  // (고아 이벤트 방지) — 그 경우 Prisma 가 던지는 외래키 위반을 'has-events' 로 해석해 돌려준다.
  // - 'removed': 정상 삭제됨
  // - 'not-found': 이미 없는 id (Prisma P2025)
  // - 'has-events': 이 대회에 경기 기록이 있어 삭제 불가 (Prisma P2003/P2014, FK 위반)
  async remove(id: number): Promise<'removed' | 'not-found' | 'has-events'> {
    try {
      await this.prisma.competition.delete({ where: { id } });
      return 'removed';
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === 'P2025') return 'not-found';
      if (code === 'P2003' || code === 'P2014') return 'has-events';
      throw err;
    }
  }
}
