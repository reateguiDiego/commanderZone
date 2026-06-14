import { Injectable, computed, inject } from '@angular/core';
import {
  GameCardInstance,
  GameSpecialEntity,
  GameSpecialEntityTemplate,
} from '../../../../../core/models/game.model';
import { GameTableCoreState } from '../core/game-table-core.state';

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
}
