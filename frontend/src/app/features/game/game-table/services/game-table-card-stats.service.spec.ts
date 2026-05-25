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
