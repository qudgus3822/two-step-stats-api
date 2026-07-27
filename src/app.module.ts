import { Module } from "@nestjs/common";
import { PrismaModule } from "./prisma/prisma.module";
import { StatsModule } from "./stats/stats.module";
import { ServeStaticModule } from "@nestjs/serve-static";
import { join } from "path";
@Module({
  imports: [
    ServeStaticModule.forRoot({
      // 프론트 빌드 결과물(dist)을 API가 같이 내려준다
      rootPath: join(__dirname, "..", "..", "two-step-stats-front", "dist"),
      // [변경: 2026-07-27 11:02, 김병현 수정] /api 는 SPA fallback(index.html) 대상에서 제외 — 없는 API 주소는 index.html 대신 404 JSON을 받도록
      exclude: ["/api/(.*)"],
    }),
    PrismaModule,
    StatsModule,
  ],
})
export class AppModule {}
