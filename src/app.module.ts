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
    }),
    PrismaModule,
    StatsModule,
  ],
})
export class AppModule {}
