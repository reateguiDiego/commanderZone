import { GameCardInstance, GameCommandType, GameZoneName } from '../../../../core/models/game.model';
import { GameTableCardStatsContext, GameTableCardStatsService } from './game-table-card-stats.service';

describe('GameTableCardStatsService', () => {
  let service: GameTableCardStatsService;

  beforeEach(() => {
    vi.useFakeTimers();
    service = new GameTableCardStatsService();
  });

  afterEach(() => {
    service.clear();
    vi.useRealTimers();
  });

  it('accumulates quick power and toughness clicks over the pending value', async () => {
    const baseCard = card({ power: 2, toughness: 2 });
    const command = vi.fn(async () => undefined);
    const updates: Array<{ power: number; toughness: number }> = [];
    const context = statsContext(baseCard, command, {
      updateLocalCardPowerToughness: (_playerId, _zone, _instanceId, power, toughness) => {
        updates.push({ power, toughness });
      },
    });

    await service.changePower(context, 'player-1', 'battlefield', baseCard, 1);
    await service.changeToughness(context, 'player-1', 'battlefield', baseCard, 1);
    await service.changePower(context, 'player-1', 'battlefield', baseCard, 1);
    vi.advanceTimersByTime(450);
    await Promise.resolve();

    expect(updates).toEqual([
      { power: 3, toughness: 2 },
      { power: 3, toughness: 3 },
      { power: 4, toughness: 3 },
    ]);
    expect(command).toHaveBeenCalledWith('card.power_toughness.changed', {
      playerId: 'player-1',
      zone: 'battlefield',
      instanceId: 'card-1',
      power: 4,
      toughness: 3,
    }, true);
  });

  it('accumulates quick loyalty clicks over the pending value', async () => {
    const baseCard = card({ loyalty: 3 });
    const command = vi.fn(async () => undefined);
    const updates: number[] = [];
    const context = statsContext(baseCard, command, {
      updateLocalCardLoyalty: (_playerId, _zone, _instanceId, loyalty) => {
        updates.push(loyalty);
      },
    });

    await service.changeLoyalty(context, 'player-1', 'battlefield', baseCard, 1);
    await service.changeLoyalty(context, 'player-1', 'battlefield', baseCard, 1);
    await service.changeLoyalty(context, 'player-1', 'battlefield', baseCard, -1);
    vi.advanceTimersByTime(450);
    await Promise.resolve();

    expect(updates).toEqual([4, 5, 4]);
    expect(command).toHaveBeenCalledWith('card.power_toughness.changed', {
      playerId: 'player-1',
      zone: 'battlefield',
      instanceId: 'card-1',
      loyalty: 4,
    }, true);
  });

  it('accumulates quick battle clicks over the pending defense value', async () => {
    const baseCard = card({ defense: 4 });
    const command = vi.fn(async () => undefined);
    const updates: number[] = [];
    const context = statsContext(baseCard, command, {
      updateLocalCardBattleValue: (_playerId, _zone, _instanceId, defense) => {
        updates.push(defense);
      },
    });

    await service.changeBattle(context, 'player-1', 'battlefield', baseCard, 1);
    await service.changeBattle(context, 'player-1', 'battlefield', baseCard, 1);
    await service.changeBattle(context, 'player-1', 'battlefield', baseCard, -1);
    vi.advanceTimersByTime(450);
    await Promise.resolve();

    expect(updates).toEqual([5, 6, 5]);
    expect(command).toHaveBeenCalledWith('card.power_toughness.changed', {
      playerId: 'player-1',
      zone: 'battlefield',
      instanceId: 'card-1',
      defense: 5,
    }, true);
  });

  it('uses the visible default defense as the battle baseline when the mutable value is unset', async () => {
    const baseCard = card({ defense: null, defaultDefense: 6 });
    const command = vi.fn(async () => undefined);
    const updates: number[] = [];
    const context = statsContext(baseCard, command, {
      updateLocalCardBattleValue: (_playerId, _zone, _instanceId, defense) => {
        updates.push(defense);
      },
    });

    await service.changeBattle(context, 'player-1', 'battlefield', baseCard, 1);
    vi.advanceTimersByTime(450);
    await Promise.resolve();

    expect(updates).toEqual([7]);
    expect(command).toHaveBeenCalledWith('card.power_toughness.changed', {
      playerId: 'player-1',
      zone: 'battlefield',
      instanceId: 'card-1',
      defense: 7,
    }, true);
  });

  it('accumulates quick saga clicks over the pending chapter value', async () => {
    const baseCard = card({ zone: 'battlefield', typeLine: 'Enchantment - Saga', saga: 1 });
    const command = vi.fn(async () => undefined);
    const updates: number[] = [];
    const context = statsContext(baseCard, command, {
      updateLocalCardSagaValue: (_playerId, _zone, _instanceId, saga) => {
        updates.push(saga);
      },
    });

    await service.changeSaga(context, 'player-1', 'battlefield', baseCard, 1);
    await service.changeSaga(context, 'player-1', 'battlefield', baseCard, 1);
    await service.changeSaga(context, 'player-1', 'battlefield', baseCard, -1);
    vi.advanceTimersByTime(450);
    await Promise.resolve();

    expect(updates).toEqual([2, 3, 2]);
    expect(command).toHaveBeenCalledWith('card.power_toughness.changed', {
      playerId: 'player-1',
      zone: 'battlefield',
      instanceId: 'card-1',
      saga: 2,
    }, true);
  });

  it('clamps battle clicks between -1 and 99', async () => {
    const highCard = card({ defense: 99 });
    const highCommand = vi.fn(async () => undefined);
    const highUpdates: number[] = [];
    const highContext = statsContext(highCard, highCommand, {
      updateLocalCardBattleValue: (_playerId, _zone, _instanceId, defense) => {
        highUpdates.push(defense);
      },
    });

    await service.changeBattle(highContext, 'player-1', 'battlefield', highCard, 1);
    vi.advanceTimersByTime(450);
    await Promise.resolve();

    expect(highUpdates).toEqual([99]);
    expect(highCommand).toHaveBeenCalledWith('card.power_toughness.changed', {
      playerId: 'player-1',
      zone: 'battlefield',
      instanceId: 'card-1',
      defense: 99,
    }, true);

    const lowCard = card({ defense: -1 });
    const lowCommand = vi.fn(async () => undefined);
    const lowUpdates: number[] = [];
    const lowContext = statsContext(lowCard, lowCommand, {
      updateLocalCardBattleValue: (_playerId, _zone, _instanceId, defense) => {
        lowUpdates.push(defense);
      },
    });

    await service.changeBattle(lowContext, 'player-1', 'battlefield', lowCard, -1);
    vi.advanceTimersByTime(450);
    await Promise.resolve();

    expect(lowUpdates).toEqual([-1]);
    expect(lowCommand).toHaveBeenCalledWith('card.power_toughness.changed', {
      playerId: 'player-1',
      zone: 'battlefield',
      instanceId: 'card-1',
      defense: -1,
    }, true);
  });
});

function statsContext(
  sourceCard: GameCardInstance,
  command: (type: GameCommandType, payload: Record<string, unknown>, force?: boolean) => Promise<void>,
  overrides: Partial<GameTableCardStatsContext> = {},
): GameTableCardStatsContext {
  return {
    canControlOwnedCard: () => true,
    findCard: (_playerId: string, _zone: GameZoneName, instanceId: string) =>
      instanceId === sourceCard.instanceId ? sourceCard : null,
    updateLocalCardPowerToughness: vi.fn(),
    updateLocalCardBattleValue: vi.fn(),
    updateLocalCardSagaValue: vi.fn(),
    updateLocalCardLoyalty: vi.fn(),
    setError: vi.fn(),
    command,
    ...overrides,
  };
}

function card(overrides: Partial<GameCardInstance> = {}): GameCardInstance {
  return {
    instanceId: 'card-1',
    name: 'Ajani Test Card',
    tapped: false,
    zone: 'battlefield',
    ...overrides,
  };
}
