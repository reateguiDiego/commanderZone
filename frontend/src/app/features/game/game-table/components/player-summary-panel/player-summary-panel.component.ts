import { RuntimeTranslatePipe } from '../../../../../core/localization/runtime-translate.pipe';
import { ChangeDetectionStrategy, Component, OnDestroy, WritableSignal, computed, input, output, signal } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { GameSpecialEntity } from '../../../../../core/models/game.model';
import { ManaSymbolsComponent } from '../../../../../shared/mana/mana-symbols/mana-symbols.component';
import { ExtraActionsMenuComponent } from '../../../../../shared/ui/extra-actions-menu/extra-actions-menu.component';
import { PlayerAvatarComponent } from '../../../../../shared/ui/player-avatar/player-avatar.component';
import { PlayerNameComponent } from '../../../../../shared/ui/player-name/player-name.component';
import { PlayerView } from '../../game-table.store';
import { GAME_TABLE_VALUE_COMMAND_DEBOUNCE_MS } from '../../services/game-table-debounced-value-commands.service';
import { clampPlayerLife } from '../../utils/player-life-bounds';
import { SpecialEntityStripComponent } from '../special-entity-strip/special-entity-strip.component';

interface LifeChangeEvent {
  playerId: string;
  delta: number;
}

interface CommanderDamageChangeEvent {
  targetPlayerId: string;
  sourcePlayerId: string;
  commanderInstanceId: string;
  delta: number;
}

interface PlayerCounterChangeEvent {
  playerId: string;
  key: PlayerCounterKey;
  delta: number;
}

type PlayerCounterKey = 'poison' | 'energy' | 'experience' | 'rad' | 'tickets';
type PlayerCounterIconName = 'biohazard' | 'zap' | 'sparkles' | 'radiation' | 'tickets';

interface PlayerCounterTracker {
  key: PlayerCounterKey;
  label: string;
  icon: PlayerCounterIconName;
}

interface CommanderDamageCommanderRow {
  commanderInstanceId: string;
  name: string;
  damage: number;
}

interface CommanderDamageRow {
  sourcePlayerId: string;
  username: string;
  commanders: readonly CommanderDamageCommanderRow[];
}

interface LifeFeedback {
  id: number;
  delta: number;
  phase: 'active' | 'exiting';
  tone: 'damage' | 'gain' | 'neutral';
}

export const PLAYER_SUMMARY_ACTION_DEBOUNCE_MS = GAME_TABLE_VALUE_COMMAND_DEBOUNCE_MS;
export const PLAYER_SUMMARY_LIFE_FEEDBACK_EXIT_MS = 1180;
const CONTEXT_PANEL_LONG_NAME_THRESHOLD = 18;

const PLAYER_COUNTER_TRACKERS: readonly PlayerCounterTracker[] = [
  { key: 'poison', label: 'game.playerCounters.poison', icon: 'biohazard' },
  { key: 'energy', label: 'game.playerCounters.energy', icon: 'zap' },
  { key: 'experience', label: 'game.playerCounters.experience', icon: 'sparkles' },
  { key: 'rad', label: 'game.playerCounters.rad', icon: 'radiation' },
  { key: 'tickets', label: 'game.playerCounters.tickets', icon: 'tickets' },
];

@Component({
  selector: 'app-player-summary-panel',
  imports: [RuntimeTranslatePipe, ExtraActionsMenuComponent, LucideAngularModule, ManaSymbolsComponent, PlayerAvatarComponent, PlayerNameComponent, SpecialEntityStripComponent],
  templateUrl: './player-summary-panel.component.html',
  styleUrl: './player-summary-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlayerSummaryPanelComponent implements OnDestroy {
  private readonly pendingLifeDeltas = signal<Record<string, number>>({});
  private readonly pendingCommanderDamageDeltas = signal<Record<string, number>>({});
  private readonly pendingPlayerCounterDeltas = signal<Record<string, number>>({});
  private readonly flushTimers = new Map<string, number>();
  private lifeFeedbackClearTimer: number | null = null;
  private lifeFeedbackTimer: number | null = null;
  private nextFeedbackId = 0;

  readonly playerCounterTrackers = PLAYER_COUNTER_TRACKERS;
  readonly player = input.required<PlayerView>();
  readonly players = input.required<readonly PlayerView[]>();
  readonly colorAccent = input.required<(player: PlayerView | null) => string>();
  readonly deckLabel = input.required<(player: PlayerView | null) => string>();
  readonly manaSymbols = input.required<(player: PlayerView | null) => string[]>();
  readonly playerCounterValue = input.required<(player: PlayerView, key: PlayerCounterKey) => number>();
  readonly canEditCounters = input.required<boolean>();
  readonly specialEntities = input<readonly GameSpecialEntity[]>([]);
  readonly contextLabel = input<string | null>(null);
  readonly returnActionLabel = input<string | null>(null);
  readonly lifeChanged = output<LifeChangeEvent>();
  readonly commanderDamageChanged = output<CommanderDamageChangeEvent>();
  readonly playerCounterChanged = output<PlayerCounterChangeEvent>();
  readonly helperPreviewRequested = output<GameSpecialEntity>();
  readonly helperPreviewHidden = output<void>();
  readonly helperContextRequested = output<{ event: MouseEvent; entity: GameSpecialEntity }>();
  readonly returnRequested = output<void>();
  readonly lifeFeedback = signal<LifeFeedback | null>(null);
  readonly otherCountersExpanded = signal(false);
  readonly visibleSpecialEntities = computed(() =>
    this.specialEntities().filter((entity) => entity.template !== 'the_ring'),
  );
  readonly hasLongDisplayName = computed(
    () => this.player().state.user.displayName.trim().length > CONTEXT_PANEL_LONG_NAME_THRESHOLD,
  );
  readonly commanderDamageRows = computed<readonly CommanderDamageRow[]>(() => {
    const targetPlayer = this.player();

    return this.players()
      .filter((sourcePlayer) => sourcePlayer.id !== targetPlayer.id)
      .map((sourcePlayer) => ({
        sourcePlayerId: sourcePlayer.id,
        username: sourcePlayer.state.user.displayName,
        commanders: this.commanderCards(sourcePlayer).map((commander) => ({
          commanderInstanceId: commander.instanceId,
          name: commander.name.trim() || 'Commander',
          damage: this.commanderDamageValue(targetPlayer, commander.instanceId),
        })),
      }))
      .filter((row) => row.commanders.length > 0);
  });
  readonly hasActiveOtherCounter = computed(() =>
    this.playerCounterTrackers.some((tracker) => this.counterValue(tracker.key) > 0),
  );

  readonly displayedLife = computed(() => {
    const currentPlayer = this.player();
    return clampPlayerLife(currentPlayer.state.life + this.pendingLifeDelta(currentPlayer.id));
  });

  ngOnDestroy(): void {
    for (const timer of this.flushTimers.values()) {
      window.clearTimeout(timer);
    }
    if (this.lifeFeedbackTimer !== null) {
      window.clearTimeout(this.lifeFeedbackTimer);
    }
    if (this.lifeFeedbackClearTimer !== null) {
      window.clearTimeout(this.lifeFeedbackClearTimer);
    }
    this.flushTimers.clear();
    this.lifeFeedbackClearTimer = null;
    this.lifeFeedbackTimer = null;
  }

  changeLife(event: MouseEvent, delta: number): void {
    event.stopPropagation();
    if (delta < 0) {
      event.preventDefault();
    }
    if (!this.canEditCounters()) {
      return;
    }

    const currentPlayer = this.player();
    const playerId = currentPlayer.id;
    const currentLife = this.displayedLife();
    const nextLife = clampPlayerLife(currentLife + delta);
    const appliedDelta = nextLife - currentLife;
    if (appliedDelta === 0) {
      return;
    }

    const pendingDelta = this.updatePendingDelta(this.pendingLifeDeltas, playerId, appliedDelta);
    this.updateLifeFeedback(pendingDelta);
    this.scheduleOrCancelFlush(`life:${playerId}`, pendingDelta, () => this.flushLifeChange(playerId));
  }

  changeCommanderDamage(event: MouseEvent, sourcePlayerId: string, commanderInstanceId: string, delta: number): void {
    this.stopCounterEvent(event);
    if (!this.canEditCounters()) {
      return;
    }

    const targetPlayer = this.player();
    const currentDamage = this.commanderDamageValue(targetPlayer, commanderInstanceId);
    const nextDamage = Math.max(0, currentDamage + delta);
    if (nextDamage === currentDamage) {
      return;
    }

    const key = this.commanderDamageKey(targetPlayer.id, commanderInstanceId);
    const pendingDelta = this.updatePendingDelta(this.pendingCommanderDamageDeltas, key, nextDamage - currentDamage);
    this.scheduleOrCancelFlush(`commander-damage:${key}`, pendingDelta, () =>
      this.flushCommanderDamageChange(targetPlayer.id, sourcePlayerId, commanderInstanceId),
    );
  }

  changePlayerCounter(event: MouseEvent, key: PlayerCounterKey, delta: number): void {
    this.stopCounterEvent(event);
    if (!this.canEditCounters()) {
      return;
    }

    const currentPlayer = this.player();
    const currentValue = this.counterValue(key);
    const nextValue = Math.max(0, currentValue + delta);
    if (nextValue === currentValue) {
      return;
    }

    const pendingKey = this.playerCounterKey(currentPlayer.id, key);
    const pendingDelta = this.updatePendingDelta(this.pendingPlayerCounterDeltas, pendingKey, nextValue - currentValue);
    this.scheduleOrCancelFlush(`player-counter:${pendingKey}`, pendingDelta, () =>
      this.flushPlayerCounterChange(currentPlayer.id, key),
    );
  }

  syncOtherCountersExpansion(open: boolean): void {
    if (!open) {
      return;
    }

    this.otherCountersExpanded.set(this.hasActiveOtherCounter());
  }

  toggleOtherCounters(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.otherCountersExpanded.update((expanded) => !expanded);
  }

  requestReturn(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.returnRequested.emit();
  }

  counterValue(key: PlayerCounterKey): number {
    const currentPlayer = this.player();
    return Math.max(0, this.playerCounterValue()(currentPlayer, key) + this.pendingPlayerCounterDelta(currentPlayer.id, key));
  }

  private flushLifeChange(playerId: string): void {
    const delta = this.pendingLifeDelta(playerId);
    if (delta === 0) {
      return;
    }

    this.lifeChanged.emit({ playerId, delta });
    this.clearPendingDelta(this.pendingLifeDeltas, playerId);
  }

  private flushCommanderDamageChange(targetPlayerId: string, sourcePlayerId: string, commanderInstanceId: string): void {
    const key = this.commanderDamageKey(targetPlayerId, commanderInstanceId);
    const delta = this.pendingCommanderDamageDeltas()[key] ?? 0;
    if (delta === 0) {
      return;
    }

    this.commanderDamageChanged.emit({ targetPlayerId, sourcePlayerId, commanderInstanceId, delta });
    this.clearPendingDelta(this.pendingCommanderDamageDeltas, key);
  }

  private flushPlayerCounterChange(playerId: string, key: PlayerCounterKey): void {
    const pendingKey = this.playerCounterKey(playerId, key);
    const delta = this.pendingPlayerCounterDeltas()[pendingKey] ?? 0;
    if (delta === 0) {
      return;
    }

    this.playerCounterChanged.emit({ playerId, key, delta });
    this.clearPendingDelta(this.pendingPlayerCounterDeltas, pendingKey);
  }

  private updatePendingDelta(pendingDeltas: WritableSignal<Record<string, number>>, key: string, delta: number): number {
    let nextDelta = 0;
    pendingDeltas.update((current) => {
      nextDelta = (current[key] ?? 0) + delta;
      if (nextDelta === 0) {
        const { [key]: _removed, ...rest } = current;
        return rest;
      }

      return { ...current, [key]: nextDelta };
    });

    return nextDelta;
  }

  private clearPendingDelta(pendingDeltas: WritableSignal<Record<string, number>>, key: string): void {
    pendingDeltas.update((current) => {
      if (current[key] === undefined) {
        return current;
      }

      const { [key]: _removed, ...rest } = current;
      return rest;
    });
  }

  private updateLifeFeedback(delta: number): void {
    if (this.lifeFeedbackTimer !== null) {
      window.clearTimeout(this.lifeFeedbackTimer);
      this.lifeFeedbackTimer = null;
    }
    if (this.lifeFeedbackClearTimer !== null) {
      window.clearTimeout(this.lifeFeedbackClearTimer);
      this.lifeFeedbackClearTimer = null;
    }

    this.lifeFeedback.set({
      id: this.nextFeedbackId,
      delta,
      phase: 'active',
      tone: delta < 0 ? 'damage' : delta > 0 ? 'gain' : 'neutral',
    });
    this.nextFeedbackId += 1;

    this.lifeFeedbackTimer = window.setTimeout(() => {
      this.lifeFeedbackTimer = null;
      this.releaseLifeFeedback();
    }, PLAYER_SUMMARY_ACTION_DEBOUNCE_MS);
  }

  private releaseLifeFeedback(): void {
    const currentFeedback = this.lifeFeedback();
    if (!currentFeedback) {
      return;
    }

    this.lifeFeedback.set({ ...currentFeedback, phase: 'exiting' });
    this.lifeFeedbackClearTimer = window.setTimeout(() => {
      this.lifeFeedback.set(null);
      this.lifeFeedbackClearTimer = null;
    }, PLAYER_SUMMARY_LIFE_FEEDBACK_EXIT_MS);
  }

  private scheduleOrCancelFlush(timerKey: string, pendingDelta: number, flush: () => void): void {
    const existingTimer = this.flushTimers.get(timerKey);
    if (existingTimer !== undefined) {
      window.clearTimeout(existingTimer);
      this.flushTimers.delete(timerKey);
    }

    if (pendingDelta === 0) {
      return;
    }

    const timer = window.setTimeout(() => {
      this.flushTimers.delete(timerKey);
      flush();
    }, PLAYER_SUMMARY_ACTION_DEBOUNCE_MS);
    this.flushTimers.set(timerKey, timer);
  }

  private pendingLifeDelta(playerId: string): number {
    return this.pendingLifeDeltas()[playerId] ?? 0;
  }

  private commanderDamageValue(targetPlayer: PlayerView, commanderInstanceId: string): number {
    const baseDamage = Math.max(0, Number(targetPlayer.state.commanderDamage[commanderInstanceId] ?? 0));
    const pendingDelta = this.pendingCommanderDamageDeltas()[this.commanderDamageKey(targetPlayer.id, commanderInstanceId)] ?? 0;
    return Math.max(0, baseDamage + pendingDelta);
  }

  private pendingPlayerCounterDelta(playerId: string, key: PlayerCounterKey): number {
    return this.pendingPlayerCounterDeltas()[this.playerCounterKey(playerId, key)] ?? 0;
  }

  private commanderDamageKey(targetPlayerId: string, commanderInstanceId: string): string {
    return `${targetPlayerId}:${commanderInstanceId}`;
  }

  private playerCounterKey(playerId: string, key: PlayerCounterKey): string {
    return `${playerId}:${key}`;
  }

  private commanderCards(player: PlayerView): readonly { instanceId: string; name: string }[] {
    const commanderCards = Object.values(player.state.zones)
      .flat()
      .filter((card) => card.isCommander === true);
    const commandZoneCards = player.state.zones.command ?? [];
    const cards = commanderCards.length > 0 ? commanderCards : commandZoneCards;
    const seen = new Set<string>();

    return cards.filter((card) => {
      if (seen.has(card.instanceId)) {
        return false;
      }

      seen.add(card.instanceId);
      return true;
    });
  }

  private stopCounterEvent(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
  }
}
