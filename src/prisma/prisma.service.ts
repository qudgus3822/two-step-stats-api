import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

// Prisma 클라이언트를 NestJS 생명주기에 연결하는 서비스.
// 앱 시작 시 연결을 시도하되, 실패해도 부팅은 막지 않는다(쿼리 시점에 재시도).
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit(): Promise<void> {
    try {
      await this.$connect();
      this.logger.log('Postgres(Supabase) 연결 성공');
    } catch (err) {
      // 연결 실패 시에도 서버는 뜨게 두고, DB 접근이 필요한 요청에서만 에러가 나도록 한다.
      this.logger.error(
        'Postgres 연결 실패 — .env 의 DATABASE_URL/DIRECT_URL 비밀번호를 확인하세요.',
        err as Error,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
