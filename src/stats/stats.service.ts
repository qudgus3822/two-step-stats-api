import { Injectable } from '@nestjs/common';
import { StoreService } from './store.service';
// [변경: 2026-07-29 12:10, 김병현 수정] statEvents 헬퍼의 반환 타입 표기용.
import { StatEvent } from './types';
import {
  boxScoreForGame,
  leaderboard,
  LeaderboardMetric,
  listGames,
  listPlayers,
  mergeOvertimeGames,
  playerDetail,
  summary,
} from './aggregate';
// [변경: 2026-07-27 16:14, 김병현 수정] 시너지 탭용 순수 리포트 함수 + 지표 타입 추가.
import { synergyReport, SynergyMetric } from './synergy';
// [변경: 2026-07-28 15:00, 김병현 수정] 기량 발전 탭용 순수 리포트 함수 + 지표 타입 추가.
import { growthReport, previousCompetitionId, GrowthMetric } from './growth';
// [변경: 2026-07-28 15:00, 김병현 수정] 직전 시즌을 알아내려면 대회 등록부가 필요해서 주입한다.
import { CompetitionService } from './competition.service';

// 저장소에서 이벤트를 읽어와 순수 집계 함수에 위임하는 얇은 서비스.
// [변경: 2026-07-14 17:32, 김병현 수정] 대회 모델 대개편 — season?: string → competitionId?: number.
// 옛 seasons() 메서드는 제거(컨트롤러가 CompetitionService.list 로 대체).
@Injectable()
export class StatsService {
  // [변경: 2026-07-28 15:00, 김병현 수정] 기량 발전 탭 — 직전 시즌을 알아내려면 대회 등록부가 필요해서
  // CompetitionService 를 주입한다(StatsModule 에 이미 provider 로 있어 모듈 파일은 안 건드린다).
  constructor(
    private readonly store: StoreService,
    private readonly competitionRegistry: CompetitionService,
  ) {}

  // ── 원본 뷰 vs 스탯 뷰 ──────────────────────────────────────────────
  // [신설: 2026-07-29 12:10, 김병현 작성]
  //
  // 이 서비스의 유일한 갈림길: 연장경기를 앞 경기에 합쳐서 볼 것이냐 아니냐.
  //
  //   원본 뷰 (store.getEvents)  — 경기 목록 · 박스스코어
  //     "무슨 경기가 열렸나"를 보여준다. 연장도 한 줄 차지한다(3주차 = 2경기 + 연장).
  //   스탯 뷰 (this.statEvents)  — 선수목록 · 선수상세 · 리더보드 · 요약 · 시너지 · 기량발전
  //     "몇 경기로 나눌 것이냐"를 정한다. 연장은 앞 경기의 일부다(3주차 = 2경기).
  //
  // 왜 나눴나: 연장은 '기록으로는 별개의 판'이지만 '성적으로는 앞 경기의 연장'이다.
  // 둘을 한 값으로 억지로 합치면 한쪽이 반드시 틀린다 — 목록이 경기를 숨기거나, 평균이 깨지거나.
  //
  // ⚠ 새 조회를 추가할 땐 둘 중 어느 쪽인지 반드시 정할 것. 헷갈리면 이 질문 하나로 판단한다.
  //   "경기당 평균의 분모로 쓰이나?" → 그렇다면 스탯 뷰.

  // 스탯 집계용 이벤트. 원본을 읽어 연장을 직전 경기에 흡수시켜 돌려준다.
  //
  // 매 요청 흡수를 다시 도는 게 아깝지 않은 이유: mergeOvertimeGames 는 연장 이벤트만 새로
  // 만들고 나머지는 원본 객체를 그대로 재사용한다(포인터 복사). 연장이 아예 없는 대회는
  // 배열조차 새로 안 만든다. 뒤이어 도는 집계 자체가 훨씬 무거워서 이건 오차 범위다.
  private async statEvents(competitionId?: number): Promise<StatEvent[]> {
    return mergeOvertimeGames(await this.store.getEvents({ competitionId }));
  }

  // 경기 목록 — 원본 뷰. 연장이 별도 행으로 나오고 overtime:true 로 표시된다.
  async games(competitionId?: number) {
    const events = await this.store.getEvents({ competitionId });
    return listGames(events);
  }

  // 박스스코어 — 원본 뷰. 연장 경기도 자기 박스스코어를 갖는다(따로 눌러볼 수 있게).
  async boxScore(id: string) {
    const events = await this.store.getEvents();
    return boxScoreForGame(events, id);
  }

  async players(competitionId?: number) {
    const events = await this.statEvents(competitionId);
    return listPlayers(events);
  }

  // [변경: 2026-07-27 15:00, 김병현 수정] 선수 상세도 대회 필터를 받는다.
  // 다른 조회들과 같은 규칙 — competitionId 없으면 통산(전체 대회).
  // 필터는 여기(저장소 호출)에서만 건다. 집계 함수 playerDetail 은 순수하게 둔다.
  // [변경: 2026-07-29 12:10, 김병현 수정] 스탯 뷰 — 경기별 추이에서도 연장은 앞 경기와 한 줄로 합쳐진다.
  // (경기 목록과 줄 수가 다를 수 있는데, 의도된 것이다. 여기 숫자는 전부 '경기당 평균'의 재료다.)
  async player(name: string, competitionId?: number) {
    const events = await this.statEvents(competitionId);
    return playerDetail(events, name);
  }

  // [변경: 2026-07-14 17:49, 김병현 수정] limit 선택적 — 생략 시 전체 반환.
  async leaderboard(metric: LeaderboardMetric, limit?: number, competitionId?: number) {
    const events = await this.statEvents(competitionId);
    return leaderboard(events, metric, limit);
  }

  // [변경: 2026-07-29 12:10, 김병현 수정] 스탯 뷰 — 여기 games 는 '평균의 분모'와 같은 수여야 한다.
  // 그래서 경기 목록 줄 수(연장 포함)보다 작을 수 있다.
  async summary(competitionId?: number) {
    const events = await this.statEvents(competitionId);
    return summary(events);
  }

  // [변경: 2026-07-27 16:14, 김병현 수정] 시너지 리포트 위임 추가(형제 메서드와 같은 모양).
  async synergy(player: string, metric: SynergyMetric, competitionId?: number) {
    const events = await this.statEvents(competitionId);
    return synergyReport(events, player, metric);
  }

  // [변경: 2026-07-28 15:00, 김병현 수정] 기량 발전 리포트 위임.
  // 이벤트를 통째로 읽지 않고 "이번 + 직전" 두 대회만 읽는다(전체 조회는 테이블 전부를 끌어온다).
  // 등록부에 없는 대회면 DB 를 건드리지 않고 바로 null → 컨트롤러가 404.
  // ⚠ 여기서 previousCompetitionId 를 부르는 건 "읽을 대회를 고르려는 것"이고, 진짜 '직전 시즌'
  //   판정은 growthReport 안에서 한 번 더 한다(순수 함수를 자족적으로 두려고 일부러 두 번 돈다).
  //   규칙을 바꿀 땐 growth.ts 한 곳만 고치면 양쪽이 같이 바뀐다.
  async growth(competitionId: number, metric: GrowthMetric) {
    const competitions = await this.competitionRegistry.list();
    if (!competitions.some((c) => c.id === competitionId)) return null;

    const prevId = previousCompetitionId(competitions, competitionId);
    // [변경: 2026-07-29 12:10, 김병현 수정] 스탯 뷰 — 두 시즌 모두 연장을 흡수한 뒤 비교한다.
    // 한쪽만 흡수하면 "경기 수가 줄어서 평균이 올랐다"를 기량 발전으로 오해하게 된다.
    const batches = await Promise.all([
      this.statEvents(competitionId),
      prevId == null ? Promise.resolve<StatEvent[]>([]) : this.statEvents(prevId),
    ]);
    return growthReport(batches.flat(), competitions, competitionId, metric);
  }
}
