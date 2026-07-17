import { GameCardInstance, GameSnapshot } from '../../../../core/models/game.model';
import type { GameTableNormalizedV2State } from '../state/realtime/game-table-normalized-v2.store';
import {
  activeHandRevealCountForViewer,
  activeRevealPanelCardIds,
  activeRevealRecipients,
  activeHandRevealsForOwner,
  cardIsActivelyRevealedToViewer,
  isHandCardRevealedToViewer,
  opponentRevealIndicator,
  ownerSharedRevealIndicator,
  revealedHandCardsForViewer,
  revealedHandCountForViewer,
  sharedHandCardsByOwner,
  sharedHandUniqueCount,
  shouldShowRevealIndicator,
  viewersForSharedCard,
} from './active-hand-reveals';

describe('active hand reveal selectors', () => {
  it('derives owner and viewer-local active reveals without a redundant counter', () => {
    const snapshot = snapshotWithHand([
      card('a', ['player-2']),
      card('b', ['player-2', 'player-3']),
      card('c', ['all']),
      card('d', []),
      { ...card('hidden', ['player-2']), hidden: true },
    ]);

    expect(activeHandRevealsForOwner(snapshot, 'player-1').map((entry) => entry.instanceId)).toEqual(['a', 'b', 'c']);
    expect(activeHandRevealCountForViewer(snapshot, 'player-1', 'player-2')).toBe(3);
    expect(activeHandRevealCountForViewer(snapshot, 'player-1', 'player-3')).toBe(2);
    expect(revealedHandCardsForViewer(snapshot, 'player-1', 'player-2').map((entry) => entry.instanceId)).toEqual(['a', 'b', 'c']);
    expect(sharedHandCardsByOwner(snapshot, 'player-1').map((entry) => entry.instanceId)).toEqual(['a', 'b', 'c']);
    expect(viewersForSharedCard(snapshot, 'player-1', 'b')).toEqual(['player-2', 'player-3']);
    expect(revealedHandCountForViewer(snapshot, 'player-1', 'player-3')).toBe(2);
    expect(sharedHandUniqueCount(snapshot, 'player-1')).toBe(3);
    expect(isHandCardRevealedToViewer(card('c', ['all']), 'spectator')).toBe(true);
  });

  it('derives the same viewer-local model from normalized state without exposing placeholders', () => {
    const normalized = {
      zones: { 'player-1': { hand: ['real-a', 'opaque-1'] } },
      instances: {
        'real-a': { instanceId: 'real-a', hidden: false, revealedTo: ['player-2'] },
        'opaque-1': { instanceId: 'opaque-1', hidden: true, revealedTo: [] },
      },
    } as unknown as GameTableNormalizedV2State;

    expect(revealedHandCardsForViewer(normalized, 'player-1', 'player-2').map((entry) => entry.instanceId)).toEqual(['real-a']);
    expect(revealedHandCountForViewer(normalized, 'player-1', 'player-3')).toBe(0);
    expect(sharedHandUniqueCount(normalized, 'player-1')).toBe(1);
  });

  it('drops revoked, moved or concealed cards directly from authorized state', () => {
    expect(cardIsActivelyRevealedToViewer(card('revoked', []), 'player-2')).toBe(false);
    expect(cardIsActivelyRevealedToViewer({ ...card('concealed', ['player-2']), hidden: true }, 'player-2')).toBe(false);
    expect(activeHandRevealCountForViewer(snapshotWithHand([]), 'player-1', 'player-2')).toBe(0);
  });

  it('derives viewer-local and owner indicators while excluding self-only audiences', () => {
    const snapshot = snapshotWithHand([
      card('target-only', ['player-2']),
      card('third-only', ['player-3']),
      card('public', ['all']),
      card('self-only', ['player-1']),
    ]);

    expect(opponentRevealIndicator(snapshot, 'player-1', 'player-2')).toEqual({ count: 2, ownerMode: false, visible: true });
    expect(opponentRevealIndicator(snapshot, 'player-1', 'player-4')).toEqual({ count: 1, ownerMode: false, visible: true });
    expect(ownerSharedRevealIndicator(snapshot, 'player-1')).toEqual({ count: 3, ownerMode: true, visible: true });
    expect(shouldShowRevealIndicator(snapshot, 'player-1', 'player-3')).toBe(true);
    expect(shouldShowRevealIndicator(snapshotWithHand([]), 'player-1', 'player-2')).toBe(false);
  });

  it('returns panel IDs in hand order and never exposes recipients to a non-owner selector', () => {
    const snapshot = snapshotWithHand([
      card('first', ['player-2']),
      card('private-third', ['player-3']),
      card('public', ['all']),
    ]);

    expect(activeRevealPanelCardIds(snapshot, 'player-1', 'player-2')).toEqual(['first', 'public']);
    expect(activeRevealPanelCardIds(snapshot, 'player-1', 'player-1')).toEqual(['first', 'private-third', 'public']);
    expect(activeRevealRecipients(snapshot, 'player-1', 'first', 'player-2')).toEqual([]);
    expect(activeRevealRecipients(snapshot, 'player-1', 'first', 'player-1')).toEqual(['player-2']);
  });
});

function snapshotWithHand(hand: GameCardInstance[]): GameSnapshot {
  return {
    id: 'game-1', ownerId: 'player-1', version: 1, status: 'playing', gamePhase: 'PLAYING', currentTurn: 1,
    turn: { activePlayerId: 'player-1', phase: 'main-1', number: 1 }, chat: [], eventLog: [], stack: [], arrows: [], createdAt: '',
    players: {
      'player-1': {
        user: { id: 'player-1', email: 'p1@test', displayName: 'Alice', roles: [] }, status: 'active', life: 40,
        zones: { library: [], hand, battlefield: [], graveyard: [], exile: [], command: [] }, commanderDamage: {}, counters: {},
      },
    },
  } as GameSnapshot;
}

function card(instanceId: string, revealedTo: string[]): GameCardInstance {
  return {
    instanceId, ownerId: 'player-1', controllerId: 'player-1', name: instanceId, zone: 'hand', tapped: false,
    hidden: false, revealedTo,
  };
}
