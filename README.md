# two-step-stats-api

농구 동호회 엑셀 기록지를 데이터화해서 **박스스코어 / 랭킹 / 선수 추이**를 서빙하는 NestJS API 서버.

엑셀 Rawdata 시트의 왼쪽 6개 컬럼(주차·경기·쿼터·선수·스텟·팀명)을 **롱 포맷 이벤트 로그**로 정규화해 Postgres(Supabase)에 적재하고, 박스스코어 등 파생 스탯은 전부 이 로그를 집계해서 계산한다.

```
two-step-stats/                ← 워크스페이스 루트(모노레포)
├── two-step-stats-api/        ← 이 프로젝트 (NestJS API)
└── two-step-stats-front/      ← 프론트(대시보드) 예정
```

## 데이터 모델

이벤트 한 건 = 엑셀 한 행 (`stat_events` 테이블):

| season | week | game | quarter | player | stat | team |
| ------ | ---- | ---- | ------- | ------ | ---- | ---- |
| 시즌   | 주차 | 경기 | 쿼터    | 선수   | 스텟 코드 | 팀명 |

### 스코어링 룰 (동호회 자체 룰)

| 코드 | 의미 | 점수 |
| ---- | ---- | ---- |
| `2` / `3` | 2점 · 3점 필드골 성공 | 2 · 3 |
| `1` | 앤드원 보너스 (자유투 없이 자동 1점) | 1 |
| `2F` | 자유투(2점짜리, 한 번만 던짐) 성공 | 2 |
| `1F` | 자유투(1점짜리, 3점슛 파울 시) 성공 | 1 |
| `2A` / `3A` | 2·3점 시도 실패 | 0 |
| `2FA` / `1FA` | 자유투 실패 | 0 |
| `S`·`B`·`A`·`T`·`OR`·`DR` | 스틸·블락·어시·턴오버·공격리바·수비리바 | 0 |

> 앤드원은 `2`(필드골 2점) + `1`(보너스 1점) 두 이벤트로 기록되어 자동으로 3점이 된다.
> 룰 수정은 [`src/stats/scoring.ts`](src/stats/scoring.ts) 의 `POINTS` 딕셔너리 한 곳만 고치면 된다.

## 셋업

### 1. 의존성 설치

```bash
npm install   # postinstall 에서 prisma generate 까지 실행됨
```

### 2. 환경변수 (`.env`)

`.env.example` 참고. Supabase 연결 정보의 `[YOUR-PASSWORD]` 를 실제 비밀번호로 채운다.

```
DATABASE_URL="postgresql://...pooler.supabase.com:6543/postgres?pgbouncer=true"  # 런타임(트랜잭션 풀러)
DIRECT_URL="postgresql://...pooler.supabase.com:5432/postgres"                   # 마이그레이션(세션 풀러)
PORT=3000
```

### 3. DB 마이그레이션 & (선택) 시드

```bash
npx prisma migrate dev --name init   # stat_events 테이블 생성
npx ts-node scripts/seed.ts          # 샘플 기록지(실제 3주차 3경기) 103건 적재
```

## 실행

```bash
npm run start:dev    # 개발(watch)
npm run build        # 빌드 → dist/main.js
npm run start:prod   # 프로덕션 실행
```

## API

| 메서드 | 경로 | 설명 |
| ------ | ---- | ---- |
| `POST` | `/upload?season=&mode=replace\|append` | 엑셀(.xlsx) 업로드 → 이벤트 적재. `file` 필드(multipart) |
| `GET`  | `/seasons` | 시즌 목록 |
| `GET`  | `/summary?season=` | 데이터 요약(규모·코드 사용 히스토그램) |
| `GET`  | `/games?season=` | 경기 목록(팀 점수·승패) |
| `GET`  | `/games/:id` | 경기 박스스코어(양 팀·선수별) |
| `GET`  | `/players?season=` | 선수 목록(출전 수·누적 득점) |
| `GET`  | `/players/:name` | 선수 상세(누적 + 경기별 추이·승패) |
| `GET`  | `/leaderboard?metric=pts&limit=20&season=` | 지표별 리더보드 |
| `DELETE` | `/data?season=` | 데이터 삭제(시즌 미지정 시 전체) |

리더보드 지표: `pts reb oreb dreb ast stl blk tov fgm fg2m fg3m ftm andOne`

### 업로드 예시

```bash
curl -F "file=@기록지.xlsx" "http://localhost:3000/upload?season=2026-시즌2"
```

- `mode=replace`(기본): 같은 시즌 데이터를 통째로 교체 (재업로드 시 중복 방지)
- `mode=append`: 증분 추가
- 미등록 스텟 코드가 있으면 응답의 `warnings`/`unknownCodes` 로 알려준다 (3년치 파일 오타 조기 발견용)

## 파이프라인 검증

DB 없이 집계 엔진을 실제 기록지 결과와 대조하는 스크립트:

```bash
npm run check    # scripts/fixtures/real-stats.json 로 박스스코어 전량 대조
# ✓ 검증 통과 — 선수 14명 박스스코어 + 팀 점수(OB 28 : 27 YB) 전부 일치
```

샘플 엑셀 생성(업로드/파서 테스트용):

```bash
npm run sample   # scripts/fixtures/sample-기록지.xlsx 생성
```

## 구조

```
src/
├── main.ts                     # 부트스트랩(CORS·포트)
├── app.module.ts
├── prisma/
│   ├── prisma.service.ts       # PrismaClient 생명주기
│   └── prisma.module.ts        # 전역 모듈
└── stats/
    ├── types.ts                # 도메인 타입(StatEvent, BoxScore …)
    ├── scoring.ts              # 스텟 코드 → 득점 + 박스스코어 계산(순수 함수)
    ├── aggregate.ts            # 경기/선수/리더보드 집계(순수 함수 — DB 무관)
    ├── parser.service.ts       # xlsx → 정규화 이벤트(헤더 탐지·forward-fill·범례 제거)
    ├── store.service.ts        # Prisma CRUD
    ├── stats.service.ts        # store + aggregate 연결
    ├── stats.controller.ts     # HTTP 엔드포인트
    └── stats.module.ts
```

집계 로직(`scoring.ts`·`aggregate.ts`)은 `StatEvent[]` 만 받는 순수 함수라 DB/프레임워크 없이 테스트되고, 나중에 정적 빌드(SvelteKit 등)에서도 그대로 재사용할 수 있다.
