import { GameSnapshot } from '../../../../core/models/game.model';
import type { GameTableNormalizedV2State } from '../state/realtime/game-table-normalized-v2.store';

export interface AuthorizedHandRevealCard {
  readonly instanceId: string;
  readonly hidden?: boolean;
  readonly revealedTo?: readonly string[];
}

export interface ActiveHandReveal {
  readonly instanceId: string;
  readonly revealedTo: readonly string[];
}

export interface HandRevealIndicator {
  readonly count: number;
  readonly ownerMode: boolean;
  readonly visible: boolean;
}

export type ActiveHandRevealState = GameSnapshot | GameTableNormalizedV2State | null;

export function revealedHandCardsForViewer(
  state: ActiveHandRevealState,
  ownerPlayerId: string,
  viewerPlayerId: string,
): readonly AuthorizedHandRevealCard[] {
  return authorizedHandCards(state, ownerPlayerId)
    .filter((card) => isHandCardRevealedToViewer(card, viewerPlayerId));
}

export function sharedHandCardsByOwner(state: ActiveHandRevealState, ownerPlayerId: string): readonly ActiveHandReveal[] {
  return authorizedHandCards(state, ownerPlayerId)
    .filter((card) => !card.hidden && hasExternalAudience(card.revealedTo, ownerPlayerId))
    .map((card) => ({ instanceId: card.instanceId, revealedTo: [...(card.revealedTo ?? [])] }));
}

export function viewersForSharedCard(
  state: ActiveHandRevealState,
  ownerPlayerId: string,
  instanceId: string,
): readonly string[] {
  return sharedHandCardsByOwner(state, ownerPlayerId)
    .find((card) => card.instanceId === instanceId)?.revealedTo ?? [];
}

export function revealedHandCountForViewer(state: ActiveHandRevealState, ownerPlayerId: string, viewerPlayerId: string): number {
  return revealedHandCardsForViewer(state, ownerPlayerId, viewerPlayerId).length;
}

export function sharedHandUniqueCount(state: ActiveHandRevealState, ownerPlayerId: string): number {
  return sharedHandCardsByOwner(state, ownerPlayerId).length;
}

export function isHandCardRevealedToViewer(card: AuthorizedHandRevealCard, viewerPlayerId: string): boolean {
  if (card.hidden) {
    return false;
  }
  const audience = card.revealedTo ?? [];
  return audience.includes('all') || audience.includes(viewerPlayerId);
}

export function opponentRevealIndicator(
  state: ActiveHandRevealState,
  ownerPlayerId: string,
  viewerPlayerId: string,
): HandRevealIndicator {
  const count = revealedHandCountForViewer(state, ownerPlayerId, viewerPlayerId);

  return { count, ownerMode: false, visible: count > 0 };
}

export function ownerSharedRevealIndicator(state: ActiveHandRevealState, ownerPlayerId: string): HandRevealIndicator {
  const count = sharedHandUniqueCount(state, ownerPlayerId);

  return { count, ownerMode: true, visible: count > 0 };
}

export function activeRevealPanelCardIds(
  state: ActiveHandRevealState,
  ownerPlayerId: string,
  viewerPlayerId: string,
): readonly string[] {
  return ownerPlayerId === viewerPlayerId
    ? sharedHandCardsByOwner(state, ownerPlayerId).map((card) => card.instanceId)
    : revealedHandCardsForViewer(state, ownerPlayerId, viewerPlayerId).map((card) => card.instanceId);
}

export function activeRevealRecipients(
  state: ActiveHandRevealState,
  ownerPlayerId: string,
  instanceId: string,
  requestingViewerId: string,
): readonly string[] {
  return requestingViewerId === ownerPlayerId
    ? viewersForSharedCard(state, ownerPlayerId, instanceId)
    : [];
}

export function shouldShowRevealIndicator(
  state: ActiveHandRevealState,
  ownerPlayerId: string,
  viewerPlayerId: string,
): boolean {
  return (ownerPlayerId === viewerPlayerId
    ? ownerSharedRevealIndicator(state, ownerPlayerId)
    : opponentRevealIndicator(state, ownerPlayerId, viewerPlayerId)).visible;
}

// Compatibility names retained for the existing 4D callers.
export const activeHandRevealsForOwner = sharedHandCardsByOwner;
export const activeHandRevealCountForViewer = revealedHandCountForViewer;
export const cardIsActivelyRevealedToViewer = isHandCardRevealedToViewer;

function authorizedHandCards(state: ActiveHandRevealState, ownerPlayerId: string): readonly AuthorizedHandRevealCard[] {
  if (!state) {
    return [];
  }
  if ('instances' in state && 'zones' in state) {
    return (state.zones[ownerPlayerId]?.hand ?? [])
      .map((instanceId) => state.instances[instanceId])
      .filter((card): card is NonNullable<typeof card> => Boolean(card));
  }
  return state.players[ownerPlayerId]?.zones.hand ?? [];
}

function hasExternalAudience(audience: readonly string[] | undefined, ownerPlayerId: string): boolean {
  return audience?.some((viewerId) => viewerId === 'all' || viewerId !== ownerPlayerId) ?? false;
}
