import 'reflect-metadata';
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
