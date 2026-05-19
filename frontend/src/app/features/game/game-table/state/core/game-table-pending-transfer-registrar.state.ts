import { inject, Injectable } from '@angular/core';
import { GameCommandType, GameZoneName } from '../../../../../core/models/game.model';
import { GameTableDropFeedbackState } from '../drag-drop/game-table-drop-feedback.state';
import { GameTablePendingTransferState } from './game-table-pending-transfer.state';
import { GameTableCoreState } from './game-table-core.state';

@Injectable()
export class GameTablePendingTransferRegistrarState {
  private readonly core = inject(GameTableCoreState);
  private readonly dropFeedbackState = inject(GameTableDropFeedbackState);
  private readonly pendingTransferState = inject(GameTablePendingTransferState);

  register(type: GameCommandType, payload: Record<string, unknown>): void {
    switch (type) {
      case 'card.moved':
      case 'cards.moved':
        this.registerCardMovePendingTransfer(payload);
        return;
      case 'library.draw':
      case 'library.draw_many':
        this.registerLibraryTopPendingTransfer(payload, 'hand');
        return;
      case 'library.move_top':
        this.registerLibraryTopPendingTransfer(payload, payload['toZone']);
        return;
      case 'zone.move_all':
        this.registerZoneMoveAllPendingTransfer(payload);
        return;
    }
  }

  private registerCardMovePendingTransfer(payload: Record<string, unknown>): void {
    const playerId = this.stringPayload(payload, 'playerId');
    const fromZone = this.zonePayload(payload, 'fromZone');
    const toZone = this.zonePayload(payload, 'toZone');
    const targetPlayerId = this.stringPayload(payload, 'targetPlayerId') ?? playerId;
    const instanceIds = this.instanceIdsPayload(payload);
    if (!playerId || !fromZone || !toZone || instanceIds.length === 0) {
      return;
    }

    const moveTargetPlayerId = targetPlayerId ?? playerId;
    if (fromZone === toZone && playerId === moveTargetPlayerId) {
      return;
    }

    if (fromZone !== 'battlefield' && toZone === 'battlefield' && !this.areCardsInZone(moveTargetPlayerId, 'battlefield', instanceIds)) {
      this.dropFeedbackState.markPendingBattlefieldEntry(moveTargetPlayerId, instanceIds);
      if (fromZone === 'command') {
        this.dropFeedbackState.markPendingCommanderBattlefieldEntry(moveTargetPlayerId, instanceIds);
      }
    }

    this.pendingTransferState.register({
      playerId,
      fromZone,
      instanceIds,
      sourceVersion: this.core.snapshot()?.version ?? null,
    });
  }

  private registerLibraryTopPendingTransfer(payload: Record<string, unknown>, toZoneValue: unknown): void {
    const playerId = this.stringPayload(payload, 'playerId');
    const toZone = this.zoneValue(toZoneValue);
    if (!playerId || toZone === 'library') {
      return;
    }

    const targetPlayerId = this.stringPayload(payload, 'targetPlayerId') ?? playerId;
    const rawCount = Number(payload['count'] ?? 1);
    const count = Number.isFinite(rawCount) ? Math.max(1, Math.floor(rawCount)) : 1;
    const library = this.core.snapshot()?.players[playerId]?.zones.library ?? [];
    const instanceIds = library.slice(0, count).map((card) => card.instanceId);
    if (toZone === 'battlefield') {
      this.dropFeedbackState.markPendingBattlefieldEntry(targetPlayerId, instanceIds);
    }

    this.pendingTransferState.register({
      playerId,
      fromZone: 'library',
      instanceIds,
      sourceVersion: this.core.snapshot()?.version ?? null,
    });
  }

  private registerZoneMoveAllPendingTransfer(payload: Record<string, unknown>): void {
    const playerId = this.stringPayload(payload, 'playerId');
    const fromZone = this.zonePayload(payload, 'fromZone');
    const toZone = this.zonePayload(payload, 'toZone');
    if (!playerId || !fromZone || !toZone || fromZone === toZone) {
      return;
    }

    const instanceIds = this.core.snapshot()?.players[playerId]?.zones[fromZone]?.map((card) => card.instanceId) ?? [];
    if (toZone === 'battlefield') {
      this.dropFeedbackState.markPendingBattlefieldEntry(playerId, instanceIds);
    }

    this.pendingTransferState.register({
      playerId,
      fromZone,
      instanceIds,
      sourceVersion: this.core.snapshot()?.version ?? null,
    });
  }

  private instanceIdsPayload(payload: Record<string, unknown>): string[] {
    const instanceIds = payload['instanceIds'];
    if (Array.isArray(instanceIds)) {
      return instanceIds.filter((instanceId): instanceId is string => typeof instanceId === 'string' && instanceId !== '');
    }

    const instanceId = this.stringPayload(payload, 'instanceId');

    return instanceId ? [instanceId] : [];
  }

  private areCardsInZone(playerId: string | null, zone: GameZoneName, instanceIds: readonly string[]): boolean {
    if (!playerId) {
      return false;
    }

    const zoneCards = this.core.snapshot()?.players[playerId]?.zones[zone] ?? [];
    const zoneIds = new Set(zoneCards.map((card) => card.instanceId));

    return instanceIds.length > 0 && instanceIds.every((instanceId) => zoneIds.has(instanceId));
  }

  private stringPayload(payload: Record<string, unknown>, key: string): string | null {
    const value = payload[key];

    return typeof value === 'string' && value !== '' ? value : null;
  }

  private zonePayload(payload: Record<string, unknown>, key: string): GameZoneName | null {
    return this.zoneValue(payload[key]);
  }

  private zoneValue(value: unknown): GameZoneName | null {
    return typeof value === 'string' && this.core.zones.includes(value as GameZoneName) ? value as GameZoneName : null;
  }
}
