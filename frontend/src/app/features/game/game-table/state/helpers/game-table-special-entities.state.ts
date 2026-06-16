import { Injectable, computed, inject } from '@angular/core';
import {
  GameCardInstance,
  GameCardPosition,
  GameSpecialEntity,
  GameSpecialEntityTemplate,
} from '../../../../../core/models/game.model';
import { GameTableCoreState } from '../core/game-table-core.state';

type DayNightMode = 'day' | 'night';
const DAY_NIGHT_FIXED_POSITION: GameCardPosition = { x: 1, y: 0, unit: 'ratio' };
const MONARCH_CARD_POSITION: GameCardPosition = { x: 0, y: 0, unit: 'ratio' };

interface DayNightState {
  readonly mode: DayNightMode;
  readonly createdByPlayerId: string | null;
  readonly positions: Readonly<Record<string, GameCardPosition>>;
}

export interface GameTablePlayerSpecialEntitiesSummary {
  readonly playerId: string;
  readonly monarch: GameSpecialEntity | null;
  readonly initiative: GameSpecialEntity | null;
  readonly citysBlessing: GameSpecialEntity | null;
  readonly ring: GameSpecialEntity | null;
  readonly dungeon: GameSpecialEntity | null;
  readonly emblems: readonly GameSpecialEntity[];
  readonly displayEntities: readonly GameSpecialEntity[];
  readonly hasAny: boolean;
}

@Injectable()
export class GameTableSpecialEntitiesState {
  private readonly core = inject(GameTableCoreState);

  readonly all = computed<readonly GameSpecialEntity[]>(() => this.core.snapshot()?.specialEntities ?? []);
  readonly dayNight = computed<GameSpecialEntity | null>(() => this.globalEntity('day_night'));
  readonly playerSummaries = computed<Record<string, GameTablePlayerSpecialEntitiesSummary>>(() => {
    const snapshot = this.core.snapshot();
    if (!snapshot) {
      return {};
    }

    const entities = this.all();
    const globalMonarch = entities.find((entity) => entity.template === 'monarch') ?? null;
    const globalInitiative = entities.find((entity) => entity.template === 'initiative') ?? null;
    const summaries: Record<string, GameTablePlayerSpecialEntitiesSummary> = {};

    for (const playerId of Object.keys(snapshot.players)) {
      const playerEntities = entities.filter((entity) => entity.ownerPlayerId === playerId);
      const monarch = globalMonarch?.ownerPlayerId === playerId ? globalMonarch : null;
      const initiative = globalInitiative?.ownerPlayerId === playerId ? globalInitiative : null;
      const citysBlessing = playerEntities.find((entity) => entity.template === 'citys_blessing') ?? null;
      const ring = playerEntities.find((entity) => entity.template === 'the_ring') ?? null;
      const dungeon = playerEntities.find((entity) => entity.template === 'dungeon') ?? null;
      const emblems = playerEntities.filter((entity) => entity.template === 'emblem');
      const displayEntities = [
        ...(monarch ? [monarch] : []),
        ...(initiative ? [initiative] : []),
        ...(citysBlessing ? [citysBlessing] : []),
        ...(ring ? [ring] : []),
        ...(dungeon ? [dungeon] : []),
        ...emblems,
      ];

      summaries[playerId] = {
        playerId,
        monarch,
        initiative,
        citysBlessing,
        ring,
        dungeon,
        emblems,
        displayEntities,
        hasAny: monarch !== null || displayEntities.length > 0,
      };
    }

    return summaries;
  });

  entitiesForPlayer(playerId: string): readonly GameSpecialEntity[] {
    return this.all().filter((entity) => entity.ownerPlayerId === playerId);
  }

  summaryForPlayer(playerId: string): GameTablePlayerSpecialEntitiesSummary {
    return this.playerSummaries()[playerId] ?? {
      playerId,
      monarch: null,
      initiative: null,
      citysBlessing: null,
      ring: null,
      dungeon: null,
      emblems: [],
      displayEntities: [],
      hasAny: false,
    };
  }

  displayEntitiesForPlayer(playerId: string): readonly GameSpecialEntity[] {
    return this.summaryForPlayer(playerId).displayEntities;
  }

  dayNightCardForPlayer(playerId: string): GameCardInstance | null {
    const entity = this.dayNight();
    if (!entity) {
      return null;
    }

    const state = this.readDayNightState(entity.state);
    const mode = state.mode;
    const name = entity.card?.name ?? (mode === 'night' ? 'Night' : 'Day');

    return {
      instanceId: `day-night:${entity.id}:${playerId}`,
      ownerId: state.createdByPlayerId ?? undefined,
      controllerId: playerId,
      scryfallId: entity.card?.scryfallId ?? `day-night-${mode}`,
      name,
      imageUris: entity.card?.imageUris ? { ...entity.card.imageUris } : undefined,
      cardFaces: entity.card?.cardFaces,
      typeLine: entity.card?.typeLine ?? 'Game Mechanic - Day/Night',
      layout: entity.card?.layout ?? 'day_night',
      oracleText: entity.card?.oracleText ?? (mode === 'night' ? 'It is night.' : 'It is day.'),
      tapped: false,
      activeFaceIndex: mode === 'night' ? 1 : 0,
      counters: {},
      zone: 'battlefield',
      isToken: true,
      position: DAY_NIGHT_FIXED_POSITION,
    };
  }

  monarchCardForPlayer(playerId: string): GameCardInstance | null {
    const entity = this.globalEntity('monarch');
    if (!entity || entity.ownerPlayerId !== playerId) {
      return null;
    }

    const card = entity.card;

    return {
      instanceId: `monarch:${entity.id}`,
      ownerId: playerId,
      controllerId: playerId,
      scryfallId: card?.scryfallId ?? 'monarch',
      name: card?.name ?? 'Monarch',
      imageUris: card?.imageUris ? { ...card.imageUris } : undefined,
      cardFaces: card?.cardFaces,
      typeLine: card?.typeLine ?? 'Game Mechanic - Monarch',
      layout: 'monarch',
      oracleText: card?.oracleText ?? 'You are the monarch.',
      tapped: false,
      counters: {},
      zone: 'battlefield',
      isToken: false,
      position: MONARCH_CARD_POSITION,
    };
  }

  playerEntity(playerId: string, template: GameSpecialEntityTemplate): GameSpecialEntity | null {
    return this.all().find((entity) => entity.ownerPlayerId === playerId && entity.template === template) ?? null;
  }

  globalEntity(template: Extract<GameSpecialEntityTemplate, 'monarch' | 'initiative' | 'day_night'>): GameSpecialEntity | null {
    return this.all().find((entity) => entity.template === template) ?? null;
  }

  emblemsForPlayer(playerId: string): readonly GameSpecialEntity[] {
    return this.entitiesForPlayer(playerId).filter((entity) => entity.template === 'emblem');
  }

  helperPreviewCard(entity: GameSpecialEntity): GameCardInstance | null {
    if (!entity.card) {
      return null;
    }

    return {
      instanceId: `special-entity:${entity.id}`,
      ownerId: entity.ownerPlayerId ?? undefined,
      controllerId: entity.ownerPlayerId ?? undefined,
      scryfallId: entity.card.scryfallId,
      name: entity.card.name,
      imageUris: entity.card.imageUris ? { ...entity.card.imageUris } : undefined,
      cardFaces: entity.card.cardFaces,
      typeLine: entity.card.typeLine,
      oracleText: entity.card.oracleText,
      tapped: false,
      counters: {},
      zone: 'command',
    };
  }

  ringBearerCardName(entity: GameSpecialEntity): string | null {
    const ringBearerInstanceId = typeof entity.state['ringBearerInstanceId'] === 'string'
      ? entity.state['ringBearerInstanceId']
      : null;
    if (!ringBearerInstanceId) {
      return null;
    }

    const snapshot = this.core.snapshot();
    if (!snapshot) {
      return null;
    }

    for (const player of Object.values(snapshot.players)) {
      const card = player.zones.battlefield.find((entry) => entry.instanceId === ringBearerInstanceId);
      if (card) {
        return card.name;
      }
    }

    return null;
  }

  private readDayNightState(state: Record<string, unknown>): DayNightState {
    return {
      mode: state['mode'] === 'night' ? 'night' : 'day',
      createdByPlayerId: typeof state['createdByPlayerId'] === 'string' ? state['createdByPlayerId'] : null,
      positions: this.readDayNightPositions(state['positions']),
    };
  }

  private readDayNightPositions(value: unknown): Readonly<Record<string, GameCardPosition>> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }

    const positions: Record<string, GameCardPosition> = {};
    for (const [playerId, position] of Object.entries(value)) {
      const normalizedPosition = this.readRatioPosition(position);
      if (normalizedPosition) {
        positions[playerId] = normalizedPosition;
      }
    }

    return positions;
  }

  private readRatioPosition(value: unknown): GameCardPosition | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    const raw = value as Record<string, unknown>;
    if (typeof raw['x'] !== 'number' || typeof raw['y'] !== 'number') {
      return null;
    }

    return {
      x: Math.max(0, Math.min(1, raw['x'])),
      y: Math.max(0, Math.min(1, raw['y'])),
      unit: 'ratio',
    };
  }
}
