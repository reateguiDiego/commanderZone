import { Injectable } from '@angular/core';
import { GameAttachment, GameCardInstance, GameSnapshot } from '../../../../core/models/game.model';
import { gameplayCardKind, isDayNightCard, isGameplayCard, isTheRingCard } from '../utils/gameplay-card-kind';

export interface BattlefieldCardRef {
  readonly playerId: string;
  readonly card: GameCardInstance;
}

@Injectable()
export class GameTablePermanentRelationService {
  battlefieldCard(snapshot: GameSnapshot | null, instanceId: string): BattlefieldCardRef | null {
    if (!snapshot || !instanceId) {
      return null;
    }

    for (const [playerId, player] of Object.entries(snapshot.players)) {
      const card = player.zones.battlefield.find((candidate) => candidate.instanceId === instanceId);
      if (card) {
        return { playerId, card };
      }
    }

    return null;
  }

  battlefieldInstanceIds(snapshot: GameSnapshot | null, playerId?: string): ReadonlySet<string> {
    const ids = new Set<string>();
    if (!snapshot) {
      return ids;
    }

    const players = playerId ? [[playerId, snapshot.players[playerId]] as const] : Object.entries(snapshot.players);
    for (const [, player] of players) {
      for (const card of player?.zones.battlefield ?? []) {
        ids.add(card.instanceId);
      }
    }

    return ids;
  }

  attachmentForEquipment(snapshot: GameSnapshot | null, equipmentInstanceId: string): GameAttachment | null {
    return (snapshot?.attachments ?? []).find((attachment) => attachment.equipmentInstanceId === equipmentInstanceId) ?? null;
  }

  attachmentsForTarget(snapshot: GameSnapshot | null, attachedToInstanceId: string): readonly GameAttachment[] {
    return (snapshot?.attachments ?? []).filter((attachment) => attachment.attachedToInstanceId === attachedToInstanceId);
  }

  isAttachedEquipment(snapshot: GameSnapshot | null, equipmentInstanceId: string): boolean {
    return this.attachmentForEquipment(snapshot, equipmentInstanceId) !== null;
  }

  canAttachSource(snapshot: GameSnapshot | null, card: GameCardInstance | null | undefined): boolean {
    return !!card
      && !this.isLandPermanent(card)
      && !isDayNightCard(card)
      && !isGameplayCard(card)
      && this.attachmentsForTarget(snapshot, card.instanceId).length === 0;
  }

  canAttachTarget(card: GameCardInstance | null | undefined): boolean {
    return !!card && !isDayNightCard(card) && !isGameplayCard(card) && !isTheRingCard(card);
  }

  gameplayAttachmentError(card: GameCardInstance | null | undefined, role: 'source' | 'target'): string | null {
    if (isDayNightCard(card)) {
      return role === 'source'
        ? 'Day/Night cannot be attached to another permanent.'
        : 'Day/Night cannot be an attachment target.';
    }

    if (isTheRingCard(card)) {
      return role === 'target'
        ? 'The Ring cannot be an attachment target.'
        : null;
    }

    const kind = gameplayCardKind(card);
    if (kind === 'emblem') {
      return role === 'source'
        ? 'Emblems cannot be attached to another permanent.'
        : 'Emblems cannot be attachment targets.';
    }

    if (kind === 'monarch') {
      return role === 'source'
        ? 'Monarch cannot be attached to another permanent.'
        : 'Monarch cannot be an attachment target.';
    }

    if (kind === 'initiative') {
      return role === 'source'
        ? 'Initiative cannot be attached to another permanent.'
        : 'Initiative cannot be an attachment target.';
    }

    if (kind === 'dungeon') {
      return role === 'source'
        ? 'Dungeons cannot be attached to another permanent.'
        : 'Dungeons cannot be attachment targets.';
    }

    return null;
  }

  canEquipSource(card: GameCardInstance | null | undefined): boolean {
    return this.canAttachSource(null, card);
  }

  isLandPermanent(card: GameCardInstance | null | undefined): boolean {
    return /\bland\b/i.test(card?.typeLine ?? '');
  }

  relationHasBattlefieldEndpoints(snapshot: GameSnapshot | null, fromInstanceId: string, toInstanceId: string): boolean {
    return this.battlefieldCard(snapshot, fromInstanceId) !== null
      && this.battlefieldCard(snapshot, toInstanceId) !== null;
  }
}
