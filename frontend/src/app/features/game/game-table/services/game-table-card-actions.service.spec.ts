import { TestBed } from '@angular/core/testing';
import { GameCardInstance, GameCardPosition, GameCommandType, GameZoneName } from '../../../../core/models/game.model';
import { GameContextMenu } from '../state/core/game-table-ui.state';
import { GameTableCardActionContext, GameTableCardActionsService } from './game-table-card-actions.service';

describe('GameTableCardActionsService', () => {
  let service: GameTableCardActionsService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [GameTableCardActionsService],
    });

    service = TestBed.inject(GameTableCardActionsService);
  });

  it('detects land stack membership from compact battlefield positions', () => {
    const battlefield = [land('top', 100, 200), land('under', 100, 180), card('artifact', 'Artifact', 100, 160)];
    const ctx = context(battlefield);

    expect(service.isLandStacked(ctx, 'player-1', battlefield[0]!)).toBe(true);
    expect(service.isLandStacked(ctx, 'player-1', battlefield[2]!)).toBe(false);
  });

  it('removes a land stack by separating its cards near the top card', async () => {
    const battlefield = [land('top', 100, 200), land('under', 100, 180), land('bottom', 100, 160)];
    const commands: Array<{ type: GameCommandType; payload: Record<string, unknown> }> = [];
    const updateLocalCardPosition = vi.fn();
    const closeContextMenu = vi.fn();
    const ctx = context(battlefield, {
      command: async (type, payload) => {
        commands.push({ type, payload });
      },
      closeContextMenu,
      updateLocalCardPosition,
    });

    await service.removeLandStack(ctx, menu(battlefield[1]!));

    expect(updateLocalCardPosition).toHaveBeenCalledWith('player-1', 'top', { x: 100, y: 200 });
    expect(updateLocalCardPosition).toHaveBeenCalledWith('player-1', 'under', { x: 230, y: 200 });
    expect(updateLocalCardPosition).toHaveBeenCalledWith('player-1', 'bottom', { x: 360, y: 200 });
    expect(closeContextMenu).toHaveBeenCalledOnce();
    expect(commands).toEqual([{
      type: 'cards.position.changed',
      payload: {
        playerId: 'player-1',
        zone: 'battlefield',
        positions: [
          { instanceId: 'top', position: { x: 100, y: 200, unit: 'ratio' } },
          { instanceId: 'under', position: { x: 230, y: 200, unit: 'ratio' } },
          { instanceId: 'bottom', position: { x: 360, y: 200, unit: 'ratio' } },
        ],
      },
    }]);
  });

  it('moves every selected card when the context menu card belongs to the selection', async () => {
    const battlefield = [card('card-1', 'Creature', 100, 100), card('card-2', 'Creature', 200, 100)];
    const commands: Array<{ type: GameCommandType; payload: Record<string, unknown> }> = [];
    const closeContextMenu = vi.fn();
    const clearSelectedCards = vi.fn();
    const ctx = context(battlefield, {
      selectedCards: () => battlefield.map((target) => ({ playerId: 'player-1', zone: 'battlefield', card: target })),
      command: async (type, payload) => {
        commands.push({ type, payload });
      },
      closeContextMenu,
      clearSelectedCards,
    });

    await service.moveCard(ctx, menu(battlefield[0]!), 'graveyard');

    expect(commands).toEqual([{
      type: 'cards.moved',
      payload: {
        playerId: 'player-1',
        fromZone: 'battlefield',
        toZone: 'graveyard',
        instanceIds: ['card-1', 'card-2'],
      },
    }]);
    expect(clearSelectedCards).toHaveBeenCalledOnce();
    expect(closeContextMenu).toHaveBeenCalledOnce();
  });

  it('removes a moved card from a fixed top-library modal while preserving fixed slots', async () => {
    const libraryCards: GameCardInstance[] = [
      libraryCard('card-1'),
      libraryCard('card-2'),
      libraryCard('card-3'),
    ];
    const command = vi.fn(async () => undefined);
    const replaceZoneModalCards = vi.fn();
    const ctx = context([], {
      command,
      replaceZoneModalCards,
      zoneModal: () => ({
        playerId: 'player-1',
        zone: 'library',
        title: 'Top 3',
        selectedCardId: 'card-1',
        cards: libraryCards,
        total: 3,
        type: '',
        search: '',
        showFilters: false,
        readOnly: false,
        allowRandomSelect: false,
        allowReorder: true,
        drawOrderLabels: ['PROXIMO ROBO', 'SEGUNDO ROBO', 'TERCER ROBO'],
        viewTopCount: 3,
        selectedCard: libraryCards[0]!,
        loading: false,
      }),
    });

    await service.moveCard(ctx, { ...menu(libraryCards[0]!), zone: 'library' }, 'graveyard');

    expect(command).toHaveBeenCalledWith('card.moved', {
      playerId: 'player-1',
      fromZone: 'library',
      toZone: 'graveyard',
      instanceId: 'card-1',
      sourceContext: { type: 'libraryTopView', count: 3 },
    });
    expect(replaceZoneModalCards).toHaveBeenCalledWith([libraryCards[1], libraryCards[2]]);
  });

  it('moves a viewed top-library card to hand without reloading the fixed modal', async () => {
    const libraryCards: GameCardInstance[] = [
      libraryCard('card-1'),
      libraryCard('card-2'),
    ];
    const command = vi.fn(async () => undefined);
    const loadZone = vi.fn(async () => undefined);
    const replaceZoneModalCards = vi.fn();
    const ctx = context([], {
      command,
      loadZone,
      replaceZoneModalCards,
      zoneModal: () => ({
        playerId: 'player-1',
        zone: 'library',
        title: 'Top 2',
        selectedCardId: 'card-1',
        cards: libraryCards,
        total: 2,
        type: '',
        search: '',
        showFilters: false,
        readOnly: false,
        allowRandomSelect: false,
        allowReorder: true,
        drawOrderLabels: ['PROXIMO ROBO', 'SEGUNDO ROBO'],
        viewTopCount: 2,
        selectedCard: libraryCards[0]!,
        loading: false,
      }),
    });

    await service.moveLibraryCardToHand(ctx, { ...menu(libraryCards[0]!), zone: 'library' }, false);

    expect(command).toHaveBeenCalledWith('card.moved', {
      playerId: 'player-1',
      fromZone: 'library',
      toZone: 'hand',
      instanceId: 'card-1',
      reveal: false,
      sourceContext: { type: 'libraryTopView', count: 2 },
    });
    expect(replaceZoneModalCards).toHaveBeenCalledWith([libraryCards[1]]);
    expect(loadZone).not.toHaveBeenCalled();
  });

  it('removes a moved card from an open searchable zone modal without reloading it', async () => {
    const graveyardCard = libraryCard('grave-card');
    const command = vi.fn(async () => undefined);
    const loadZone = vi.fn(async () => undefined);
    const replaceZoneModalCards = vi.fn();
    const ctx = context([], {
      command,
      loadZone,
      replaceZoneModalCards,
      zoneModal: () => ({
        playerId: 'player-1',
        zone: 'graveyard',
        title: 'Player Graveyard',
        selectedCardId: 'grave-card',
        cards: [graveyardCard],
        total: 1,
        type: '',
        search: '',
        showFilters: true,
        readOnly: false,
        allowRandomSelect: true,
        allowReorder: false,
        drawOrderLabels: [],
        viewTopCount: null,
        selectedCard: graveyardCard,
        loading: false,
      }),
    });

    await service.moveCard(ctx, { ...menu(graveyardCard), zone: 'graveyard' }, 'exile');

    expect(command).toHaveBeenCalledWith('card.moved', {
      playerId: 'player-1',
      fromZone: 'graveyard',
      toZone: 'exile',
      instanceId: 'grave-card',
    });
    expect(replaceZoneModalCards).toHaveBeenCalledWith([]);
    expect(loadZone).not.toHaveBeenCalled();
  });

  it('removes a card from an open fixed zone modal after giving it to another hand', async () => {
    const exileCards = [libraryCard('exile-1'), libraryCard('exile-2')];
    const command = vi.fn(async () => undefined);
    const replaceZoneModalCards = vi.fn();
    const ctx = context([], {
      command,
      replaceZoneModalCards,
      zoneModal: () => ({
        playerId: 'player-1',
        zone: 'exile',
        title: 'Player Exile',
        selectedCardId: 'exile-1',
        cards: exileCards,
        total: 2,
        type: '',
        search: '',
        showFilters: false,
        readOnly: false,
        allowRandomSelect: true,
        allowReorder: false,
        drawOrderLabels: [],
        viewTopCount: null,
        selectedCard: exileCards[0]!,
        loading: false,
      }),
    });

    await service.giveCardToPlayer(ctx, { ...menu(exileCards[0]!), zone: 'exile' }, 'player-2', 'hand');

    expect(command).toHaveBeenCalledWith('card.moved', {
      playerId: 'player-1',
      fromZone: 'exile',
      toZone: 'hand',
      targetPlayerId: 'player-2',
      instanceId: 'exile-1',
    });
    expect(replaceZoneModalCards).toHaveBeenCalledWith([exileCards[1]]);
  });

  it('applies tap state from the context menu card to all selected cards', async () => {
    const battlefield = [
      { ...card('card-1', 'Creature', 100, 100), tapped: false },
      { ...card('card-2', 'Creature', 200, 100), tapped: true },
    ];
    const commands: Array<{ type: GameCommandType; payload: Record<string, unknown> }> = [];
    const ctx = context(battlefield, {
      selectedCards: () => battlefield.map((target) => ({ playerId: 'player-1', zone: 'battlefield', card: target })),
      command: async (type, payload) => {
        commands.push({ type, payload });
      },
    });

    await service.tapCard(ctx, menu(battlefield[0]!));

    expect(commands).toEqual([
      {
        type: 'card.tapped',
        payload: { playerId: 'player-1', zone: 'battlefield', instanceId: 'card-1', tapped: true },
      },
      {
        type: 'card.tapped',
        payload: { playerId: 'player-1', zone: 'battlefield', instanceId: 'card-2', tapped: true },
      },
    ]);
  });
});

function context(
  battlefield: readonly GameCardInstance[],
  overrides: Partial<Pick<GameTableCardActionContext, 'clearSelectedCards' | 'closeContextMenu' | 'command' | 'loadZone' | 'replaceZoneModalCards' | 'selectedCards' | 'syncOpenZoneModalAfterMove' | 'updateLocalCardPosition' | 'zoneModal'>> = {},
): GameTableCardActionContext {
  const zoneModal = overrides.zoneModal ?? (() => null);
  const loadZone = overrides.loadZone ?? vi.fn(async () => undefined);
  const replaceZoneModalCards = overrides.replaceZoneModalCards ?? vi.fn();

  return {
    canControlPlayer: () => true,
    activeKeyboardCard: () => null,
    selectedCards: overrides.selectedCards ?? (() => []),
    clearSelectedCards: overrides.clearSelectedCards ?? vi.fn(),
    zoneModal,
    replaceZoneModalCards,
    loadZone,
    battlefieldCards: () => battlefield,
    cardPosition: (target) => target.position ? { x: target.position.x, y: target.position.y } : null,
    battlefieldPosition: (_playerId, _instanceId, position): GameCardPosition => ({ ...position, unit: 'ratio' }),
    updateLocalCardPosition: overrides.updateLocalCardPosition ?? vi.fn(),
    playerName: (playerId) => playerId,
    setError: vi.fn(),
    closeContextMenu: overrides.closeContextMenu ?? vi.fn(),
    setPendingBattlefieldMove: vi.fn(),
    setPendingLibraryMove: vi.fn(),
    syncOpenZoneModalAfterMove: overrides.syncOpenZoneModalAfterMove ?? (async (playerId, fromZone, instanceIds) => {
      const modal = zoneModal();
      if (!modal || modal.playerId !== playerId || modal.zone !== fromZone || instanceIds.length === 0) {
        return;
      }

      const movedIds = new Set(instanceIds);
      replaceZoneModalCards(modal.cards.filter((entry) => !movedIds.has(entry.instanceId)));
    }),
    recordCommanderCastIfNeeded: vi.fn(async () => undefined),
    command: overrides.command ?? vi.fn(async () => undefined),
  };
}

function menu(target: GameCardInstance): GameContextMenu {
  return {
    x: 0,
    y: 0,
    kind: 'card',
    playerId: 'player-1',
    zone: 'battlefield',
    card: target,
  };
}

function land(instanceId: string, x: number, y: number): GameCardInstance {
  return card(instanceId, 'Basic Land - Forest', x, y);
}

function card(instanceId: string, typeLine: string, x: number, y: number): GameCardInstance {
  return {
    instanceId,
    name: instanceId,
    typeLine,
    tapped: false,
    zone: 'battlefield' satisfies GameZoneName,
    position: { x, y },
  };
}

function libraryCard(instanceId: string): GameCardInstance {
  return {
    instanceId,
    name: instanceId,
    typeLine: 'Spell',
    tapped: false,
    zone: 'library',
  };
}
