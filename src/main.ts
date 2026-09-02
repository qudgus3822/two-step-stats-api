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
  // [변경: 2026-08-25 16:40, 김병현 수정] 내려받기 응답의 헤더를 브라우저 JS 가 읽을 수 있게 연다.
  //
  // CORS 기본값에서 fetch 가 읽을 수 있는 헤더는 몇 개 안 되는 '안전 목록'뿐이라,
  // 아무리 서버가 보내도 Content-Disposition 은 프론트에서 안 보인다(에러도 안 난다 —
  // 그냥 null 이라 파일 이름이 조용히 'download' 가 된다). 그래서 명시적으로 노출한다.
  //  - Content-Disposition : 서버가 지은 파일 이름 (GET /api/export, /api/championships/export)
  //  - X-Rawdata-Rows      : 내보낸 행 수 (화면 안내용)
  // [변경: 2026-09-02 김병현 수정] 우승 기록 내보내기의 건수 헤더 추가.
  //  - X-Championship-Rows : 내보낸 우승 줄 수
  app.enableCors({
    exposedHeaders: ['Content-Disposition', 'X-Rawdata-Rows', 'X-Championship-Rows'],
  });
  const port = process.env.PORT ? Number(process.env.PORT) : 13000;
  await app.listen(port);
  new Logger('Bootstrap').log(`투스텝 기록 API 서버 실행: http://localhost:${port}`);
}

void bootstrap();
