import 'reflect-metadata';
// [변경: 2026-07-14 22:05, 김병현 수정] .env 를 앱 부팅(NestFactory.create) 이전에 로드해 process.env(DATABASE_URL/PORT 등)를 채운다. Prisma 런타임 클라이언트는 .env 를 자동 로드하지 않으므로 필수.
import 'dotenv/config';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
// [변경: 2026-07-29 11:30, 김병현 수정] 응답 본문 gzip 압축 미들웨어 추가.
import compression from 'compression';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.use(compression());
  app.enableCors();
  const port = process.env.PORT ? Number(process.env.PORT) : 13000;
  await app.listen(port);
  new Logger('Bootstrap').log(`투스텝 기록 API 서버 실행: http://localhost:${port}`);
}

void bootstrap();
