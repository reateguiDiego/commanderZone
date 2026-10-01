import type { GameCardInstance, GameSpecialEntity } from '../../../../core/models/game.model';
import type { PlayerView } from '../game-table.store';
import type { GridPlayerSummaryBindings, GridSeat } from './game-table-grid-seat.model';

export const GRID_RENDER_MEMO_STORAGE_KEY = 'cz_perf_grid_render_memo';

const EMPTY_SPECIAL_ENTITIES: readonly GameSpecialEntity[] = [];

/**
 * Keeps OnPush Grid inputs stable for seats whose PlayerView did not change.
 * The caller still owns the ordered seat list and can use the returned list
 * exactly like the freshly derived one.
 */
export function reuseGridSeatReferences(
  previousSeats: readonly GridSeat[],
  nextSeats: readonly GridSeat[],
): readonly GridSeat[] {
  const previousByPlayerId = new Map(previousSeats.map((seat) => [seat.player.id, seat]));
  const resolvedSeats = nextSeats.map((seat) => {
    const previous = previousByPlayerId.get(seat.player.id);

    return previous?.seat === seat.seat && previous.player === seat.player ? previous : seat;
  });

  return sameArrayReferences(resolvedSeats, previousSeats) ? previousSeats : resolvedSeats;
}

/**
 * Presents a stable PlayerView collection to the summary panels while card
 * positions move. A summary still receives a new view for every state change
 * it can render: life, counters, command zone, player identity, commander
 * damage, or any non-position card field.
 */
export class GridPlayerSummaryBindingsMemo {
  private readonly summaryPlayersById = new Map<string, PlayerView>();
  private readonly specialEntitiesByPlayerId = new Map<string, readonly GameSpecialEntity[]>();
  private summaryPlayers: readonly PlayerView[] = [];
  private sourceBindings: GridPlayerSummaryBindings | null = null;
  private memoizedBindings: GridPlayerSummaryBindings | null = null;

  private readonly memoizedSpecialEntities = (playerId: string): readonly GameSpecialEntity[] => {
    // Read the source on every render. Besides keeping entity changes reactive,
    // this lets us retain the previous array when a snapshot only changed card
    // coordinates and the source rebuilt an equivalent array.
    const next = this.sourceBindings?.specialEntities(playerId) ?? EMPTY_SPECIAL_ENTITIES;
    const previous = this.specialEntitiesByPlayerId.get(playerId);
    if (previous && sameArrayReferences(previous, next)) {
      return previous;
    }

    this.specialEntitiesByPlayerId.set(playerId, next);
    return next;
  };

  memoize(bindings: GridPlayerSummaryBindings): GridPlayerSummaryBindings {
    const summaryPlayers = this.memoizeSummaryPlayers(bindings.players);
    const previousSource = this.sourceBindings;
    this.sourceBindings = bindings;

    if (
      this.memoizedBindings &&
      previousSource &&
      this.memoizedBindings.players === summaryPlayers &&
      sameSummaryBindingInputs(previousSource, bindings)
    ) {
      return this.memoizedBindings;
    }

    this.memoizedBindings = {
      ...bindings,
      players: summaryPlayers,
      specialEntities: this.memoizedSpecialEntities,
    };
    return this.memoizedBindings;
  }

  private memoizeSummaryPlayers(players: readonly PlayerView[]): readonly PlayerView[] {
    const nextPlayers = players.map((player) => {
      const previous = this.summaryPlayersById.get(player.id);
      if (!previous || previous === player) {
        return previous ?? player;
      }

      return samePlayerSummaryPresentation(previous, player) ? previous : player;
    });
    const summaryPlayers = sameArrayReferences(this.summaryPlayers, nextPlayers)
      ? this.summaryPlayers
      : nextPlayers;
    const activePlayerIds = new Set(players.map((player) => player.id));

    this.summaryPlayersById.clear();
    for (const player of summaryPlayers) {
      this.summaryPlayersById.set(player.id, player);
    }
    for (const playerId of this.specialEntitiesByPlayerId.keys()) {
      if (!activePlayerIds.has(playerId)) {
        this.specialEntitiesByPlayerId.delete(playerId);
      }
    }

    this.summaryPlayers = summaryPlayers;
    return summaryPlayers;
  }
}

function sameSummaryBindingInputs(
  previous: GridPlayerSummaryBindings,
  next: GridPlayerSummaryBindings,
): boolean {
  return (
    previous.colorAccent === next.colorAccent &&
    previous.deckLabel === next.deckLabel &&
    previous.manaSymbols === next.manaSymbols &&
    previous.playerCounterValue === next.playerCounterValue &&
    previous.canEditCounters === next.canEditCounters &&
    previous.autoApplyCommanderDamageToLife === next.autoApplyCommanderDamageToLife &&
    previous.specialEntities === next.specialEntities &&
    previous.showHelperPreview === next.showHelperPreview &&
    previous.hideHelperPreview === next.hideHelperPreview &&
    previous.openHelperContext === next.openHelperContext &&
    previous.changeLife === next.changeLife &&
    previous.changeCommanderDamage === next.changeCommanderDamage &&
    previous.changePlayerCounter === next.changePlayerCounter
  );
}

function samePlayerSummaryPresentation(previous: PlayerView, next: PlayerView): boolean {
  return (
    previous.id === next.id &&
    previous.knownCommanderInstanceIds === next.knownCommanderInstanceIds &&
    sameObjectFieldsExcept(previous.state, next.state, 'zones') &&
    sameObjectFieldsExcept(previous.state.zones, next.state.zones, 'battlefield') &&
    sameBattlefieldCardsExceptPosition(
      previous.state.zones.battlefield,
      next.state.zones.battlefield,
    )
  );
}

function sameBattlefieldCardsExceptPosition(
  previous: readonly GameCardInstance[],
  next: readonly GameCardInstance[],
): boolean {
  return (
    previous.length === next.length &&
    previous.every(
      (card, index) =>
        card === next[index] || sameObjectFieldsExcept(card, next[index]!, 'position'),
    )
  );
}

function sameObjectFieldsExcept(previous: object, next: object, excludedField: string): boolean {
  const previousRecord = previous as Record<string, unknown>;
  const nextRecord = next as Record<string, unknown>;
  const previousKeys = Object.keys(previousRecord).filter((key) => key !== excludedField);
  const nextKeys = Object.keys(nextRecord).filter((key) => key !== excludedField);

  return (
    previousKeys.length === nextKeys.length &&
    previousKeys.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(nextRecord, key) &&
        Object.is(previousRecord[key], nextRecord[key]),
    )
  );
}

function sameArrayReferences<T>(previous: readonly T[], next: readonly T[]): boolean {
  return previous.length === next.length && previous.every((value, index) => value === next[index]);
}
