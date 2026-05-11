import { Injectable, OnDestroy, signal } from '@angular/core';
import { GameCardInstance, GameSnapshot, GameZoneName } from '../../../../core/models/game.model';

interface IndexedCard {
  playerId: string;
  zone: GameZoneName;
  instanceId: string;
  positionKey: string;
}

@Injectable()
export class GameTableDropFeedbackState implements OnDestroy {
  private readonly feedbackDurationMs = 520;
  private readonly battlefieldEntryFeedbackDurationMs = 900;
  private readonly zoneFeedbackDurationMs = 2400;
  private previousVersion: number | null = null;
  private previousCards = new Map<string, IndexedCard>();
  private readonly timers = new Map<string, number>();
  private readonly pendingManaDrops = new Set<string>();

  private readonly activeCardKeys = signal<ReadonlySet<string>>(new Set());
  private readonly activeManaKeys = signal<ReadonlySet<string>>(new Set());
  private readonly activeZoneKeys = signal<ReadonlySet<string>>(new Set());
  private readonly activeBattlefieldEntryKeys = signal<ReadonlySet<string>>(new Set());

  trackSnapshot(snapshot: GameSnapshot | null): void {
    if (!snapshot) {
      this.previousVersion = null;
      this.previousCards = new Map();
      this.pendingManaDrops.clear();
      this.clearAllFeedback();
      return;
    }

    const nextCards = this.indexSnapshot(snapshot);
    if (this.previousVersion === null) {
      this.previousVersion = snapshot.version;
      this.previousCards = nextCards;
      return;
    }

    if (snapshot.version === this.previousVersion) {
      return;
    }

    this.recordSnapshotChanges(this.previousCards, nextCards);
    this.previousVersion = snapshot.version;
    this.previousCards = nextCards;
  }

  markPendingManaDrop(playerId: string, instanceIds: readonly string[]): void {
    for (const instanceId of instanceIds) {
      this.pendingManaDrops.add(this.manaPendingKey(playerId, instanceId));
    }
  }

  isCardDropSettling(playerId: string, zone: GameZoneName, instanceId: string): boolean {
    return this.activeCardKeys().has(this.cardKey(playerId, zone, instanceId));
  }

  isManaDropSettling(playerId: string, instanceId: string): boolean {
    return this.activeManaKeys().has(this.manaKey(playerId, instanceId));
  }

  isBattlefieldEntrySettling(playerId: string, instanceId: string): boolean {
    return this.activeBattlefieldEntryKeys().has(this.manaKey(playerId, instanceId));
  }

  isZoneDropSettling(playerId: string, zone: GameZoneName): boolean {
    return this.activeZoneKeys().has(this.zoneKey(playerId, zone));
  }

  destroy(): void {
    this.clearAllFeedback();
  }

  ngOnDestroy(): void {
    this.destroy();
  }

  private recordSnapshotChanges(previousCards: ReadonlyMap<string, IndexedCard>, nextCards: ReadonlyMap<string, IndexedCard>): void {
    const consumedManaDrops = new Set<string>();

    for (const [key, nextCard] of nextCards) {
      const previousCard = previousCards.get(key);
      if (!previousCard) {
        this.activateEnteredCard(nextCard);
        this.activateBattlefieldEntryIfNeeded(previousCards, nextCard);
        this.collectManaDrop(nextCard, consumedManaDrops);
        continue;
      }

      if (nextCard.zone === 'battlefield' && previousCard.positionKey !== nextCard.positionKey) {
        this.activateCard(nextCard);
        this.collectManaDrop(nextCard, consumedManaDrops);
      }
    }

    for (const key of consumedManaDrops) {
      this.pendingManaDrops.delete(key);
    }
  }

  private activateEnteredCard(card: IndexedCard): void {
    if (card.zone === 'battlefield' || card.zone === 'hand') {
      this.activateCard(card);
      return;
    }

    this.activateZone(card.playerId, card.zone);
  }

  private activateCard(card: IndexedCard): void {
    this.activateKey(this.activeCardKeys, this.cardKey(card.playerId, card.zone, card.instanceId), 'card');
  }

  private collectManaDrop(card: IndexedCard, consumedManaDrops: Set<string>): void {
    if (card.zone !== 'battlefield') {
      return;
    }

    const pendingKey = this.manaPendingKey(card.playerId, card.instanceId);
    if (!this.pendingManaDrops.has(pendingKey)) {
      return;
    }

    consumedManaDrops.add(pendingKey);
    this.activateKey(this.activeManaKeys, this.manaKey(card.playerId, card.instanceId), 'mana');
  }

  private activateBattlefieldEntryIfNeeded(previousCards: ReadonlyMap<string, IndexedCard>, card: IndexedCard): void {
    if (card.zone !== 'battlefield') {
      return;
    }

    const previousCard = Array.from(previousCards.values())
      .find((candidate) => candidate.playerId === card.playerId && candidate.instanceId === card.instanceId);
    if (!previousCard || previousCard.zone === 'battlefield') {
      return;
    }

    this.activateKey(
      this.activeBattlefieldEntryKeys,
      this.manaKey(card.playerId, card.instanceId),
      'battlefield-entry',
      this.battlefieldEntryFeedbackDurationMs,
    );
  }

  private activateZone(playerId: string, zone: GameZoneName): void {
    this.activateKey(this.activeZoneKeys, this.zoneKey(playerId, zone), 'zone', this.zoneFeedbackDurationMs);
  }

  private activateKey(
    target: typeof this.activeCardKeys,
    key: string,
    timerPrefix: 'card' | 'mana' | 'zone' | 'battlefield-entry',
    durationMs = this.feedbackDurationMs,
  ): void {
    target.update((keys) => {
      const next = new Set(keys);
      next.add(key);
      return next;
    });

    const timerKey = `${timerPrefix}:${key}`;
    const existingTimer = this.timers.get(timerKey);
    if (existingTimer !== undefined) {
      window.clearTimeout(existingTimer);
    }

    const timer = window.setTimeout(() => {
      target.update((keys) => {
        if (!keys.has(key)) {
          return keys;
        }

        const next = new Set(keys);
        next.delete(key);
        return next;
      });
      this.timers.delete(timerKey);
    }, durationMs);
    this.timers.set(timerKey, timer);
  }

  private clearAllFeedback(): void {
    for (const timer of this.timers.values()) {
      window.clearTimeout(timer);
    }
    this.timers.clear();
    this.activeCardKeys.set(new Set());
    this.activeManaKeys.set(new Set());
    this.activeZoneKeys.set(new Set());
    this.activeBattlefieldEntryKeys.set(new Set());
  }

  private indexSnapshot(snapshot: GameSnapshot): Map<string, IndexedCard> {
    const cards = new Map<string, IndexedCard>();
    for (const [playerId, player] of Object.entries(snapshot.players)) {
      for (const [zone, zoneCards] of Object.entries(player.zones) as Array<[GameZoneName, GameCardInstance[]]>) {
        for (const card of zoneCards) {
          const indexed = {
            playerId,
            zone,
            instanceId: card.instanceId,
            positionKey: this.positionKey(card),
          };
          cards.set(this.cardKey(playerId, zone, card.instanceId), indexed);
        }
      }
    }

    return cards;
  }

  private positionKey(card: GameCardInstance): string {
    return card.position ? `${card.position.x}:${card.position.y}` : '';
  }

  private cardKey(playerId: string, zone: GameZoneName, instanceId: string): string {
    return `${playerId}:${zone}:${instanceId}`;
  }

  private manaKey(playerId: string, instanceId: string): string {
    return `${playerId}:${instanceId}`;
  }

  private manaPendingKey(playerId: string, instanceId: string): string {
    return this.manaKey(playerId, instanceId);
  }

  private zoneKey(playerId: string, zone: GameZoneName): string {
    return `${playerId}:${zone}`;
  }
}
