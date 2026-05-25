import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { GamesApi } from '../../../core/api/games.api';
import {
  GameDebugActionExchange,
  GameDebugConnectionState,
  GameDebugHealthResponse,
  GameDebugPlayerContext,
  GameDebugTrafficBucket,
} from '../../../core/models/api-responses.model';
import type { GameDebugDeadLetterEvent, GameDebugSnapshotMetric } from './game-debug-snapshot-metrics.channel';
import { GameDebugSnapshotMetricsService } from './game-debug-snapshot-metrics.service';
import { GameDebugWebsocketService } from './game-debug-websocket.service';

type GameDebugActionSortColumn = 'action' | 'player' | 'incoming' | 'outgoing' | 'operations' | 'snapshotGrowth' | 'duration' | 'at';
type GameDebugActionSortDirection = 'asc' | 'desc';

interface GameDebugActionSort {
  column: GameDebugActionSortColumn;
  direction: GameDebugActionSortDirection;
}

@Component({
  selector: 'app-game-debug-page',
  templateUrl: './game-debug-page.component.html',
  styleUrl: './game-debug-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [GameDebugSnapshotMetricsService, GameDebugWebsocketService],
})
export class GameDebugPageComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly gamesApi = inject(GamesApi);
  private readonly snapshotMetrics = inject(GameDebugSnapshotMetricsService);
  readonly debugWebsocket = inject(GameDebugWebsocketService);

  readonly gameId = this.route.snapshot.paramMap.get('id') ?? '';
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly report = signal<GameDebugHealthResponse | null>(null);
  readonly actionSort = signal<GameDebugActionSort>({ column: 'at', direction: 'desc' });
  readonly actions = computed(() => {
    const sort = this.actionSort();

    return [...(this.report()?.health.actions.recent ?? [])].sort((left, right) => this.compareActions(left, right, sort));
  });
  readonly errors = computed(() => [...(this.report()?.health.errors.recent ?? [])].reverse());
  readonly reportJson = computed(() => {
    const report = this.report();

    return report ? JSON.stringify(report, null, 2) : '';
  });
  readonly queueMetrics = computed(() => {
    const queue = this.snapshotMetrics.queueMetrics();
    if (!queue) {
      return null;
    }

    return {
      ...queue,
      rejectedTotal: queue.rejectedTotal ?? 0,
      circuitBlockedTotal: queue.circuitBlockedTotal ?? 0,
      queueFullTotal: queue.queueFullTotal ?? 0,
    };
  });
  readonly deadLetterEvents = computed(() => [...this.snapshotMetrics.deadLetterEvents()].reverse());

  ngOnInit(): void {
    this.snapshotMetrics.observe(this.gameId);
    void this.openDebug();
  }

  ngOnDestroy(): void {
    this.snapshotMetrics.stop();
    this.debugWebsocket.disconnect();
  }

  async openDebug(): Promise<void> {
    if (!this.gameId || this.loading()) {
      return;
    }

    this.loading.set(true);
    this.error.set(null);
    try {
      this.report.set(await firstValueFrom(this.gamesApi.debugHealth(this.gameId)));
      await this.debugWebsocket.connect(
        this.gameId,
        (debugReport) => this.report.update((currentReport) => ({
          ...debugReport,
          context: currentReport?.context ?? { players: [] },
        })),
        (message) => this.error.set(message),
      );
    } catch (error) {
      this.error.set(this.errorMessage(error));
    } finally {
      this.loading.set(false);
    }
  }

  playerLabel(playerId: string | null | undefined): string {
    if (!playerId) {
      return 'System';
    }

    return this.report()?.context.players.find((player) => player.playerId === playerId)?.displayName ?? playerId;
  }

  playerDeck(player: GameDebugPlayerContext): string {
    return player.deckName && player.deckName.trim() !== '' ? player.deckName : 'Deck sin nombre';
  }

  playerConnection(player: GameDebugPlayerContext): GameDebugConnectionState | null {
    return this.report()?.health.websocket.connections.byUser[player.playerId] ?? null;
  }

  playerStatus(player: GameDebugPlayerContext): string {
    return this.playerConnection(player)?.status ?? player.status;
  }

  playerConnections(player: GameDebugPlayerContext): number {
    return this.playerConnection(player)?.connections ?? 0;
  }

  playerDisconnects(player: GameDebugPlayerContext): number {
    return this.playerConnection(player)?.disconnects ?? 0;
  }

  playerLastDisconnectedAt(player: GameDebugPlayerContext): string | null {
    return this.playerConnection(player)?.lastDisconnectedAt ?? null;
  }

  operationTypes(action: GameDebugActionExchange): string {
    return action.outgoing?.operationTypes?.join(', ') || 'sin operaciones';
  }

  sortActionsBy(column: GameDebugActionSortColumn): void {
    this.actionSort.update((current) => ({
      column,
      direction: current.column === column && current.direction === 'asc' ? 'desc' : 'asc',
    }));
  }

  actionSortLabel(column: GameDebugActionSortColumn): string {
    const sort = this.actionSort();
    if (sort.column !== column) {
      return '';
    }

    return sort.direction === 'asc' ? 'asc' : 'desc';
  }

  actionAriaSort(column: GameDebugActionSortColumn): 'ascending' | 'descending' | 'none' {
    const sort = this.actionSort();
    if (sort.column !== column) {
      return 'none';
    }

    return sort.direction === 'asc' ? 'ascending' : 'descending';
  }

  recordEntries(record: Record<string, number> | undefined): { key: string; value: number }[] {
    return Object.entries(record ?? {})
      .map(([key, value]) => ({ key, value }))
      .sort((left, right) => right.value - left.value || left.key.localeCompare(right.key));
  }

  formatMs(value: number | null | undefined): string {
    return `${Number(value ?? 0).toFixed(2)} ms`;
  }

  averageJsonCharacters(bucket: GameDebugTrafficBucket | null | undefined): string {
    const messages = Math.max(0, bucket?.messages ?? 0);
    if (messages === 0) {
      return '0.00';
    }

    return ((bucket?.characters ?? 0) / messages).toFixed(2);
  }

  snapshotGrowthLabel(action: GameDebugActionExchange): string {
    const metric = this.snapshotMetric(action);
    if (!metric) {
      return 'sin dato local';
    }

    const sign = metric.lineDelta > 0 ? '+' : '';

    return `${sign}${metric.lineDelta} lineas`;
  }

  snapshotGrowthTitle(action: GameDebugActionExchange): string {
    const metric = this.snapshotMetric(action);
    if (!metric) {
      return 'La pestaña de partida local no ha reportado esta accion.';
    }

    const characterSign = metric.characterDelta > 0 ? '+' : '';

    return `${metric.previousLines} -> ${metric.nextLines} lineas, ${characterSign}${metric.characterDelta} caracteres JSON locales`;
  }

  private errorMessage(error: unknown): string {
    if (typeof error === 'object' && error !== null && 'error' in error) {
      const response = (error as { error?: { error?: string; detail?: string } }).error;
      return response?.error ?? response?.detail ?? 'No se pudo cargar el debug.';
    }

    return 'No se pudo cargar el debug.';
  }

  private compareActions(left: GameDebugActionExchange, right: GameDebugActionExchange, sort: GameDebugActionSort): number {
    const direction = sort.direction === 'asc' ? 1 : -1;
    const compared = this.compareActionColumn(left, right, sort.column);

    return compared === 0
      ? this.compareText(left.at, right.at) * -1
      : compared * direction;
  }

  private compareActionColumn(left: GameDebugActionExchange, right: GameDebugActionExchange, column: GameDebugActionSortColumn): number {
    switch (column) {
      case 'action':
        return this.compareText(left.action, right.action);
      case 'player':
        return this.compareText(this.playerLabel(left.userId), this.playerLabel(right.userId));
      case 'incoming':
        return this.compareNumber(left.incoming?.characters ?? 0, right.incoming?.characters ?? 0);
      case 'outgoing':
        return this.compareNumber(left.outgoing?.characters ?? 0, right.outgoing?.characters ?? 0)
          || this.compareNumber(left.outgoing?.messages ?? 0, right.outgoing?.messages ?? 0);
      case 'operations':
        return this.compareText(this.operationTypes(left), this.operationTypes(right));
      case 'snapshotGrowth':
        return this.compareNumber(this.snapshotMetric(left)?.lineDelta ?? 0, this.snapshotMetric(right)?.lineDelta ?? 0);
      case 'duration':
        return this.compareNumber(left.durationMs ?? 0, right.durationMs ?? 0);
      case 'at':
        return this.compareText(left.at, right.at);
    }
  }

  private snapshotMetric(action: GameDebugActionExchange): GameDebugSnapshotMetric | null {
    return this.snapshotMetrics.metricFor(action.clientActionId);
  }

  deadLetterTitle(entry: GameDebugDeadLetterEvent): string {
    const details = entry.details?.trim();
    return details && details !== '' ? details : 'Sin detalle adicional.';
  }

  private compareText(left: string | null | undefined, right: string | null | undefined): number {
    return String(left ?? '').localeCompare(String(right ?? ''));
  }

  private compareNumber(left: number, right: number): number {
    return left - right;
  }
}
