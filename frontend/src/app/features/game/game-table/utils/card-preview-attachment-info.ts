import { GameCardInstance, GameSnapshot } from '../../../../core/models/game.model';
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
  const loyalty = card.faceDown ? null : cardPreviewLoyalty(card);
  const counters = cardPreviewCounters(card);

  return powerToughness || loyalty !== null || counters.length > 0 ? { powerToughness, loyalty, counters } : null;
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
  if (faces.length < 2) {
    return card.name;
  }

  const faceIndex = Number.isInteger(card.activeFaceIndex) ? Number(card.activeFaceIndex) : 0;
  const safeFaceIndex = Math.max(0, Math.min(faces.length - 1, faceIndex));
  const faceName = faces[safeFaceIndex]?.name?.trim();
  if (faceName) {
    return faceName;
  }

  return card.name.split('//')[safeFaceIndex]?.trim() || card.name;
}

function currentPowerToughness(card: GameCardInstance): CardPreviewCardStateInfo['powerToughness'] {
  if (card.faceDown) {
    return null;
  }

  if (
    card.power === null
    || card.power === undefined
    || card.toughness === null
    || card.toughness === undefined
  ) {
    return null;
  }

  const power = Number(card.power);
  const toughness = Number(card.toughness);
  if (![power, toughness].every(Number.isFinite)) {
    return null;
  }

  if (
    card.defaultPower === null
    || card.defaultPower === undefined
    || card.defaultToughness === null
    || card.defaultToughness === undefined
  ) {
    return null;
  }

  const defaultPower = Number(card.defaultPower);
  const defaultToughness = Number(card.defaultToughness);
  if (![defaultPower, defaultToughness].every(Number.isFinite)) {
    return null;
  }

  return power !== defaultPower || toughness !== defaultToughness ? { power, toughness } : null;
}

function cardPreviewLoyalty(card: GameCardInstance): number | null {
  if (card.loyalty === null || card.loyalty === undefined) {
    return null;
  }

  const loyalty = Number(card.loyalty);
  const defaultLoyalty = Number(card.defaultLoyalty);

  return Number.isFinite(loyalty) && Number.isFinite(defaultLoyalty) && loyalty !== defaultLoyalty ? loyalty : null;
}

function cardPreviewCounters(card: GameCardInstance): readonly CardPreviewCounterItem[] {
  return Object.entries(card.counters ?? {})
    .filter(([, value]) => Number.isFinite(Number(value)) && Number(value) >= 0)
    .map(([key, value]) => ({ key, value: Number(value) }))
    .sort((a, b) => a.key.localeCompare(b.key));
}
