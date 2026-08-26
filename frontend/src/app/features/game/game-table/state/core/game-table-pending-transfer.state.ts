import { Injectable, signal } from '@angular/core';
import { GameSnapshot, GameZoneName } from '../../../../../core/models/game.model';

interface PendingTransfer {
  key: string;
  playerId: string;
  fromZone: GameZoneName;
  instanceIds: readonly string[];
  sourceVersion: number | null;
  sourceZoneCount: number | null;
}

export interface PendingTransferRegistration {
  playerId: string;
  fromZone: GameZoneName;
  instanceIds?: readonly string[];
  sourceVersion?: number | null;
  sourceZoneCount?: number | null;
}

@Injectable()
export class GameTablePendingTransferState {
  private transfers: PendingTransfer[] = [];

  private readonly pendingCardKeys = signal<ReadonlySet<string>>(new Set());
  private readonly pendingZoneKeys = signal<ReadonlySet<string>>(new Set());

  register(registration: PendingTransferRegistration): void {
    const instanceIds = [...new Set(registration.instanceIds ?? [])];
    const key = this.transferKey(registration.playerId, registration.fromZone, instanceIds);
    this.removeTransfers((transfer) => transfer.key === key);
    this.transfers = [
      ...this.transfers,
      {
        key,
        playerId: registration.playerId,
        fromZone: registration.fromZone,
        instanceIds,
        sourceVersion: registration.sourceVersion ?? null,
        sourceZoneCount: registration.sourceZoneCount ?? null,
      },
    ];
    this.rebuildKeys();
  }

  reconcileSnapshot(snapshot: GameSnapshot | null): void {
    if (!snapshot || this.transfers.length === 0) {
      return;
    }

    this.removeTransfers((transfer) => {
      const sourceCards = snapshot.players[transfer.playerId]?.zones[transfer.fromZone] ?? [];
      const sourceZoneCount = snapshot.players[transfer.playerId]?.zoneCounts?.[transfer.fromZone] ?? sourceCards.length;
      if (transfer.fromZone === 'library'
        && transfer.sourceZoneCount !== null
        && sourceZoneCount < transfer.sourceZoneCount) {
        return true;
      }
      if (transfer.instanceIds.length === 0) {
        return !(transfer.sourceVersion !== null && snapshot.version <= transfer.sourceVersion);
      }

      const sourceIds = new Set(sourceCards.map((card) => card.instanceId));

      return !transfer.instanceIds.some((instanceId) => sourceIds.has(instanceId));
    });
  }

  clear(): void {
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

  private removeTransfers(predicate: (transfer: PendingTransfer) => boolean): void {
    const nextTransfers = this.transfers.filter((transfer) => !predicate(transfer));
    if (nextTransfers.length === this.transfers.length) {
      return;
    }
    this.transfers = nextTransfers;
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
