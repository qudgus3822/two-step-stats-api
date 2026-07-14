import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

// PrismaService 를 전역 모듈로 제공해 어디서든 주입 가능하게 한다.
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
