import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { CardsApi } from '../../../../core/api/cards.api';
import type { Card, CardImageUris } from '../../../../core/models/card.model';
import type {
  GameCardInstance,
  GameCompactCardRef,
  GameSpecialEntity,
  GameSpecialEntityCardRef,
  GameZoneName,
} from '../../../../core/models/game.model';
import type {
  BootstrapInstanceV2,
  BootstrapStaticCardV2,
  GameplayPatchV2Operation,
  GameplayZoneCardsMoveV2,
  LegacyCardPatchPayload,
  PatchEnvelopeV2,
} from '../../../../core/models/game-v2.model';
import type { GameTableNormalizedV2State } from '../state/realtime/game-table-normalized-v2.store';

type PatchV2Message = PatchEnvelopeV2 & { kind: 'patch.v2' };
type RuntimeCardRef = (BootstrapInstanceV2 | LegacyCardPatchPayload | GameCompactCardRef) & {
  cardRef?: string | null;
  scryfallId?: string | null;
  faceDown?: boolean | null;
};

@Injectable({ providedIn: 'root' })
export class GameTableStaticCardResolverV2Service {
  private readonly cardsApi = inject(CardsApi);
  private readonly cardByPrintId = new Map<string, Promise<Card | null>>();

  async hydratePatch(
    patch: PatchV2Message,
    state: GameTableNormalizedV2State | null,
  ): Promise<PatchV2Message> {
    const staticCards = state?.staticCards ?? {};
    await this.warmPatchCardCatalog(patch.ops, staticCards);
    const hydratedOps = await Promise.all(
      patch.ops.map((operation) => this.hydrateOperation(operation, staticCards)),
    );

    if (hydratedOps.every((operation, index) => operation === patch.ops[index])) {
      return patch;
    }

    return {
      ...patch,
      ops: hydratedOps,
    };
  }

  /** Extracts card metadata that can be merged after a patch was already applied. */
  staticCardsFromPatch(patch: PatchV2Message): Record<string, BootstrapStaticCardV2> {
    const staticCards: Record<string, BootstrapStaticCardV2> = {};

    for (const operation of patch.ops) {
      switch (operation.op) {
        case 'card.field.set':
          if (operation.staticCard) {
            staticCards[operation.staticCard.cardRef] = operation.staticCard;
          }
          break;

        case 'zone.cards.add':
        case 'library.top.revealed':
        case 'library.top.viewed':
        case 'library.revealed.set':
        case 'mulligan.private_state.set':
        case 'mulligan.hand.replace_private':
          Object.assign(staticCards, operation.staticCards ?? {});
          break;

        case 'zone.cards.move':
          if (operation.staticCard) {
            staticCards[operation.staticCard.cardRef] = operation.staticCard;
          }
          break;

        case 'zone.cards.batchMove':
          for (const move of operation.moves) {
            if (move.staticCard) {
              staticCards[move.staticCard.cardRef] = move.staticCard;
            }
          }
          break;
      }
    }

    return staticCards;
  }

  async resolveOwnerFaceDownPreviewImage(card: GameCardInstance): Promise<string | null> {
    const existingImage = previewImageForCard(card, card.activeFaceIndex);
    if (existingImage) {
      return existingImage;
    }

    const printId = this.catalogPrintId(this.trimmed(card.scryfallId));
    if (!printId) {
      return null;
    }

    const apiCard = await this.cardForPrintId(printId);
    return apiCard ? previewImageForCard(apiCard, card.activeFaceIndex) : null;
  }

  private async hydrateOperation(
    operation: GameplayPatchV2Operation,
    stateStaticCards: Record<string, BootstrapStaticCardV2>,
  ): Promise<GameplayPatchV2Operation> {
    switch (operation.op) {
      case 'card.field.set': {
        if (operation.hidden === true || !operation.cardKey) {
          return operation;
        }
        const card = this.cardForFieldSetOperation(operation);
        const staticCard = await this.resolveStaticCardForCard(
          card,
          operation.zone,
          {},
          stateStaticCards,
        );
        return staticCard ? { ...operation, staticCard } : operation;
      }

      case 'zone.cards.add': {
        const resolved = await this.resolveStaticCardsForCards(
          operation.cards,
          operation.zone,
          operation.staticCards ?? {},
          stateStaticCards,
        );

        return Object.keys(resolved).length === 0
          ? operation
          : { ...operation, staticCards: { ...(operation.staticCards ?? {}), ...resolved } };
      }

      case 'library.top.revealed':
      case 'library.top.viewed':
      case 'library.revealed.set': {
        const resolved = await this.resolveStaticCardsForCards(
          operation.cards,
          'library',
          operation.staticCards ?? {},
          stateStaticCards,
        );

        return Object.keys(resolved).length === 0
          ? operation
          : { ...operation, staticCards: { ...(operation.staticCards ?? {}), ...resolved } };
      }

      case 'zone.cards.move': {
        return this.hydrateMove(operation, stateStaticCards);
      }

      case 'zone.cards.batchMove': {
        const moves = await Promise.all(
          operation.moves.map((move) => this.hydrateMove(move, stateStaticCards)),
        );

        return moves.every((move, index) => move === operation.moves[index])
          ? operation
          : { ...operation, moves };
      }

      case 'mulligan.private_state.set': {
        if (!operation.hand) {
          return operation;
        }

        const operationWithStaticCards = operation as typeof operation & {
          staticCards?: Record<string, BootstrapStaticCardV2>;
        };
        const resolved = await this.resolveStaticCardsForCards(
          operation.hand,
          'hand',
          operationWithStaticCards.staticCards ?? {},
          stateStaticCards,
        );

        return Object.keys(resolved).length === 0
          ? operation
          : {
              ...operationWithStaticCards,
              staticCards: { ...(operationWithStaticCards.staticCards ?? {}), ...resolved },
            };
      }

      case 'mulligan.hand.replace_private': {
        const resolved = await this.resolveStaticCardsForCards(
          operation.hand,
          'hand',
          operation.staticCards ?? {},
          stateStaticCards,
        );

        return Object.keys(resolved).length === 0
          ? operation
          : { ...operation, staticCards: { ...(operation.staticCards ?? {}), ...resolved } };
      }

      case 'helper.add':
      case 'helper.update':
        return this.hydrateHelperOperation(operation);

      default:
        return operation;
    }
  }

  private async hydrateHelperOperation<
    T extends Extract<GameplayPatchV2Operation, { op: 'helper.add' | 'helper.update' }>,
  >(operation: T): Promise<T> {
    const entity = await this.hydrateSpecialEntity(operation.entity);

    return entity === operation.entity ? operation : { ...operation, entity };
  }

  private async hydrateSpecialEntity(entity: GameSpecialEntity): Promise<GameSpecialEntity> {
    const card = entity.card;
    if (!card || this.hasRenderableSpecialEntityCard(card)) {
      return entity;
    }

    const printId = this.catalogPrintId(this.trimmed(card.scryfallId));
    if (!printId) {
      return entity;
    }

    const apiCard = await this.cardForPrintId(printId);
    if (!apiCard) {
      return entity;
    }

    return {
      ...entity,
      card: this.specialEntityCardFromApiCard(card, apiCard),
    };
  }

  private async hydrateMove<T extends GameplayZoneCardsMoveV2>(
    move: T,
    stateStaticCards: Record<string, BootstrapStaticCardV2>,
  ): Promise<T> {
    if (!move.card || (move.staticCard && this.hasRenderableStaticContent(move.staticCard))) {
      return move;
    }

    const operationStaticCards = move.staticCard
      ? { [this.staticCardMapKey(move.staticCard, this.cardRef(move.card))]: move.staticCard }
      : {};
    const resolved = await this.resolveStaticCardForCard(
      move.card,
      move.to.zone,
      operationStaticCards,
      stateStaticCards,
    );

    return resolved ? { ...move, staticCard: resolved } : move;
  }

  private async resolveStaticCardsForCards(
    cards: readonly RuntimeCardRef[],
    zone: GameZoneName,
    operationStaticCards: Record<string, BootstrapStaticCardV2>,
    stateStaticCards: Record<string, BootstrapStaticCardV2>,
  ): Promise<Record<string, BootstrapStaticCardV2>> {
    const resolved: Record<string, BootstrapStaticCardV2> = {};
    const unresolvedCards = cards.filter((card) => {
      if (card.hidden === true || card.faceDown === true) {
        return false;
      }

      const existing = this.staticCardForCard(card, operationStaticCards, stateStaticCards);
      return !(existing && this.hasRenderableStaticContent(existing));
    });
    const apiCardsByPrintId = await this.cardsForPrintIds(
      unresolvedCards.map((card) => this.printId(card)),
    );

    for (const card of unresolvedCards) {
      const printId = this.printId(card);
      const cardRef = this.cardRef(card);
      const apiCard = apiCardsByPrintId.get(printId);
      if (apiCard && cardRef) {
        const staticCard = this.staticCardFromApiCard(card, apiCard, zone);
        resolved[this.staticCardMapKey(staticCard, cardRef)] = staticCard;
      }
    }

    return resolved;
  }

  private async warmPatchCardCatalog(
    operations: readonly GameplayPatchV2Operation[],
    stateStaticCards: Record<string, BootstrapStaticCardV2>,
  ): Promise<void> {
    const printIds = new Set<string>();
    const collectCards = (
      cards: readonly RuntimeCardRef[],
      operationStaticCards: Record<string, BootstrapStaticCardV2>,
    ): void => {
      for (const card of cards) {
        if (card.hidden === true || card.faceDown === true) {
          continue;
        }

        const existing = this.staticCardForCard(card, operationStaticCards, stateStaticCards);
        if (existing && this.hasRenderableStaticContent(existing)) {
          continue;
        }

        const printId = this.printId(card);
        if (printId) {
          printIds.add(printId);
        }
      }
    };

    for (const operation of operations) {
      switch (operation.op) {
        case 'card.field.set':
          if (operation.hidden !== true && operation.cardKey) {
            collectCards([this.cardForFieldSetOperation(operation)], {});
          }
          break;

        case 'zone.cards.add':
        case 'library.top.revealed':
        case 'library.top.viewed':
        case 'library.revealed.set':
          collectCards(operation.cards, operation.staticCards ?? {});
          break;

        case 'mulligan.hand.replace_private':
          collectCards(operation.hand, operation.staticCards ?? {});
          break;

        case 'mulligan.private_state.set':
          collectCards(operation.hand ?? [], operation.staticCards ?? {});
          break;

        case 'zone.cards.move':
          if (operation.card) {
            collectCards(
              [operation.card],
              operation.staticCard
                ? {
                    [this.staticCardMapKey(operation.staticCard, this.cardRef(operation.card))]:
                      operation.staticCard,
                  }
                : {},
            );
          }
          break;

        case 'zone.cards.batchMove':
          for (const move of operation.moves) {
            if (!move.card) {
              continue;
            }
            collectCards(
              [move.card],
              move.staticCard
                ? {
                    [this.staticCardMapKey(move.staticCard, this.cardRef(move.card))]:
                      move.staticCard,
                  }
                : {},
            );
          }
          break;
      }
    }

    // A single miss keeps the cheaper existing endpoint. Every multi-card
    // patch is coalesced into one bulk request before individual operations
    // hydrate themselves.
    if (printIds.size > 1) {
      await this.cardsForPrintIds([...printIds]);
    }
  }

  private cardForFieldSetOperation(
    operation: Extract<GameplayPatchV2Operation, { op: 'card.field.set' }>,
  ): RuntimeCardRef {
    return {
      instanceId: operation.instanceId,
      cardKey: operation.cardKey,
      cardRef: operation.cardKey,
      printId: operation.printId ?? operation.cardKey?.replace(/:card$/, ''),
      cardVersion: operation.cardVersion,
      language: operation.language,
      viewerVisibility: operation.viewerVisibility,
      hidden: operation.hidden,
    };
  }

  private async resolveStaticCardForCard(
    card: RuntimeCardRef,
    zone: GameZoneName,
    operationStaticCards: Record<string, BootstrapStaticCardV2>,
    stateStaticCards: Record<string, BootstrapStaticCardV2>,
  ): Promise<BootstrapStaticCardV2 | null> {
    if (card.hidden === true || card.faceDown === true) {
      return null;
    }

    const existing = this.staticCardForCard(card, operationStaticCards, stateStaticCards);
    if (existing && this.hasRenderableStaticContent(existing)) {
      const cardRef = this.cardRef(card);
      const cardKey = this.cardKey(card);
      if (existing.cardRef === cardRef && existing.cardKey === cardKey) {
        return null;
      }

      // A face-up runtime patch may carry a different revision key for the
      // same Scryfall print. Keep the already known static payload under the
      // active instance key so the renderer can resolve it without a refetch.
      return {
        ...existing,
        cardRef,
        cardKey,
        printId: this.printId(card) || existing.printId,
        cardVersion: this.trimmed(card.cardVersion) || existing.cardVersion,
        language: this.trimmed(card.language) || existing.language,
        viewerVisibility: this.trimmed(card.viewerVisibility) || existing.viewerVisibility,
      };
    }

    const printId = this.printId(card);
    const cardRef = this.cardRef(card);
    if (!printId || !cardRef) {
      return null;
    }

    const apiCard = await this.cardForPrintId(printId);
    if (!apiCard) {
      return null;
    }

    return this.staticCardFromApiCard(card, apiCard, zone);
  }

  private async cardForPrintId(printId: string): Promise<Card | null> {
    const normalized = printId.trim();
    if (!normalized) {
      return null;
    }

    const existing = this.cardByPrintId.get(normalized);
    if (existing) {
      return existing;
    }

    const request = firstValueFrom(this.cardsApi.getSilently(normalized))
      .then((response) => response.card ?? null)
      .catch(() => null);
    this.cardByPrintId.set(normalized, request);

    const card = await request;
    if (!card && this.cardByPrintId.get(normalized) === request) {
      this.cardByPrintId.delete(normalized);
    }

    return card;
  }

  private async cardsForPrintIds(printIds: readonly string[]): Promise<Map<string, Card>> {
    const ids = [...new Set(printIds.map((printId) => printId.trim()).filter(Boolean))];
    const cardsByPrintId = new Map<string, Card>();
    const missingIds: string[] = [];
    const requestsByPrintId = new Map<string, Promise<Card | null>>();

    for (const printId of ids) {
      const cached = this.cardByPrintId.get(printId);
      if (cached) {
        requestsByPrintId.set(printId, cached);
      } else {
        missingIds.push(printId);
      }
    }

    if (missingIds.length === 1) {
      const printId = missingIds[0];
      requestsByPrintId.set(printId, this.cardForPrintId(printId));
    } else if (missingIds.length > 1) {
      const bulkRequest = firstValueFrom(this.cardsApi.getManySilently(missingIds))
        .then((response) => new Map(response.cards.map((card) => [card.scryfallId, card])))
        .catch(() => null);

      for (const printId of missingIds) {
        const request = bulkRequest.then((cards) => cards?.get(printId) ?? null);
        this.cardByPrintId.set(printId, request);
        requestsByPrintId.set(printId, request);

        void request.then((card) => {
          if (!card && this.cardByPrintId.get(printId) === request) {
            this.cardByPrintId.delete(printId);
          }
        });
      }
    }

    for (const [printId, request] of requestsByPrintId) {
      const card = await request;
      if (card) {
        cardsByPrintId.set(printId, card);
      }
    }

    return cardsByPrintId;
  }

  private staticCardFromApiCard(
    card: RuntimeCardRef,
    apiCard: Card,
    zone: GameZoneName,
  ): BootstrapStaticCardV2 {
    const cardRef = this.cardRef(card) || `${apiCard.scryfallId}:card`;
    const cardKey = this.cardKey(card) || cardRef;
    const printId = this.printId(card) || apiCard.scryfallId;

    return {
      cardRef,
      cardKey,
      printId,
      cardVersion: this.trimmed(card.cardVersion) || 'card-api-v1',
      language: this.trimmed(card.language) || this.trimmed(apiCard.lang) || 'en',
      viewerVisibility: this.trimmed(card.viewerVisibility) || this.viewerVisibilityForZone(zone),
      scryfallId: apiCard.scryfallId,
      name: apiCard.name,
      imageUris: apiCard.imageUris,
      cardFaces: apiCard.cardFaces ? structuredClone(apiCard.cardFaces) : [],
      typeLine: apiCard.typeLine,
      manaCost: apiCard.manaCost,
      colorIdentity: [...apiCard.colorIdentity],
      defaultPower: apiCard.power ?? null,
      defaultToughness: apiCard.toughness ?? null,
      defaultLoyalty: apiCard.loyalty ?? null,
      defaultDefense: apiCard.defense ?? null,
      hasRulings: apiCard.hasRulings ?? false,
    };
  }

  private specialEntityCardFromApiCard(
    card: GameSpecialEntityCardRef,
    apiCard: Card,
  ): GameSpecialEntityCardRef {
    return {
      scryfallId: this.trimmed(card.scryfallId) || apiCard.scryfallId,
      name: this.trimmed(card.name) || apiCard.name,
      imageUris: apiCard.imageUris,
      cardFaces: apiCard.cardFaces ? structuredClone(apiCard.cardFaces) : [],
      typeLine: this.trimmed(card.typeLine) || apiCard.typeLine,
      oracleText: this.trimmed(card.oracleText) || apiCard.oracleText,
      layout: this.trimmed(card.layout) || apiCard.layout,
    };
  }

  private staticCardForCard(
    card: RuntimeCardRef,
    operationStaticCards: Record<string, BootstrapStaticCardV2>,
    stateStaticCards: Record<string, BootstrapStaticCardV2>,
  ): BootstrapStaticCardV2 | null {
    const lookupKeys = this.staticLookupKeys([
      card.cardRef,
      card.cardKey,
      card.scryfallId,
      card.printId,
    ]);
    if (lookupKeys.length === 0) {
      return null;
    }

    for (const source of [operationStaticCards, stateStaticCards]) {
      for (const key of lookupKeys) {
        const exact = source[key];
        if (exact) {
          return exact;
        }
      }

      for (const candidate of Object.values(source)) {
        const candidateKeys = this.staticLookupKeys([
          candidate.cardRef,
          candidate.cardKey,
          candidate.scryfallId,
          candidate.printId,
        ]);
        if (lookupKeys.some((key) => candidateKeys.includes(key))) {
          return candidate;
        }
      }
    }

    return null;
  }

  private staticLookupKeys(keys: Array<string | null | undefined>): string[] {
    const lookupKeys = new Set<string>();
    for (const key of keys) {
      const trimmed = this.trimmed(key);
      if (!trimmed) {
        continue;
      }

      lookupKeys.add(trimmed);
      const runtimeScryfallId = this.scryfallIdFromRuntimeCardKey(trimmed);
      if (runtimeScryfallId) {
        lookupKeys.add(runtimeScryfallId);
        lookupKeys.add(`${runtimeScryfallId}:card`);
        lookupKeys.add(`${runtimeScryfallId}:token`);
      }

      const suffixedScryfallId = this.scryfallIdFromStaticRef(trimmed);
      if (suffixedScryfallId) {
        lookupKeys.add(suffixedScryfallId);
      }
    }

    return [...lookupKeys];
  }

  private cardRef(card: RuntimeCardRef): string {
    return (
      this.trimmed(card.cardRef) || this.trimmed(card.cardKey) || this.suffixedPrintId(card) || ''
    );
  }

  private cardKey(card: RuntimeCardRef): string {
    return (
      this.trimmed(card.cardKey) || this.trimmed(card.cardRef) || this.suffixedPrintId(card) || ''
    );
  }

  private printId(card: RuntimeCardRef): string {
    const direct = this.trimmed(card.printId) || this.trimmed(card.scryfallId);
    if (direct) {
      return this.catalogPrintId(direct);
    }

    const cardKey = this.trimmed(card.cardKey) || this.trimmed(card.cardRef);
    return cardKey ? this.catalogPrintId(cardKey) : '';
  }

  private catalogPrintId(value: string): string {
    return this.scryfallIdFromRuntimeCardKey(value) ?? this.scryfallIdFromStaticRef(value) ?? value;
  }

  private suffixedPrintId(card: RuntimeCardRef): string {
    const printId = this.printId(card);
    return printId ? `${printId}:card` : '';
  }

  private scryfallIdFromRuntimeCardKey(key: string): string | null {
    const parts = key.split(':');
    if (parts.length < 3 || parts[0] !== 'scryfall') {
      return null;
    }

    const scryfallId = parts[1]?.trim() ?? '';
    return scryfallId === '' ? null : scryfallId;
  }

  private scryfallIdFromStaticRef(key: string): string | null {
    const match = /^(.+):(card|token)$/.exec(key);
    const scryfallId = match?.[1]?.trim() ?? '';

    return scryfallId === '' ? null : scryfallId;
  }

  private hasRenderableStaticContent(card: BootstrapStaticCardV2): boolean {
    const name = card.name?.trim() ?? '';
    return (
      (name !== '' && name !== 'Card' && name !== 'Unknown Card') ||
      Boolean(card.imageUris && Object.keys(card.imageUris).length > 0) ||
      Boolean(card.cardFaces && card.cardFaces.length > 0)
    );
  }

  private hasRenderableSpecialEntityCard(card: GameSpecialEntityCardRef): boolean {
    return (
      Boolean(card.imageUris && Object.keys(card.imageUris).length > 0) ||
      Boolean(
        card.cardFaces &&
        card.cardFaces.some((face) => face.imageUris && Object.keys(face.imageUris).length > 0),
      )
    );
  }

  private viewerVisibilityForZone(zone: GameZoneName): string {
    return zone === 'hand' || zone === 'library' ? 'private' : 'public';
  }

  private staticCardMapKey(card: BootstrapStaticCardV2, fallback: string): string {
    return this.trimmed(card.cardRef) || this.trimmed(card.cardKey) || fallback;
  }

  private trimmed(value: string | null | undefined): string {
    return typeof value === 'string' ? value.trim() : '';
  }
}

function previewImageUri(
  imageUris: CardImageUris | Record<string, string> | undefined,
): string | null {
  if (!imageUris) {
    return null;
  }

  return imageUris.normal?.trim() || null;
}

function previewImageForCard(
  card: Pick<GameCardInstance, 'imageUris' | 'cardFaces'> | Pick<Card, 'imageUris' | 'cardFaces'>,
  activeFaceIndex?: number,
): string | null {
  const faceIndex =
    Number.isInteger(activeFaceIndex) && activeFaceIndex !== undefined && activeFaceIndex >= 0
      ? activeFaceIndex
      : 0;

  return (
    previewImageUri(card.cardFaces?.[faceIndex]?.imageUris) ??
    previewImageUri(card.imageUris) ??
    previewImageUri(card.cardFaces?.[0]?.imageUris)
  );
}
