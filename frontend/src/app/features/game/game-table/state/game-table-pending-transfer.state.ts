import { Injectable, signal } from '@angular/core';
import { GameSnapshot, GameZoneName } from '../../../../core/models/game.model';

interface PendingTransfer {
  id: number;
  key: string;
  playerId: string;
  fromZone: GameZoneName;
  instanceIds: readonly string[];
  sourceVersion: number | null;
}

export interface PendingTransferExpiration {
  playerId: string;
  fromZone: GameZoneName;
  instanceIds: readonly string[];
}

export interface PendingTransferRegistration {
  playerId: string;
  fromZone: GameZoneName;
  instanceIds?: readonly string[];
  sourceVersion?: number | null;
  expires?: boolean;
}

@Injectable()
export class GameTablePendingTransferState {
  private readonly transferTimeoutMs = 1000;
  private nextId = 1;
  private transfers: PendingTransfer[] = [];
  private expirationHandler: ((expiration: PendingTransferExpiration) => void) | null = null;
  private readonly transferTimers = new Map<number, number>();

  private readonly pendingCardKeys = signal<ReadonlySet<string>>(new Set());
  private readonly pendingZoneKeys = signal<ReadonlySet<string>>(new Set());

  setExpirationHandler(handler: ((expiration: PendingTransferExpiration) => void) | null): void {
    this.expirationHandler = handler;
  }

  register(registration: PendingTransferRegistration): void {
    const instanceIds = [...new Set(registration.instanceIds ?? [])];
    const key = this.transferKey(registration.playerId, registration.fromZone, instanceIds);
    this.removeTransfers((transfer) => transfer.key === key);
    const id = this.nextId;
    this.transfers = [
      ...this.transfers,
      {
        id,
        key,
        playerId: registration.playerId,
        fromZone: registration.fromZone,
        instanceIds,
        sourceVersion: registration.sourceVersion ?? null,
      },
    ];
    this.nextId += 1;
    if (registration.expires !== false) {
      this.scheduleExpiration(id);
    }
    this.rebuildKeys();
  }

  reconcileSnapshot(snapshot: GameSnapshot | null): void {
    if (!snapshot || this.transfers.length === 0) {
      return;
    }

    this.removeTransfers((transfer) => {
      const sourceCards = snapshot.players[transfer.playerId]?.zones[transfer.fromZone] ?? [];
      if (transfer.instanceIds.length === 0) {
        return !(transfer.sourceVersion !== null && snapshot.version <= transfer.sourceVersion);
      }

      const sourceIds = new Set(sourceCards.map((card) => card.instanceId));

      return !transfer.instanceIds.some((instanceId) => sourceIds.has(instanceId));
    });
  }

  clear(): void {
    for (const timer of this.transferTimers.values()) {
      window.clearTimeout(timer);
    }
    this.transferTimers.clear();
    this.transfers = [];
    this.rebuildKeys();
  }

  isCardPending(playerId: string, zone: GameZoneName, instanceId: string): boolean {
    return this.pendingCardKeys().has(this.cardKey(playerId, zone, instanceId));
  }

  isZonePending(playerId: string, zone: GameZoneName): boolean {
    return this.pendingZoneKeys().has(this.zoneKey(playerId, zone));
  }

  private rebuildKeys(): void {
    const cardKeys = new Set<string>();
    const zoneKeys = new Set<string>();

    for (const transfer of this.transfers) {
      zoneKeys.add(this.zoneKey(transfer.playerId, transfer.fromZone));
      for (const instanceId of transfer.instanceIds) {
        cardKeys.add(this.cardKey(transfer.playerId, transfer.fromZone, instanceId));
      }
    }

    this.pendingCardKeys.set(cardKeys);
    this.pendingZoneKeys.set(zoneKeys);
  }

  private scheduleExpiration(id: number): void {
    const timer = window.setTimeout(() => {
      this.expireTransfer(id);
    }, this.transferTimeoutMs);
    this.transferTimers.set(id, timer);
  }

  private expireTransfer(id: number): void {
    const transfer = this.transfers.find((candidate) => candidate.id === id);
    if (!transfer) {
      return;
    }

    this.removeTransfers((candidate) => candidate.id === id);
    this.expirationHandler?.({
      playerId: transfer.playerId,
      fromZone: transfer.fromZone,
      instanceIds: transfer.instanceIds,
    });
  }

  private removeTransfers(predicate: (transfer: PendingTransfer) => boolean): void {
    const removedIds = new Set(this.transfers.filter(predicate).map((transfer) => transfer.id));
    if (removedIds.size === 0) {
      return;
    }

    for (const id of removedIds) {
      const timer = this.transferTimers.get(id);
      if (timer !== undefined) {
        window.clearTimeout(timer);
        this.transferTimers.delete(id);
      }
    }

    this.transfers = this.transfers.filter((transfer) => !removedIds.has(transfer.id));
    this.rebuildKeys();
  }

  private cardKey(playerId: string, zone: GameZoneName, instanceId: string): string {
    return `${playerId}:${zone}:${instanceId}`;
  }

  private zoneKey(playerId: string, zone: GameZoneName): string {
    return `${playerId}:${zone}`;
  }

  private transferKey(playerId: string, zone: GameZoneName, instanceIds: readonly string[]): string {
    return `${this.zoneKey(playerId, zone)}:${[...instanceIds].sort().join('|')}`;
  }
}
