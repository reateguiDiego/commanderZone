import { Injectable, inject } from '@angular/core';
import { GameCardInstance, GameSnapshot, GameZoneName } from '../../../../core/models/game.model';
import { GameTableBattlefieldDragState } from '../state/game-table-battlefield-drag.state';
import { GameTableDragService } from './game-table-drag.service';

interface BattlefieldDragSelection {
  playerId: string;
  zone: GameZoneName;
  card: GameCardInstance;
}

interface AlignmentCandidate {
  y: number;
  distance: number;
}

export interface GameTableBattlefieldDragContext {
  zones: readonly GameZoneName[];
  snapshot(): GameSnapshot | null;
  selectedCards(): readonly BattlefieldDragSelection[];
  findCard(playerId: string, zone: GameZoneName, instanceId: string): GameCardInstance | null;
  updateLocalCardPosition(playerId: string, instanceId: string, position: { x: number; y: number }): void;
}

@Injectable()
export class GameTableBattlefieldDragCoordinatorService {
  private readonly drag = inject(GameTableDragService);
  private readonly state = inject(GameTableBattlefieldDragState);
  private readonly battlefieldAlignmentGuideThreshold = 12;
  private readonly battlefieldAlignmentSnapThreshold = 12;

  updateBattlefieldDragAid(event: PointerEvent, instanceId: string, context: GameTableBattlefieldDragContext): void {
    const selected = context.selectedCards()[0];
    if (!selected || selected.zone !== 'battlefield' || selected.card.instanceId !== instanceId) {
      this.state.clearManaLaneAndAlignment();
      return;
    }

    if (!this.isPointerInsidePlayerBattlefield(event, selected.playerId)) {
      this.state.clearManaLaneAndAlignment();
      return;
    }

    if (this.isPointerNearManaLane(event, selected.playerId)) {
      this.state.setManaLaneDropPlayer(selected.playerId);
      this.state.setAlignmentGuide(null);
      return;
    }

    this.state.setManaLaneDropPlayer(null);
    const card = context.findCard(selected.playerId, 'battlefield', instanceId);
    const position = card?.position;
    const guide = position ? this.battlefieldDragGuide(context, selected.playerId, instanceId, position.y) : null;
    if (!position || !guide) {
      this.state.setAlignmentGuide(null);
      return;
    }

    this.state.setAlignmentGuide({ playerId: selected.playerId, y: guide.y });
    context.updateLocalCardPosition(selected.playerId, instanceId, { x: position.x, y: guide.y });
  }

  positionWithAlignmentGuide(
    context: GameTableBattlefieldDragContext,
    playerId: string,
    instanceId: string,
    position: { x: number; y: number },
    activeGuideY: number | null = null,
  ): { x: number; y: number } {
    if (activeGuideY !== null) {
      return Math.abs(activeGuideY - position.y) <= this.battlefieldAlignmentSnapThreshold ? { ...position, y: activeGuideY } : position;
    }

    const guide = this.nearestBattlefieldRow(context, playerId, instanceId, position.y, this.battlefieldAlignmentSnapThreshold);

    return guide ? { ...position, y: guide.y } : position;
  }

  updatePointerDropTarget(event: PointerEvent, context: GameTableBattlefieldDragContext): void {
    const selected = context.selectedCards()[0];
    if (!selected) {
      this.state.setActiveDropTarget(null);
      this.state.setActivePlayerDropTarget(null);
      return;
    }

    const targetPlayerId = this.playerDropTargetAt(event, selected.playerId);
    if (targetPlayerId) {
      this.state.setActivePlayerDropTarget(targetPlayerId);
      this.state.setActiveDropTarget(null);
      return;
    }

    this.state.setActivePlayerDropTarget(null);
    const zone = this.drag.pointerDropZone(event, selected.playerId, [...context.zones]);
    this.state.setActiveDropTarget(zone ? { playerId: selected.playerId, zone } : null);
  }

  updateActiveDropTarget(event: DragEvent, context: GameTableBattlefieldDragContext): void {
    const dragged = this.drag.dragPayload(event, [...context.zones]);

    for (const element of document.elementsFromPoint(event.clientX, event.clientY)) {
      const playerTarget = element.closest<HTMLElement>('[data-player-drop-target]');
      const dropPlayerId = playerTarget?.dataset['playerDropTarget'];
      if (dropPlayerId && dragged && dragged.playerId !== dropPlayerId) {
        this.state.setActivePlayerDropTarget(dropPlayerId);
        this.state.setActiveDropTarget(null);
        this.state.setManaLaneDropPlayer(null);
        return;
      }

      const target = element.closest<HTMLElement>('[data-game-drop-zone]');
      const playerId = target?.dataset['playerId'];
      const zone = target?.dataset['zone'];
      this.state.setActivePlayerDropTarget(null);
      if (playerId && zone === 'mana') {
        this.state.setManaLaneDropPlayer(playerId);
        this.state.setActiveDropTarget(null);
        return;
      }
      if (playerId && dragged?.zone === 'hand' && zone === 'battlefield') {
        this.state.setManaLaneDropPlayer(playerId);
      } else {
        this.state.setManaLaneDropPlayer(null);
      }
      if (playerId && this.isGameZone(zone, context.zones)) {
        this.state.setActiveDropTarget({ playerId, zone });
        return;
      }
    }

    this.state.clearDropTargets();
  }

  isPointerInsidePlayerBattlefield(event: PointerEvent, playerId: string): boolean {
    return this.elementsAtPoint(event).some((element) => {
      const battlefield = element.closest<HTMLElement>('.battlefield');

      return battlefield?.dataset['playerId'] === playerId;
    });
  }

  playerDropTargetAt(event: PointerEvent, sourcePlayerId: string): string | null {
    for (const element of document.elementsFromPoint(event.clientX, event.clientY)) {
      const target = element.closest<HTMLElement>('[data-player-drop-target]');
      const targetPlayerId = target?.dataset['playerDropTarget'];
      if (targetPlayerId && targetPlayerId !== sourcePlayerId) {
        return targetPlayerId;
      }
    }

    return null;
  }

  private battlefieldDragGuide(
    context: GameTableBattlefieldDragContext,
    playerId: string,
    instanceId: string,
    y: number,
  ): AlignmentCandidate | null {
    return this.nearestBattlefieldRow(context, playerId, instanceId, y, this.battlefieldAlignmentGuideThreshold);
  }

  private nearestBattlefieldRow(
    context: GameTableBattlefieldDragContext,
    playerId: string,
    instanceId: string,
    y: number,
    threshold: number,
  ): AlignmentCandidate | null {
    const snapshotRows = context.snapshot()?.players[playerId]?.zones.battlefield
      .filter((card) => card.instanceId !== instanceId)
      .map((card) => card.position?.y)
      .filter((candidate): candidate is number => typeof candidate === 'number')
      .filter((candidate) => !this.isManaLaneRow(playerId, candidate)) ?? [];
    const rows = [...snapshotRows, ...this.battlefieldDomRows(context, playerId, instanceId)];
    const nearest = rows
      .map((candidate) => ({ y: candidate, distance: Math.abs(candidate - y) }))
      .sort((left, right) => left.distance - right.distance)[0];

    return nearest && nearest.distance <= threshold ? nearest : null;
  }

  private battlefieldDomRows(context: GameTableBattlefieldDragContext, playerId: string, instanceId: string): number[] {
    const positionedInstanceIds = new Set((context.snapshot()?.players[playerId]?.zones.battlefield ?? [])
      .filter((card) => card.instanceId !== instanceId && card.position)
      .map((card) => card.instanceId));
    const battlefield = Array.from(document.querySelectorAll<HTMLElement>('.battlefield'))
      .find((element) => element.dataset['playerId'] === playerId);
    if (!battlefield) {
      return [];
    }

    const rows = Array.from(battlefield.querySelectorAll<HTMLElement>('[data-testid="game-card"][data-zone="battlefield"]'))
      .filter((element) => element.dataset['cardInstanceId'] !== instanceId)
      .filter((element) => !positionedInstanceIds.has(element.dataset['cardInstanceId'] ?? ''))
      .filter((element) => element.getClientRects().length > 0)
      .map((element) => element.offsetTop)
      .filter((row) => !this.isManaLaneRow(playerId, row));

    return [...new Set(rows)];
  }

  private isManaLaneRow(playerId: string, rowY: number): boolean {
    const battlefield = Array.from(document.querySelectorAll<HTMLElement>('.battlefield'))
      .find((element) => element.dataset['playerId'] === playerId);
    const manaLane = battlefield?.querySelector<HTMLElement>('[data-mana-lane]');
    if (!manaLane) {
      return false;
    }

    return rowY >= manaLane.offsetTop - 4;
  }

  private isPointerNearManaLane(event: PointerEvent, playerId: string): boolean {
    const manaLane = this.elementsAtPoint(event)
      .map((element) => element.closest<HTMLElement>('[data-mana-lane]'))
      .find((element) => element?.dataset['playerId'] === playerId);
    if (!manaLane) {
      return false;
    }

    const bounds = manaLane.getBoundingClientRect();
    const activationInset = 10;

    return event.clientY >= bounds.top + activationInset;
  }

  private elementsAtPoint(event: PointerEvent): Element[] {
    return document.elementsFromPoint(event.clientX, event.clientY);
  }

  private isGameZone(zone: string | undefined, zones: readonly GameZoneName[]): zone is GameZoneName {
    return zone !== undefined && zones.includes(zone as GameZoneName);
  }
}
