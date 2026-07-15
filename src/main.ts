import 'reflect-metadata';
// [변경: 2026-07-14 22:05, 김병현 수정] .env 를 앱 부팅(NestFactory.create) 이전에 로드해 process.env(DATABASE_URL/PORT 등)를 채운다. Prisma 런타임 클라이언트는 .env 를 자동 로드하지 않으므로 필수.
import 'dotenv/config';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  // 프론트(SvelteKit 대시보드 등)에서 브라우저로 직접 호출할 수 있도록 CORS 허용
  app.enableCors();
  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  await app.listen(port);
  new Logger('Bootstrap').log(`투스텝 기록 API 서버 실행: http://localhost:${port}`);
}

void bootstrap();
