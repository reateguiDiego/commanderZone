import { GameCardInstance, GameSnapshot } from '../../../../core/models/game.model';
import { CardFace } from '../../../../core/models/card.model';
import { isBattleCard, isSagaCard } from './gameplay-card-kind';
import {
  CardPreviewEvent,
  CardPreviewAttachmentInfo,
  CardPreviewAttachmentItem,
  CardPreviewCardStateInfo,
  CardPreviewCounterItem,
} from '../models/card-preview.model';

export function resolveCardPreviewCard(snapshot: GameSnapshot | null, preview: CardPreviewEvent): GameCardInstance {
  const playerZoneCard = preview.playerId && preview.zone
    ? snapshot?.players[preview.playerId]?.zones[preview.zone]?.find((card) => card.instanceId === preview.card.instanceId)
    : null;

  return playerZoneCard ?? snapshotCard(snapshot, preview.card.instanceId) ?? preview.card;
}

export function buildCardPreviewAttachmentInfo(
  snapshot: GameSnapshot | null,
  card: GameCardInstance,
): CardPreviewAttachmentInfo | null {
  const attachments = snapshot?.attachments ?? [];
  if (!snapshot || attachments.length === 0) {
    return null;
  }

  const attachedTo = attachments.find((attachment) => attachment.equipmentInstanceId === card.instanceId) ?? null;
  const attachedToCard = attachedTo ? battlefieldCard(snapshot, attachedTo.attachedToInstanceId) : null;
  const attachedCards = attachments
    .filter((attachment) => attachment.attachedToInstanceId === card.instanceId)
    .map((attachment) => battlefieldCard(snapshot, attachment.equipmentInstanceId))
    .filter((attachedCard): attachedCard is GameCardInstance => attachedCard !== null)
    .map(cardPreviewAttachmentItem);

  const info: CardPreviewAttachmentInfo = {
    attachedTo: attachedToCard ? cardPreviewAttachmentItem(attachedToCard) : null,
    attachedCards,
  };

  return info.attachedTo || info.attachedCards.length > 0 ? info : null;
}

export function buildCardPreviewCardStateInfo(card: GameCardInstance): CardPreviewCardStateInfo | null {
  const powerToughness = currentPowerToughness(card);
  const battle = card.faceDown ? null : cardPreviewBattle(card);
  const saga = card.faceDown ? null : cardPreviewSaga(card);
  const loyalty = card.faceDown ? null : cardPreviewLoyalty(card);
  const counters = cardPreviewCounters(card);

  return powerToughness || battle !== null || saga !== null || loyalty !== null || counters.length > 0
    ? { powerToughness, battle, saga, loyalty, counters }
    : null;
}

function battlefieldCard(snapshot: GameSnapshot, instanceId: string): GameCardInstance | null {
  return snapshotCard(snapshot, instanceId, ['battlefield']);
}

function snapshotCard(
  snapshot: GameSnapshot | null,
  instanceId: string,
  zones: readonly (keyof GameSnapshot['players'][string]['zones'])[] = ['battlefield', 'hand', 'library', 'graveyard', 'exile', 'command'],
): GameCardInstance | null {
  if (!snapshot) {
    return null;
  }

  for (const player of Object.values(snapshot.players)) {
    for (const zone of zones) {
      const card = player.zones[zone].find((candidate) => candidate.instanceId === instanceId);
      if (card) {
        return card;
      }
    }
  }

  return null;
}

function cardPreviewAttachmentItem(card: GameCardInstance): CardPreviewAttachmentItem {
  return {
    instanceId: card.instanceId,
    name: card.faceDown ? 'Face-down card' : activeFaceDisplayName(card),
  };
}

function activeFaceDisplayName(card: GameCardInstance): string {
  const faces = card.cardFaces ?? [];
  if (faces.length === 0) {
    return card.name;
  }

  const activeFace = activeCardFace(card);
  const faceName = activeFace?.name?.trim();
  if (faceName) {
    return faceName;
  }

  const activeIndex = Number.isInteger(card.activeFaceIndex) ? Number(card.activeFaceIndex) : 0;
  const safeFaceIndex = Math.max(0, Math.min(faces.length - 1, activeIndex));

  return card.name.split('//')[safeFaceIndex]?.trim() || card.name;
}

function currentPowerToughness(card: GameCardInstance): CardPreviewCardStateInfo['powerToughness'] {
  if (card.faceDown) {
    return null;
  }

  const currentPower = currentCardNumericValue(card, 'power');
  const currentToughness = currentCardNumericValue(card, 'toughness');
  if (currentPower === null || currentToughness === null) {
    return null;
  }

  const defaultPower = Number(card.defaultPower);
  const defaultToughness = Number(card.defaultToughness);
  if (
    !Number.isFinite(defaultPower)
    || !Number.isFinite(defaultToughness)
  ) {
    return null;
  }

  return currentPower !== defaultPower || currentToughness !== defaultToughness
    ? { power: currentPower, toughness: currentToughness }
    : null;
}

function cardPreviewLoyalty(card: GameCardInstance): number | null {
  const loyalty = currentCardNumericValue(card, 'loyalty');
  if (loyalty === null) {
    return null;
  }

  const defaultLoyalty = Number(card.defaultLoyalty);

  return Number.isFinite(loyalty) && Number.isFinite(defaultLoyalty) && loyalty !== defaultLoyalty ? loyalty : null;
}

function cardPreviewBattle(card: GameCardInstance): number | null {
  if (!isBattleCard(card)) {
    return null;
  }

  return toNumber(card.defense) ?? toNumber(card.defaultDefense);
}

function cardPreviewSaga(card: GameCardInstance): number | null {
  if (!isSagaCard(card) || card.zone !== 'battlefield') {
    return null;
  }

  return card.saga ?? 1;
}

function cardPreviewCounters(card: GameCardInstance): readonly CardPreviewCounterItem[] {
  return Object.entries(card.counters ?? {})
    .filter(([, value]) => Number.isFinite(Number(value)) && Number(value) >= 0)
    .map(([key, value]) => ({ key, value: Number(value) }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

function currentCardNumericValue(card: GameCardInstance, key: 'power' | 'toughness' | 'loyalty' | 'defense'): number | null {
  if (card.cardFaces && card.cardFaces.length > 0) {
    const activeFace = activeCardFace(card);
    if (!activeFace) {
      return null;
    }

    return toNumber(activeFace[key]);
  }

  return toNumber(card[key]);
}

function activeCardFace(card: GameCardInstance): CardFace | null {
  const faces = card.cardFaces ?? [];
  if (faces.length === 0) {
    return null;
  }

  const requestedIndex = Number.isInteger(card.activeFaceIndex) ? Number(card.activeFaceIndex) : 0;
  const activeIndex = Math.max(0, Math.min(faces.length - 1, requestedIndex));

  return faces[activeIndex] ?? null;
}

function toNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
}
