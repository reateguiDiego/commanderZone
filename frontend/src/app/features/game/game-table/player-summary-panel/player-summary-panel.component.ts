import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { ManaSymbolsComponent } from '../../../../shared/mana/mana-symbols/mana-symbols.component';
import { ExtraActionsMenuComponent } from '../../../../shared/ui/extra-actions-menu/extra-actions-menu.component';
import { PlayerAvatarComponent } from '../../../../shared/ui/player-avatar/player-avatar.component';
import { PlayerNameComponent } from '../../../../shared/ui/player-name/player-name.component';
import { PlayerView } from '../game-table.store';

interface LifeChangeEvent {
  playerId: string;
  delta: number;
}

interface CommanderDamageChangeEvent {
  targetPlayerId: string;
  sourcePlayerId: string;
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

interface CommanderDamageRow {
  sourcePlayerId: string;
  username: string;
  commanderNames: string;
  damage: number;
}

const PLAYER_COUNTER_TRACKERS: readonly PlayerCounterTracker[] = [
  { key: 'poison', label: 'Poison', icon: 'biohazard' },
  { key: 'energy', label: 'Energy', icon: 'zap' },
  { key: 'experience', label: 'Experience', icon: 'sparkles' },
  { key: 'rad', label: 'Rad', icon: 'radiation' },
  { key: 'tickets', label: 'Tickets', icon: 'tickets' },
];

@Component({
  selector: 'app-player-summary-panel',
  imports: [ExtraActionsMenuComponent, LucideAngularModule, ManaSymbolsComponent, PlayerAvatarComponent, PlayerNameComponent],
  templateUrl: './player-summary-panel.component.html',
  styleUrl: './player-summary-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlayerSummaryPanelComponent {
  readonly playerCounterTrackers = PLAYER_COUNTER_TRACKERS;
  readonly player = input.required<PlayerView>();
  readonly players = input.required<readonly PlayerView[]>();
  readonly colorAccent = input.required<(player: PlayerView | null) => string>();
  readonly deckLabel = input.required<(player: PlayerView | null) => string>();
  readonly manaSymbols = input.required<(player: PlayerView | null) => string[]>();
  readonly playerCounterValue = input.required<(player: PlayerView, key: PlayerCounterKey) => number>();
  readonly canEditCounters = input.required<boolean>();
  readonly lifeChanged = output<LifeChangeEvent>();
  readonly commanderDamageChanged = output<CommanderDamageChangeEvent>();
  readonly playerCounterChanged = output<PlayerCounterChangeEvent>();
  readonly otherCountersExpanded = signal(false);
  readonly commanderDamageRows = computed<readonly CommanderDamageRow[]>(() => {
    const targetPlayer = this.player();

    return this.players()
      .filter((sourcePlayer) => sourcePlayer.id !== targetPlayer.id)
      .map((sourcePlayer) => ({
        sourcePlayerId: sourcePlayer.id,
        username: sourcePlayer.state.user.displayName,
        commanderNames: this.commanderNames(sourcePlayer),
        damage: Math.max(0, Number(targetPlayer.state.commanderDamage[sourcePlayer.id] ?? 0)),
      }));
  });
  readonly hasActiveOtherCounter = computed(() =>
    this.playerCounterTrackers.some((tracker) => this.counterValue(tracker.key) > 0),
  );

  changeLife(event: MouseEvent, delta: number): void {
    event.stopPropagation();
    if (delta < 0) {
      event.preventDefault();
    }

    this.lifeChanged.emit({ playerId: this.player().id, delta });
  }

  changeCommanderDamage(event: MouseEvent, sourcePlayerId: string, delta: number): void {
    this.stopCounterEvent(event);
    if (!this.canEditCounters()) {
      return;
    }

    this.commanderDamageChanged.emit({ targetPlayerId: this.player().id, sourcePlayerId, delta });
  }

  changePlayerCounter(event: MouseEvent, key: PlayerCounterKey, delta: number): void {
    this.stopCounterEvent(event);
    if (!this.canEditCounters()) {
      return;
    }

    this.playerCounterChanged.emit({ playerId: this.player().id, key, delta });
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

  counterValue(key: PlayerCounterKey): number {
    return this.playerCounterValue()(this.player(), key);
  }

  private commanderNames(player: PlayerView): string {
    const commanderCards = Object.values(player.state.zones)
      .flat()
      .filter((card) => card.isCommander === true);
    const commandZoneCards = player.state.zones.command ?? [];
    const names = this.uniqueCardNames(commanderCards.length > 0 ? commanderCards : commandZoneCards);

    return names.length > 0 ? names.join(', ') : 'Commander';
  }

  private uniqueCardNames(cards: readonly { name: string }[]): string[] {
    return [...new Set(cards.map((card) => card.name.trim()).filter(Boolean))];
  }

  private stopCounterEvent(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
  }
}
