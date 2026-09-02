import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
// 연장 병합(스탯 뷰) — 아래 rosterEvents 주석 참고.
import { gameKey, mergeOvertimeGames } from './aggregate';
import { countWinsByPlayer, playerTeamUsage } from './championship';
import { CompetitionRow, CompetitionService } from './competition.service';
// 이름 표기를 앱 전체와 똑같이 맞춘다(공백 제거). 접미사('김진우1')는 손대지 않는다.
import { normalizePlayerName } from './playerCheck';
import { StoreService } from './store.service';
import {
  ChampionshipOverview,
  ChampionshipRoster,
  ChampionshipRosterPlayer,
  ChampionshipWinView,
} from './types';

/**
 * [신설: 2026-09-02 김병현 작성]
 *
 * "누가 우승자인가"를 사람이 한 명씩 찍어 기록하는 일 담당.
 *
 * 왜 자동으로 안 정하나: 이 동호회는 같은 시즌에 상대팀으로도 한 번 뛰고, 용병으로
 * 여러 경기를 뛰고도 우승자로는 안 치는 경우가 있다. 즉 "가장 많이 뛴 팀 = 우승팀"이
 * 항상 맞지는 않는다. 그래서 이 서비스는 **판단을 대신하지 않고 판단 재료만 차려 준다**.
 *   roster()  — "이 사람 몇 경기를 어느 팀으로 뛰었나" (재료)
 *   add()     — 사람이 찍은 결과를 기록 (판단은 사람이 이미 했다)
 *
 * 밖에서 보이는 건 네 가지뿐(roster/overview/add/remove)이고, 연장 병합이니 통산 집계니
 * 하는 건 전부 안에 숨는다.
 */
@Injectable()
export class ChampionshipService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly store: StoreService,
    private readonly competitions: CompetitionService,
  ) {}

  /**
   * 우승 관리 화면이 쓰는 선수 표.
   *
   * competitionId 는 '필터'가 아니라 '지목'이다 — 없는 대회면 404
   * (/growth, /export 와 같은 결. 빈 표를 주면 사용자가 뭐가 잘못됐는지 알 길이 없다).
   */
  async roster(competitionId: number): Promise<ChampionshipRoster> {
    const competition = await this.findCompetitionOrThrow(competitionId);

    // 셋은 서로를 안 기다려도 된다. DB 가 원격(Supabase)이라 왕복 한 번이 아깝다.
    const [events, wins, careerWins] = await Promise.all([
      this.rosterEvents(competitionId),
      this.prisma.championshipWin.findMany({ where: { competitionId } }),
      this.careerWinsByPlayer(),
    ]);

    // 이 대회에서 이미 우승자로 찍힌 사람 → 저장된 팀 이름
    const wonTeamOf = new Map(wins.map((w) => [w.player, w.teamName]));
    const usage = playerTeamUsage(events);

    const players: ChampionshipRosterPlayer[] = usage.map((u) => {
      const top = u.teams[0] ?? null; // 정렬돼 있어 [0] 이 곧 '가장 많이 뛴 팀'
      const wonTeamName = wonTeamOf.get(u.player) ?? null;
      return {
        player: u.player,
        topTeam: top?.team ?? null,
        topTeamGames: top?.games ?? 0,
        totalGames: u.totalGames,
        careerWins: careerWins.get(u.player) ?? 0,
        won: wonTeamOf.has(u.player),
        wonTeamName,
      };
    });

    return {
      competitionId,
      competitionLabel: competition.label,
      // 표의 '몇 경기 중'과 같은 뷰(연장 병합본)에서 센다 — 분모가 두 벌이 되지 않도록.
      gameCount: new Set(events.map(gameKey)).size,
      players,
    };
  }

  /**
   * 우승 기록 전부 + 거기서 센 통산 횟수.
   *
   * 두 값을 한 번에 주는 이유: 화면이 표 두 개를 같이 그리는데 따로 부르면 그 사이에
   * [+] 가 눌려 "줄은 늘었는데 횟수는 그대로"인 어긋난 화면이 나온다.
   */
  async overview(): Promise<ChampionshipOverview> {
    const rows = await this.prisma.championshipWin.findMany({
      include: { competition: true },
      orderBy: [
        { competition: { year: 'desc' } },
        { competition: { seasonNo: { sort: 'desc', nulls: 'last' } } },
        { player: 'asc' },
      ],
    });

    const wins: ChampionshipWinView[] = rows.map((r) => ({
      id: r.id,
      competitionId: r.competitionId,
      competitionLabel: r.competition.label,
      year: r.competition.year,
      seasonNo: r.competition.seasonNo,
      competitionName: r.competition.name,
      player: r.player,
      teamName: r.teamName,
    }));

    return {
      wins,
      // 통산 횟수는 저장하지 않고 매번 센다 — 저장하면 두 값이 어긋날 여지가 생긴다.
      // 우승 줄은 많아야 수백 개라 세는 비용이 사실상 없다.
      playerWins: countWinsByPlayer(
        wins.map((w) => ({ player: w.player, title: w.competitionLabel })),
      ),
    };
  }

  /**
   * 우승자로 찍기(+). 같은 대회 같은 선수면 몇 번을 눌러도 결과가 같다(멱등).
   *
   * ⚠ 팀 이름은 **여기서 다시 계산한다**. 화면이 보낸 값을 그대로 믿지 않는다 —
   *   화면이 낡은 채로 오래 열려 있었으면 엉뚱한 팀이 영구히 박힌다.
   *   "믿을 수 있는 계산은 데이터를 쥔 쪽에서 한다"가 이 함수의 핵심이다.
   */
  async add(competitionId: number, rawPlayer: string): Promise<ChampionshipWinView> {
    const competition = await this.findCompetitionOrThrow(competitionId);
    const player = normalizePlayerName(rawPlayer);
    if (!player) throw new BadRequestException('선수 이름(player)을 입력하세요.');

    const events = await this.rosterEvents(competitionId);
    const usage = playerTeamUsage(events).find((u) => u.player === player);
    // 그 대회에서 한 경기도 안 뛴 사람은 우승자가 될 수 없다. 오타를 여기서 잡는다
    // (안 막으면 화면 표에 없는 유령 이름이 통산 순위에만 나타난다).
    if (!usage || usage.teams.length === 0) {
      throw new BadRequestException(
        `'${player}' 은(는) ${competition.label} 에서 뛴 기록이 없어요. 이름을 확인해 주세요.`,
      );
    }
    const teamName = usage.teams[0].team; // 가장 많이 뛴 팀

    const saved = await this.prisma.championshipWin.upsert({
      where: { competitionId_player: { competitionId, player } },
      // 이미 있으면 팀 이름을 덮어쓰지 않는다. 확정된 우승의 팀 이름은 그때의 사실이라,
      // 나중에 경기 기록이 고쳐졌다고 조용히 바뀌면 안 된다(schema.prisma 주석과 같은 이유).
      update: {},
      create: { competitionId, player, teamName },
    });

    return {
      id: saved.id,
      competitionId,
      competitionLabel: competition.label,
      year: competition.year,
      seasonNo: competition.seasonNo,
      competitionName: competition.name,
      player: saved.player,
      teamName: saved.teamName,
    };
  }

  /**
   * 우승 취소. 없는 걸 지워도 에러가 아니다(멱등) — 지워진 줄 수만 돌려준다.
   * id 가 아니라 (대회, 선수)로 지우는 이유: 화면의 [취소] 버튼이 이미 그 둘을 알고 있어서,
   * id 를 따로 들고 다니게 하면 화면에 쓸데없는 장부가 하나 더 생긴다.
   */
  async remove(competitionId: number, rawPlayer: string): Promise<number> {
    const player = normalizePlayerName(rawPlayer);
    if (!player) throw new BadRequestException('선수 이름(player)을 입력하세요.');
    const { count } = await this.prisma.championshipWin.deleteMany({
      where: { competitionId, player },
    });
    return count;
  }

  // ── 안쪽 도우미 ────────────────────────────────────────────────────────

  // 선수 표용 이벤트 = **스탯 뷰**(연장을 앞 경기에 흡수한 뷰).
  //
  // 왜 스탯 뷰인가: 이 화면의 숫자는 '몇 경기 중 몇 경기'라는 비율이다. 원본 뷰를 쓰면
  // 연장이 별개 경기로 세어져 "10경기 중 9경기"처럼 사람 감각과 어긋난다.
  // (stats.service.ts 의 '원본 뷰 vs 스탯 뷰' 주석에 있는 판단 기준: "경기당 평균의 분모로
  //  쓰이나?" → 여기 분모가 정확히 그거다.)
  private async rosterEvents(competitionId: number) {
    return mergeOvertimeGames(await this.store.getEvents({ competitionId }));
  }

  // 선수 → 통산 우승횟수. groupBy 로 DB 가 세게 한다(줄을 다 끌어오지 않으려고).
  private async careerWinsByPlayer(): Promise<Map<string, number>> {
    const grouped = await this.prisma.championshipWin.groupBy({
      by: ['player'],
      _count: { _all: true },
    });
    return new Map(grouped.map((g) => [g.player, g._count._all]));
  }

  // 대회 등록부에서 찾는다. 없으면 404.
  private async findCompetitionOrThrow(competitionId: number): Promise<CompetitionRow> {
    const found = (await this.competitions.list()).find((c) => c.id === competitionId);
    if (!found) throw new NotFoundException(`대회를 찾을 수 없습니다: ${competitionId}`);
    return found;
  }
}
