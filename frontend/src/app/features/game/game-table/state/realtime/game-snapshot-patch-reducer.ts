import {
  GameCardInstance,
  GamePlayerState,
  GameSnapshot,
  GameZoneCounts,
  GameZoneName,
} from '../../../../../core/models/game.model';
import {
  GameplayGamePatchMessage,
  GameSnapshotPatchOperation,
  getGamePatchDecision,
} from '../../../../../core/models/game-realtime.model';

export type GameSnapshotPatchFailureReason = 'version_gap' | 'target_not_found' | 'invalid_operation';

export type GameSnapshotPatchApplyResult =
  | { status: 'applied'; snapshot: GameSnapshot }
  | { status: 'ignored'; snapshot: GameSnapshot; reason: 'duplicate_or_late_version' }
  | { status: 'resync_required'; snapshot: GameSnapshot; reason: GameSnapshotPatchFailureReason };

export type GameSnapshotPatchOperationsResult =
  | { status: 'applied'; snapshot: GameSnapshot }
  | { status: 'resync_required'; snapshot: GameSnapshot; reason: Exclude<GameSnapshotPatchFailureReason, 'version_gap'> };

type OperationResult =
  | { status: 'applied'; snapshot: GameSnapshot }
  | { status: 'failed'; reason: Exclude<GameSnapshotPatchFailureReason, 'version_gap'> };

const ZONE_NAMES: readonly GameZoneName[] = ['library', 'hand', 'battlefield', 'graveyard', 'exile', 'command'];
const MAX_EVENT_LOG_ENTRIES = 250;

export function applyGameSnapshotPatch(snapshot: GameSnapshot, patch: GameplayGamePatchMessage): GameSnapshotPatchApplyResult {
  const decision = getGamePatchDecision(snapshot.version, patch);
  if (decision === 'ignore') {
    return { status: 'ignored', snapshot, reason: 'duplicate_or_late_version' };
  }

  if (decision === 'resync') {
    return { status: 'resync_required', snapshot, reason: 'version_gap' };
  }

  const operationsResult = applyGameSnapshotPatchOperations(snapshot, patch.operations);
  if (operationsResult.status !== 'applied') {
    return operationsResult;
  }

  return {
    status: 'applied',
    snapshot: {
      ...operationsResult.snapshot,
      version: patch.version,
    },
  };
}

export function applyGameSnapshotPatchOperations(snapshot: GameSnapshot, operations: GameSnapshotPatchOperation[]): GameSnapshotPatchOperationsResult {
  let nextSnapshot = snapshot;

  for (const operation of operations) {
    const result = applyOperation(nextSnapshot, operation);
    if (result.status === 'failed') {
      return { status: 'resync_required', snapshot, reason: result.reason };
    }

    nextSnapshot = result.snapshot;
  }

  return { status: 'applied', snapshot: nextSnapshot };
}

function applyOperation(snapshot: GameSnapshot, operation: GameSnapshotPatchOperation): OperationResult {
  switch (operation.op) {
    case 'game.counters.set':
      return {
        status: 'applied',
        snapshot: {
          ...snapshot,
          counters: {
            ...(snapshot.counters ?? {}),
            [operation.scope]: { ...operation.counters },
          },
        },
      };

    case 'player.life.set':
      return updatePlayer(snapshot, operation.playerId, (player) => ({ ...player, life: operation.value }));

    case 'player.counters.set':
      return updatePlayer(snapshot, operation.playerId, (player) => ({ ...player, counters: { ...operation.counters } }));

    case 'player.commanderDamage.set':
      return updatePlayer(snapshot, operation.playerId, (player) => ({ ...player, commanderDamage: { ...operation.commanderDamage } }));

    case 'player.sleeves.set':
      return updatePlayer(snapshot, operation.playerId, (player) => ({ ...player, sleevesName: operation.sleevesName }));

    case 'player.background.set':
      return updatePlayer(snapshot, operation.playerId, (player) => ({ ...player, backgroundName: operation.backgroundName }));

    case 'zone.counts.set':
      return updatePlayer(snapshot, operation.playerId, (player) => {
        const zoneCounts = mergeZoneCounts(player, operation.counts);

        return zoneCounts ? { ...player, zoneCounts } : null;
      });

    case 'zone.visible.set':
      return replaceVisibleZone(snapshot, operation.playerId, operation.zone, operation.cards);

    case 'player.library.visibility.set':
      return updatePlayer(snapshot, operation.playerId, (player) => ({
        ...player,
        ...(operation.playTopLibraryRevealed !== undefined ? { playTopLibraryRevealed: operation.playTopLibraryRevealed } : {}),
        ...(operation.revealedLibraryTo !== undefined ? { revealedLibraryTo: [...operation.revealedLibraryTo] } : {}),
      }));

    case 'player.status.set':
      return updatePlayer(snapshot, operation.playerId, (player) => ({
        ...player,
        status: operation.status,
        ...(operation.concededAt !== undefined ? { concededAt: operation.concededAt } : {}),
      }));

    case 'card.position.set':
      return updateCard(snapshot, operation.playerId, operation.zone, operation.instanceId, (card) => ({
        ...card,
        position: operation.position,
      }));

    case 'cards.position.set':
      return applyCardPositions(snapshot, operation.playerId, operation.zone, operation.positions);

    case 'card.move':
      return moveCard(snapshot, operation);

    case 'card.remove':
      return removeCard(snapshot, operation);

    case 'card.state.set':
      return updateCard(snapshot, operation.playerId, operation.zone, operation.instanceId, (card) => ({
        ...card,
        ...(operation.tapped !== undefined ? { tapped: operation.tapped } : {}),
        ...(operation.rotation !== undefined ? { rotation: operation.rotation } : {}),
        ...(operation.faceDown !== undefined ? { faceDown: operation.faceDown } : {}),
        ...(operation.hidden !== undefined ? { hidden: operation.hidden } : {}),
        ...(operation.revealedTo !== undefined ? { revealedTo: [...operation.revealedTo] } : {}),
        ...(operation.counters !== undefined ? { counters: { ...operation.counters } } : {}),
      }));

    case 'card.projection.set':
      return updateCard(snapshot, operation.playerId, operation.zone, operation.instanceId, () => ({
        ...operation.card,
        zone: operation.zone,
      }));

    case 'card.counters.set':
      return updateCard(snapshot, operation.playerId, operation.zone, operation.instanceId, (card) => ({
        ...card,
        counters: { ...operation.counters },
      }));

    case 'card.stats.set':
      return updateCard(snapshot, operation.playerId, operation.zone, operation.instanceId, (card) => ({
        ...card,
        ...(operation.power !== undefined ? { power: operation.power } : {}),
        ...(operation.toughness !== undefined ? { toughness: operation.toughness } : {}),
        ...(operation.loyalty !== undefined ? { loyalty: operation.loyalty } : {}),
      }));

    case 'cards.state.set':
      return applyCardsState(snapshot, operation.playerId, operation.zone, operation.cards);

    case 'card.create':
      return createCard(snapshot, operation.playerId, operation.zone, operation.card, operation.index);

    case 'turn.set':
      return { status: 'applied', snapshot: { ...snapshot, turn: { ...operation.turn } } };

    case 'timer.set':
      return { status: 'applied', snapshot: { ...snapshot, timer: operation.timer ? { ...operation.timer } : undefined } };

    case 'disconnect.vote.set':
      return {
        status: 'applied',
        snapshot: {
          ...snapshot,
          disconnectVote: operation.disconnectVote
            ? {
                ...operation.disconnectVote,
                votes: { ...operation.disconnectVote.votes },
              }
            : null,
        },
      };

    case 'chat.append':
      return { status: 'applied', snapshot: { ...snapshot, chat: [...snapshot.chat, ...operation.entries] } };

    case 'chat.message.set':
      return updateChatMessage(snapshot, operation.message);

    case 'eventLog.append':
      return {
        status: 'applied',
        snapshot: {
          ...snapshot,
          eventLog: [...snapshot.eventLog, ...operation.entries].slice(-MAX_EVENT_LOG_ENTRIES),
        },
      };

    case 'stack.item.add':
      return addStackItem(snapshot, operation.item);

    case 'stack.item.remove':
      return removeStackItem(snapshot, operation.id);

    case 'stack.set':
      return { status: 'applied', snapshot: { ...snapshot, stack: [...operation.stack] } };

    case 'arrow.add':
      return addArrow(snapshot, operation.arrow);

    case 'arrow.remove':
      return removeArrow(snapshot, operation.id);

    case 'arrows.set':
      return { status: 'applied', snapshot: { ...snapshot, arrows: [...operation.arrows] } };

    case 'attachment.add':
      return addAttachment(snapshot, operation.attachment);

    case 'attachment.remove':
      return removeAttachment(snapshot, operation.id);

    case 'attachments.set':
      return { status: 'applied', snapshot: { ...snapshot, attachments: [...operation.attachments] } };

    default:
      return { status: 'failed', reason: 'invalid_operation' };
  }
}

function updatePlayer(snapshot: GameSnapshot, playerId: string, update: (player: GamePlayerState) => GamePlayerState | null): OperationResult {
  const player = snapshot.players[playerId];
  if (!player) {
    return { status: 'failed', reason: 'target_not_found' };
  }

  const nextPlayer = update(player);
  if (!nextPlayer) {
    return { status: 'failed', reason: 'target_not_found' };
  }

  return {
    status: 'applied',
    snapshot: {
      ...snapshot,
      players: {
        ...snapshot.players,
        [playerId]: nextPlayer,
      },
    },
  };
}

function mergeZoneCounts(player: GamePlayerState, counts: Partial<Record<GameZoneName, number>>): GameZoneCounts | null {
  if (!player.zoneCounts) {
    return null;
  }

  return {
    ...player.zoneCounts,
    ...counts,
  };
}

function applyCardPositions(
  snapshot: GameSnapshot,
  playerId: string,
  zone: GameZoneName,
  positions: Array<{ instanceId: string; position: GameCardInstance['position'] }>,
): OperationResult {
  const nextPositions = new Map(positions.map((entry) => [entry.instanceId, entry.position]));
  const player = snapshot.players[playerId];
  const cards = player?.zones[zone];
  if (!player || !Array.isArray(cards)) {
    return { status: 'failed', reason: 'target_not_found' };
  }

  if (positions.some((entry) => !cards.some((card) => card.instanceId === entry.instanceId))) {
    return { status: 'failed', reason: 'target_not_found' };
  }

  const nextCards = cards.map((card) => nextPositions.has(card.instanceId)
    ? { ...card, position: nextPositions.get(card.instanceId) }
    : card);

  return replaceZone(snapshot, playerId, zone, nextCards);
}

function updateCard(
  snapshot: GameSnapshot,
  playerId: string,
  zone: GameZoneName,
  instanceId: string,
  update: (card: GameCardInstance) => GameCardInstance,
): OperationResult {
  const player = snapshot.players[playerId];
  const cards = player?.zones[zone];
  if (!player || !Array.isArray(cards)) {
    return { status: 'failed', reason: 'target_not_found' };
  }

  const cardIndex = cards.findIndex((card) => card.instanceId === instanceId);
  if (cardIndex < 0) {
    return { status: 'failed', reason: 'target_not_found' };
  }

  const nextCards = [...cards];
  nextCards[cardIndex] = update(cards[cardIndex]);

  return replaceZone(snapshot, playerId, zone, nextCards);
}

function applyCardsState(
  snapshot: GameSnapshot,
  playerId: string,
  zone: GameZoneName,
  states: Array<{
    instanceId: string;
    tapped?: boolean;
    rotation?: number;
    faceDown?: boolean;
    hidden?: boolean;
    revealedTo?: string[];
  }>,
): OperationResult {
  const player = snapshot.players[playerId];
  const cards = player?.zones[zone];
  if (!player || !Array.isArray(cards)) {
    return { status: 'failed', reason: 'target_not_found' };
  }

  const statesById = new Map(states.map((state) => [state.instanceId, state]));
  if (states.some((state) => !cards.some((card) => card.instanceId === state.instanceId))) {
    return { status: 'failed', reason: 'target_not_found' };
  }

  return replaceZone(snapshot, playerId, zone, cards.map((card) => {
    const state = statesById.get(card.instanceId);
    if (!state) {
      return card;
    }

    return {
      ...card,
      ...(state.tapped !== undefined ? { tapped: state.tapped } : {}),
      ...(state.rotation !== undefined ? { rotation: state.rotation } : {}),
      ...(state.faceDown !== undefined ? { faceDown: state.faceDown } : {}),
      ...(state.hidden !== undefined ? { hidden: state.hidden } : {}),
      ...(state.revealedTo !== undefined ? { revealedTo: [...state.revealedTo] } : {}),
    };
  }));
}

function createCard(
  snapshot: GameSnapshot,
  playerId: string,
  zone: GameZoneName,
  card: GameCardInstance,
  index: number | undefined,
): OperationResult {
  const player = snapshot.players[playerId];
  const cards = player?.zones[zone];
  if (!player || !Array.isArray(cards)) {
    return { status: 'failed', reason: 'target_not_found' };
  }

  if (cards.some((entry) => entry.instanceId === card.instanceId)) {
    return { status: 'failed', reason: 'invalid_operation' };
  }

  if (index !== undefined && (!Number.isInteger(index) || index < 0)) {
    return { status: 'failed', reason: 'invalid_operation' };
  }

  const insertIndex = index === undefined ? cards.length : Math.min(index, cards.length);
  const nextCards = [
    ...cards.slice(0, insertIndex),
    { ...card, zone },
    ...cards.slice(insertIndex),
  ];

  return replaceZone(snapshot, playerId, zone, nextCards);
}

function addStackItem(snapshot: GameSnapshot, item: GameSnapshot['stack'][number]): OperationResult {
  if (snapshot.stack.some((entry) => entry.id === item.id)) {
    return { status: 'failed', reason: 'invalid_operation' };
  }

  return { status: 'applied', snapshot: { ...snapshot, stack: [...snapshot.stack, item] } };
}

function removeStackItem(snapshot: GameSnapshot, id: string): OperationResult {
  if (!snapshot.stack.some((entry) => entry.id === id)) {
    return { status: 'failed', reason: 'target_not_found' };
  }

  return { status: 'applied', snapshot: { ...snapshot, stack: snapshot.stack.filter((entry) => entry.id !== id) } };
}

function addArrow(snapshot: GameSnapshot, arrow: GameSnapshot['arrows'][number]): OperationResult {
  if (snapshot.arrows.some((entry) => entry.id === arrow.id)) {
    return { status: 'failed', reason: 'invalid_operation' };
  }

  return { status: 'applied', snapshot: { ...snapshot, arrows: [...snapshot.arrows, arrow] } };
}

function removeArrow(snapshot: GameSnapshot, id: string): OperationResult {
  if (!snapshot.arrows.some((entry) => entry.id === id)) {
    return { status: 'failed', reason: 'target_not_found' };
  }

  return { status: 'applied', snapshot: { ...snapshot, arrows: snapshot.arrows.filter((entry) => entry.id !== id) } };
}

function addAttachment(snapshot: GameSnapshot, attachment: NonNullable<GameSnapshot['attachments']>[number]): OperationResult {
  const attachments = snapshot.attachments ?? [];
  if (attachments.some((entry) => entry.id === attachment.id)) {
    return { status: 'failed', reason: 'invalid_operation' };
  }

  return { status: 'applied', snapshot: { ...snapshot, attachments: [...attachments, attachment] } };
}

function removeAttachment(snapshot: GameSnapshot, id: string): OperationResult {
  const attachments = snapshot.attachments ?? [];
  if (!attachments.some((entry) => entry.id === id)) {
    return { status: 'failed', reason: 'target_not_found' };
  }

  return { status: 'applied', snapshot: { ...snapshot, attachments: attachments.filter((entry) => entry.id !== id) } };
}

function moveCard(snapshot: GameSnapshot, operation: Extract<GameSnapshotPatchOperation, { op: 'card.move' }>): OperationResult {
  const fromPlayer = snapshot.players[operation.from.playerId];
  const toPlayer = snapshot.players[operation.to.playerId];
  const fromCards = fromPlayer?.zones[operation.from.zone];
  const toCards = toPlayer?.zones[operation.to.zone];
  if (!fromPlayer || !toPlayer || !Array.isArray(fromCards) || !Array.isArray(toCards)) {
    return { status: 'failed', reason: 'target_not_found' };
  }

  const fromIndex = fromCards.findIndex((card) => card.instanceId === operation.instanceId);
  const hiddenPlaceholderIndex = fromIndex >= 0 ? -1 : fromCards.findIndex(isHiddenPlaceholder);
  const sourceCard = fromIndex >= 0 ? fromCards[fromIndex] : undefined;
  const movingCard = operation.card ?? sourceCard;
  if (!movingCard && hiddenPlaceholderIndex < 0) {
    return { status: 'failed', reason: 'target_not_found' };
  }

  if (operation.to.index !== undefined && (!Number.isInteger(operation.to.index) || operation.to.index < 0)) {
    return { status: 'failed', reason: 'invalid_operation' };
  }

  const nextFromCards = fromIndex >= 0
    ? fromCards.filter((card) => card.instanceId !== operation.instanceId)
    : hiddenPlaceholderIndex >= 0
      ? fromCards.filter((_card, index) => index !== hiddenPlaceholderIndex)
      : fromCards;
  const targetCardsAfterRemoval = operation.from.playerId === operation.to.playerId && operation.from.zone === operation.to.zone
    ? nextFromCards
    : toCards.filter((card) => card.instanceId !== operation.instanceId && card.instanceId !== movingCard?.instanceId);
  if (!movingCard) {
    return replaceZone(snapshot, operation.from.playerId, operation.from.zone, nextFromCards);
  }
  const insertIndex = operation.to.index === undefined
    ? targetCardsAfterRemoval.length
    : Math.min(operation.to.index, targetCardsAfterRemoval.length);
  const nextToCards = [
    ...targetCardsAfterRemoval.slice(0, insertIndex),
    { ...movingCard, zone: operation.to.zone },
    ...targetCardsAfterRemoval.slice(insertIndex),
  ];

  const nextSnapshot = replaceZoneSnapshotOnly(snapshot, operation.from.playerId, operation.from.zone, nextFromCards);
  const movedSnapshot = replaceZoneSnapshotOnly(nextSnapshot, operation.to.playerId, operation.to.zone, nextToCards);

  if (!operation.zoneCounts) {
    return { status: 'applied', snapshot: movedSnapshot };
  }

  return updatePlayer(movedSnapshot, operation.to.playerId, (player) => {
    const zoneCounts = mergeZoneCounts(player, operation.zoneCounts ?? {});

    return zoneCounts ? { ...player, zoneCounts } : null;
  });
}

function removeCard(snapshot: GameSnapshot, operation: Extract<GameSnapshotPatchOperation, { op: 'card.remove' }>): OperationResult {
  const player = snapshot.players[operation.playerId];
  const cards = player?.zones[operation.zone];
  if (!player || !Array.isArray(cards)) {
    return { status: 'failed', reason: 'target_not_found' };
  }

  const zonesWithCard = ZONE_NAMES.filter((zone) =>
    player.zones[zone].some((card) => card.instanceId === operation.instanceId),
  );

  if (!zonesWithCard.includes(operation.zone)) {
    return { status: 'failed', reason: 'target_not_found' };
  }

  const nextSnapshot = zonesWithCard.reduce(
    (currentSnapshot, zone) => replaceZoneSnapshotOnly(
      currentSnapshot,
      operation.playerId,
      zone,
      currentSnapshot.players[operation.playerId]!.zones[zone].filter((card) => card.instanceId !== operation.instanceId),
    ),
    snapshot,
  );

  if (!operation.zoneCounts) {
    return { status: 'applied', snapshot: nextSnapshot };
  }

  return updatePlayer(nextSnapshot, operation.playerId, (updatedPlayer) => {
    const zoneCounts = mergeZoneCounts(updatedPlayer, operation.zoneCounts ?? {});

    return zoneCounts ? { ...updatedPlayer, zoneCounts } : null;
  });
}

function isHiddenPlaceholder(card: GameCardInstance): boolean {
  return card.hidden === true && card.faceDown === true;
}

function replaceZone(snapshot: GameSnapshot, playerId: string, zone: GameZoneName, cards: GameCardInstance[]): OperationResult {
  return { status: 'applied', snapshot: replaceZoneSnapshotOnly(snapshot, playerId, zone, cards) };
}

function replaceVisibleZone(snapshot: GameSnapshot, playerId: string, zone: GameZoneName, cards: GameCardInstance[]): OperationResult {
  const player = snapshot.players[playerId];
  if (!player || !Array.isArray(player.zones[zone])) {
    return { status: 'failed', reason: 'target_not_found' };
  }

  return replaceZone(snapshot, playerId, zone, cards.map((card) => ({ ...card })));
}

function replaceZoneSnapshotOnly(snapshot: GameSnapshot, playerId: string, zone: GameZoneName, cards: GameCardInstance[]): GameSnapshot {
  const player = snapshot.players[playerId];
  const zones = ZONE_NAMES.reduce((nextZones, zoneName) => ({
    ...nextZones,
    [zoneName]: zoneName === zone ? cards : player.zones[zoneName],
  }), player.zones);

  return {
    ...snapshot,
    players: {
      ...snapshot.players,
      [playerId]: {
        ...player,
        zones,
      },
    },
  };
}

function updateChatMessage(snapshot: GameSnapshot, message: GameSnapshot['chat'][number]): OperationResult {
  const messageId = message.id;
  if (!messageId) {
    return { status: 'failed', reason: 'invalid_operation' };
  }

  const messageIndex = snapshot.chat.findIndex((entry) => entry.id === messageId);
  if (messageIndex < 0) {
    return { status: 'failed', reason: 'target_not_found' };
  }

  const nextChat = [...snapshot.chat];
  nextChat[messageIndex] = { ...message };

  return { status: 'applied', snapshot: { ...snapshot, chat: nextChat } };
}
