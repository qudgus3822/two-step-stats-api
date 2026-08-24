# syntax=docker/dockerfile:1
# [변경: 2026-08-24 11:55, 김병현 수정] GCP Cloud Run 배포용 멀티스테이지 Dockerfile 신규 작성.
#   빌드 컨텍스트는 이 api 저장소 폴더 하나면 된다. 프론트(two-step-stats-front)는 별도 저장소라
#   빌드 도중 GitHub 에서 직접 clone 해서 같이 빌드한 뒤, 한 이미지에 담는다.
#
#   배포:  gcloud run deploy two-step-stats --source . --region asia-northeast3 --allow-unauthenticated
#
#   최종 이미지 폴더 구조 (이대로 유지해야 함):
#     /app/two-step-stats-api/dist/main.js      <- __dirname 기준점
#     /app/two-step-stats-front/dist/index.html <- ServeStaticModule 이 dist/../../ 로 찾아감
#   app.module.ts 의 rootPath: join(__dirname, "..", "..", "two-step-stats-front", "dist") 때문에
#   api/front 두 폴더가 나란히 있는 구조를 이미지 안에서도 그대로 재현해야 한다.

ARG NODE_VERSION=20-bookworm-slim


########################################
# 1) 프론트 빌드 (별도 저장소를 clone 해서 빌드)
########################################
FROM node:${NODE_VERSION} AS front-build

RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/*

ARG FRONT_REPO=https://github.com/qudgus3822/two-step-stats-front.git
# 브랜치명 / 태그 / 커밋 SHA 아무거나 됨. 배포 재현성이 필요하면 SHA 로 고정할 것.
ARG FRONT_REF=main
# 같은 FRONT_REF 라도 원격이 앞서 나갔을 때 강제로 다시 받게 하는 캐시 무효화 스위치.
#   예) --build-arg FRONT_CACHE_BUST=$(date +%s)
ARG FRONT_CACHE_BUST=0

# shallow fetch: 브랜치/태그/SHA 를 모두 지원하면서 히스토리는 1개만 받는다(빠름).
RUN git init /front \
 && cd /front \
 && git remote add origin "${FRONT_REPO}" \
 && git -c protocol.version=2 fetch --depth 1 origin "${FRONT_REF}" \
 && git checkout --detach FETCH_HEAD \
 && echo "프론트 빌드 커밋: $(git rev-parse HEAD)"

WORKDIR /front
RUN npm ci

# Vite 는 빌드 시점에 환경변수를 코드에 "박아넣는다"(런타임 주입 불가).
# Cloud Run 에선 프론트와 API 가 같은 도메인이라 상대경로 /api 로 고정하면 끝.
ARG VITE_API_BASE_URL=/api
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
RUN npm run build


########################################
# 2) API 빌드 (NestJS + Prisma)
########################################
FROM node:${NODE_VERSION} AS api-build
WORKDIR /api

# Prisma 쿼리 엔진이 openssl 을 필요로 함 (slim 이미지엔 없을 수 있음)
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# package.json 의 postinstall 이 `prisma generate` 라서 npm ci 전에 스키마가 있어야 한다
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

COPY . .
RUN npm run build


########################################
# 3) 운영용 의존성만 설치 (devDependencies 제거)
########################################
FROM node:${NODE_VERSION} AS api-deps
WORKDIR /api

COPY package.json package-lock.json ./
# --omit=dev 면 prisma CLI(devDependency)가 없어서 postinstall 이 깨진다.
# 그래서 스크립트를 끄고, 생성된 Prisma Client 는 아래 런타임 스테이지에서 api-build 로부터 복사해온다.
RUN npm ci --omit=dev --ignore-scripts \
 && npm cache clean --force


########################################
# 4) 런타임
########################################
FROM node:${NODE_VERSION} AS runtime

RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
WORKDIR /app

# 운영 의존성
COPY --from=api-deps  --chown=node:node /api/node_modules         ./two-step-stats-api/node_modules
# 빌드 스테이지에서 생성된 Prisma Client(+쿼리 엔진 바이너리)
COPY --from=api-build --chown=node:node /api/node_modules/.prisma ./two-step-stats-api/node_modules/.prisma
# 컴파일된 API
COPY --from=api-build --chown=node:node /api/dist                 ./two-step-stats-api/dist
COPY --from=api-build --chown=node:node /api/package.json         ./two-step-stats-api/package.json
# 마이그레이션 파일 (컨테이너에서 prisma migrate deploy 를 돌리고 싶을 때 필요)
COPY --from=api-build --chown=node:node /api/prisma               ./two-step-stats-api/prisma
# 프론트 빌드 산출물 — ServeStaticModule 이 이 경로를 본다
COPY --from=front-build --chown=node:node /front/dist             ./two-step-stats-front/dist

USER node
WORKDIR /app/two-step-stats-api

# Cloud Run 이 PORT 를 주입한다(기본 8080). main.ts 가 process.env.PORT 를 읽음.
ENV PORT=8080
EXPOSE 8080

CMD ["node", "dist/main.js"]
