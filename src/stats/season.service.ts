import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// [변경: 2026-07-14 14:21, 김병현 수정] 시즌 등록부(레지스트리) 서비스.
// 업로드할 때 자유 입력 대신 '등록된 시즌'만 고르게 하려고 시즌명을 seasons 테이블로 관리한다.
// 스탯 집계는 여전히 stat_events.season(문자열)로 하고, 이 테이블은 '어떤 시즌명이 유효한가'의
// 원천(허용 시즌명 사전) 역할만 한다. StatEvent CRUD 는 StoreService, 시즌 등록부는 여기로 분리.

export interface SeasonRow {
  id: number;
  name: string;
  createdAt: Date;
}

@Injectable()
export class SeasonService {
  constructor(private readonly prisma: PrismaService) {}

  // 등록된 시즌 목록 (최근 등록 순 → 방금 만든 게 위에)
  list(): Promise<SeasonRow[]> {
    return this.prisma.season.findMany({ orderBy: { createdAt: 'desc' } });
  }

  // 시즌 등록. 같은 이름이 이미 있으면 그 행을 그대로 돌려준다(중복 등록해도 에러 없이 멱등).
  create(name: string): Promise<SeasonRow> {
    const trimmed = name.trim();
    return this.prisma.season.upsert({
      where: { name: trimmed },
      update: {}, // 이미 있으면 그대로
      create: { name: trimmed },
    });
  }

  // 시즌 등록 해제. 경기 기록(stat_events)은 건드리지 않고 '허용 목록'에서만 뺀다.
  // 없는 id 면 false (이미 지워졌거나 잘못된 id).
  async remove(id: number): Promise<boolean> {
    try {
      await this.prisma.season.delete({ where: { id } });
      return true;
    } catch {
      return false;
    }
  }
}
