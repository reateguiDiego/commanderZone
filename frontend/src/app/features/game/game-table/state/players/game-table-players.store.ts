import { computed, inject, Injectable } from '@angular/core';
import { AuthStore } from '../../../../../core/auth/auth.store';
import { GameCardInstance, GameZoneName } from '../../../../../core/models/game.model';
import { GameTableDebouncedValueCommandsService } from '../../services/game-table-debounced-value-commands.service';
import { GameTableInteractionActionsService, GameTableInteractionContext } from '../../services/game-table-interaction-actions.service';
import { GameTableCoreState } from '../core/game-table-core.state';
import { GameTableSnapshotSelectors, PlayerView } from '../core/game-table-snapshot-selectors';
import { GameTableUiState } from '../core/game-table-ui.state';

@Injectable()
export class GameTablePlayersStore {
  private readonly auth = inject(AuthStore);
  private readonly core = inject(GameTableCoreState);
  private readonly debouncedValueCommands = inject(GameTableDebouncedValueCommandsService);
  private readonly interactionActions = inject(GameTableInteractionActionsService);
  private readonly selectors = inject(GameTableSnapshotSelectors);
  private readonly uiState = inject(GameTableUiState);

  readonly focusedPlayerId = this.uiState.focusedPlayerId;
  readonly players = computed<PlayerView[]>(() => this.selectors.players(this.core.snapshot()));
  readonly focusedPlayer = computed<PlayerView | null>(() =>
    this.selectors.focusedPlayer(this.core.snapshot(), this.players(), this.focusedPlayerId()),
  );
  readonly currentPlayer = computed<PlayerView | null>(() => {
    if (!this.core.viewerCanControlTable()) {
      return null;
    }

    return this.selectors.currentPlayer(this.players(), this.auth.user()?.id);
  });
  readonly handPlayer = computed<PlayerView | null>(() => this.focusedPlayer());
  readonly isGameOwner = computed(() => this.selectors.isGameOwner(this.core.snapshot(), this.currentPlayer()));
  focusPlayer(playerId: string): boolean {
    const resolvedPlayerId = this.resolvePlayerId(playerId);
    if (!resolvedPlayerId) {
      this.core.error.set('Could not open that battlefield.');
      this.uiState.closeContextMenu();

      return false;
    }

    this.focusedPlayerId.set(resolvedPlayerId);
    this.uiState.closeContextMenu();

    return true;
  }

  focusCurrentPlayer(): void {
    const player = this.currentPlayer();
    if (player) {
      this.focusPlayer(player.id);
    }
  }

  isCurrentPlayer(playerId: string, context: GameTableInteractionContext): boolean {
    return this.interactionActions.isCurrentPlayer(context, playerId);
  }

  canControlPlayer(playerId: string, context: GameTableInteractionContext): boolean {
    return this.interactionActions.canControlPlayer(context, playerId);
  }

  canControlOwnedCard(playerId: string, card: GameCardInstance, context: GameTableInteractionContext): boolean {
    return this.interactionActions.canControlOwnedCard(context, playerId, card);
  }

  playerDisplayName(playerId: string): string {
    return this.playerName(playerId);
  }

  zoneCount(player: PlayerView, zone: GameZoneName): number {
    return this.selectors.zoneCount(player, zone);
  }

  zoneCardCountById(playerId: string, zone: GameZoneName): number {
    const player = this.players().find((candidate) => candidate.id === playerId);

    return player ? this.zoneCount(player, zone) : 0;
  }

  zoneCardInstanceIds(playerId: string, zone: GameZoneName): string[] {
    return this.core.snapshot()?.players[playerId]?.zones[zone]?.map((card) => card.instanceId) ?? [];
  }

  commandZoneCards(player: PlayerView): readonly GameCardInstance[] {
    return this.selectors.commandZoneCards(player);
  }

  commanderCastCount(player: PlayerView, commander?: GameCardInstance | null): number {
    const resolvedCommander = commander ?? this.selectors.primaryCommander(player);
    if (!resolvedCommander) {
      return 0;
    }

    return this.debouncedValueCommands.counterValue(
      `commander:${resolvedCommander.instanceId}`,
      'casts',
      this.selectors.commanderCastCount(this.core.snapshot(), player, resolvedCommander),
    );
  }

  colorIdentity(player: PlayerView | null): string[] {
    return this.selectors.colorIdentity(player);
  }

  colorAccent(player: PlayerView | null): string {
    return this.selectors.colorAccent(player);
  }

  manaSymbols(player: PlayerView | null): string[] {
    return this.selectors.manaSymbols(player);
  }

  deckLabel(player: PlayerView | null): string {
    return this.selectors.deckLabel(player);
  }

  gameBackgroundImage(player: PlayerView | null): string {
    return this.selectors.gameBackgroundImage(player);
  }

  playerName(playerId: string): string {
    return this.core.snapshot()?.players[playerId]?.user.displayName ?? playerId;
  }

  resolvePlayerId(playerId: string): string | null {
    const snapshot = this.core.snapshot();
    if (!snapshot) {
      return null;
    }

    if (snapshot.players[playerId]) {
      return playerId;
    }

    return Object.entries(snapshot.players).find(([, player]) => player.user.id === playerId)?.[0] ?? null;
  }
}
