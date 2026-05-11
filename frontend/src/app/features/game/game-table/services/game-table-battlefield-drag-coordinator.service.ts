import { Injectable, inject } from '@angular/core';
import { GameCardInstance, GameSnapshot, GameZoneName } from '../../../../core/models/game.model';
import { GameTableBattlefieldDragState } from '../state/game-table-battlefield-drag.state';
import { GameTableDragService } from './game-table-drag.service';
import { GameTablePointerDragService } from './game-table-pointer-drag.service';

interface BattlefieldDragSelection {
  playerId: string;
  zone: GameZoneName;
  card: GameCardInstance;
}

interface AlignmentCandidate {
  y: number;
  distance: number;
  referenceInstanceIds: readonly string[];
}

interface AlignmentRow {
  y: number;
  referenceInstanceIds: readonly string[];
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
  private readonly pointerDrag = inject(GameTablePointerDragService);
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

    const card = context.findCard(selected.playerId, 'battlefield', instanceId);
    const position = card?.position;

    if (this.isPointerNearManaLane(event, selected.playerId, instanceId, position)) {
      this.state.setManaLaneDropPlayer(selected.playerId);
      this.state.setAlignmentGuide(null);
      const manaY = this.manaLaneY(selected.playerId);
      if (position && manaY !== null) {
        context.updateLocalCardPosition(selected.playerId, instanceId, { x: position.x, y: manaY });
      }
      return;
    }

    this.state.setManaLaneDropPlayer(null);
    const guide = position ? this.battlefieldDragGuide(context, selected.playerId, instanceId, position.y) : null;
    if (!position || !guide) {
      this.state.setAlignmentGuide(null);
      return;
    }

    this.state.setAlignmentGuide({
      playerId: selected.playerId,
      y: guide.y,
      referenceInstanceIds: guide.referenceInstanceIds,
    });
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

  positionWithManaLane(playerId: string, position: { x: number; y: number }): { x: number; y: number } {
    const y = this.manaLaneY(playerId);

    return y === null ? position : { ...position, y };
  }

  updateExternalBattlefieldAlignmentGuide(
    context: GameTableBattlefieldDragContext,
    playerId: string,
    instanceId: string,
    position: { x: number; y: number } | null | undefined,
  ): { x: number; y: number } | null {
    if (!position) {
      this.state.setAlignmentGuide(null);
      return null;
    }

    const guide = this.battlefieldDragGuide(context, playerId, instanceId, position.y);
    if (!guide) {
      this.state.setAlignmentGuide(null);
      return position;
    }

    this.state.setAlignmentGuide({
      playerId,
      y: guide.y,
      referenceInstanceIds: guide.referenceInstanceIds,
    });

    return { ...position, y: guide.y };
  }

  updatePointerDropTarget(event: PointerEvent, context: GameTableBattlefieldDragContext): void {
    const selected = context.selectedCards()[0];
    if (!selected) {
      this.state.setActiveDropTarget(null);
      this.state.setActivePlayerDropTarget(null);
      this.state.clearHandDropPreview();
      return;
    }

    const targetPlayerId = this.playerDropTargetAt(event, selected.playerId);
    if (targetPlayerId) {
      this.state.setActivePlayerDropTarget(targetPlayerId);
      this.state.setActiveDropTarget(null);
      this.state.clearHandDropPreview();
      return;
    }

    this.state.setActivePlayerDropTarget(null);
    const zone = this.drag.pointerDropZone(event, selected.playerId, [...context.zones]);
    this.state.setActiveDropTarget(zone ? { playerId: selected.playerId, zone } : null);
    if (zone === 'hand') {
      this.setHandDropPreviewAt(event.clientX, selected.playerId, selected.card.instanceId, context);
    } else {
      this.state.clearHandDropPreview();
    }
  }

  updateHandDropPreview(event: DragEvent, targetPlayerId: string, context: GameTableBattlefieldDragContext): void {
    const dragged = this.drag.dragPayload(event, [...context.zones]);
    this.setHandDropPreviewAt(event.clientX, targetPlayerId, dragged?.instanceId ?? '', context);
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
        this.state.clearHandDropPreview();
        return;
      }

      const target = element.closest<HTMLElement>('[data-game-drop-zone]');
      const playerId = target?.dataset['playerId'];
      const zone = target?.dataset['zone'];
      this.state.setActivePlayerDropTarget(null);
      if (playerId && zone === 'mana') {
        this.state.setManaLaneDropPlayer(playerId);
        this.state.setAlignmentGuide(null);
        this.state.setActiveDropTarget(null);
        this.state.clearHandDropPreview();
        return;
      }
      if (playerId && dragged?.zone === 'hand' && zone === 'battlefield') {
        this.state.setManaLaneDropPlayer(playerId);
      } else {
        this.state.setManaLaneDropPlayer(null);
      }
      if (playerId && this.isGameZone(zone, context.zones)) {
        this.state.setActiveDropTarget({ playerId, zone });
        if (zone === 'hand') {
          this.updateHandDropPreview(event, playerId, context);
        } else if (zone === 'battlefield' && dragged?.zone !== 'battlefield') {
          this.updateExternalBattlefieldAlignmentGuide(
            context,
            playerId,
            dragged?.instanceId ?? '',
            this.drag.dropPosition(event, 'battlefield'),
          );
        } else {
          this.state.setAlignmentGuide(null);
          this.state.clearHandDropPreview();
        }
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
    const rows = this.mergeAlignmentRows([
      ...this.snapshotAlignmentRows(context, playerId, instanceId),
      ...this.battlefieldDomRows(context, playerId, instanceId),
    ]);
    const nearest = rows
      .map((candidate) => ({
        y: candidate.y,
        distance: Math.abs(candidate.y - y),
        referenceInstanceIds: candidate.referenceInstanceIds,
      }))
      .sort((left, right) => left.distance - right.distance)[0];

    return nearest && nearest.distance <= threshold ? nearest : null;
  }

  private snapshotAlignmentRows(context: GameTableBattlefieldDragContext, playerId: string, instanceId: string): AlignmentRow[] {
    return context.snapshot()?.players[playerId]?.zones.battlefield
      .filter((card) => card.instanceId !== instanceId)
      .filter((card) => typeof card.position?.y === 'number')
      .map((card) => ({ y: card.position?.y ?? 0, referenceInstanceIds: [card.instanceId] }))
      .filter((candidate) => !this.isManaLaneRow(playerId, candidate.y)) ?? [];
  }

  private battlefieldDomRows(context: GameTableBattlefieldDragContext, playerId: string, instanceId: string): AlignmentRow[] {
    const positionedInstanceIds = new Set((context.snapshot()?.players[playerId]?.zones.battlefield ?? [])
      .filter((card) => card.instanceId !== instanceId && card.position)
      .map((card) => card.instanceId));
    const battlefield = Array.from(document.querySelectorAll<HTMLElement>('.battlefield'))
      .find((element) => element.dataset['playerId'] === playerId);
    if (!battlefield) {
      return [];
    }

    return Array.from(battlefield.querySelectorAll<HTMLElement>('[data-testid="game-card"][data-zone="battlefield"]'))
      .filter((element) => element.dataset['cardInstanceId'] !== instanceId)
      .filter((element) => !positionedInstanceIds.has(element.dataset['cardInstanceId'] ?? ''))
      .filter((element) => element.getClientRects().length > 0)
      .map((element) => ({
        y: element.offsetTop,
        referenceInstanceIds: element.dataset['cardInstanceId'] ? [element.dataset['cardInstanceId']] : [],
      }))
      .filter((row) => row.referenceInstanceIds.length > 0)
      .filter((row) => !this.isManaLaneRow(playerId, row.y));
  }

  private mergeAlignmentRows(rows: readonly AlignmentRow[]): AlignmentRow[] {
    const grouped = new Map<number, Set<string>>();
    for (const row of rows) {
      const references = grouped.get(row.y) ?? new Set<string>();
      for (const instanceId of row.referenceInstanceIds) {
        references.add(instanceId);
      }
      grouped.set(row.y, references);
    }

    return Array.from(grouped.entries()).map(([y, referenceInstanceIds]) => ({
      y,
      referenceInstanceIds: [...referenceInstanceIds],
    }));
  }

  private isManaLaneRow(playerId: string, rowY: number): boolean {
    const manaLane = this.manaLaneElement(playerId);
    if (!manaLane) {
      return false;
    }

    return rowY >= manaLane.offsetTop - 4;
  }

  private manaLaneY(playerId: string): number | null {
    const manaLane = this.manaLaneElement(playerId);

    return manaLane ? Math.round(manaLane.offsetTop + 8) : null;
  }

  private manaLaneElement(playerId: string): HTMLElement | null {
    const battlefield = this.battlefieldElement(playerId);

    return battlefield?.querySelector<HTMLElement>('[data-mana-lane]') ?? null;
  }

  private battlefieldElement(playerId: string): HTMLElement | null {
    return Array.from(document.querySelectorAll<HTMLElement>('.battlefield'))
      .find((element) => element.dataset['playerId'] === playerId) ?? null;
  }

  private isPointerNearManaLane(
    event: PointerEvent,
    playerId: string,
    instanceId: string,
    position: { x: number; y: number } | null | undefined,
  ): boolean {
    const manaLane = this.manaLaneElement(playerId);
    if (!manaLane) {
      return false;
    }

    const bounds = manaLane.getBoundingClientRect();
    const activationInset = 10;

    const pointerIsInsideLane = event.clientX >= bounds.left
      && event.clientX <= bounds.right
      && event.clientY >= bounds.top + activationInset
      && event.clientY <= bounds.bottom + 16;

    return pointerIsInsideLane || this.draggedCardOverlapsManaLane(playerId, instanceId, position, bounds);
  }

  private draggedCardOverlapsManaLane(
    playerId: string,
    instanceId: string,
    position: { x: number; y: number } | null | undefined,
    manaLaneBounds: DOMRect,
  ): boolean {
    if (!position) {
      return false;
    }

    const battlefield = this.battlefieldElement(playerId);
    if (!battlefield) {
      return false;
    }

    const cardElement = Array.from(battlefield.querySelectorAll<HTMLElement>('[data-testid="game-card"][data-zone="battlefield"]'))
      .find((element) => element.dataset['cardInstanceId'] === instanceId);
    const battlefieldBounds = battlefield.getBoundingClientRect();
    const cardWidth = cardElement?.offsetWidth || cardElement?.getBoundingClientRect().width || 116;
    const cardHeight = cardElement?.offsetHeight || cardElement?.getBoundingClientRect().height || 162;
    const cardBounds = {
      left: battlefieldBounds.left + position.x,
      right: battlefieldBounds.left + position.x + cardWidth,
      top: battlefieldBounds.top + position.y,
      bottom: battlefieldBounds.top + position.y + cardHeight,
    };
    const horizontalOverlap = cardBounds.right >= manaLaneBounds.left && cardBounds.left <= manaLaneBounds.right;
    const verticalOverlap = Math.min(cardBounds.bottom, manaLaneBounds.bottom) - Math.max(cardBounds.top, manaLaneBounds.top);

    return horizontalOverlap && verticalOverlap >= 12;
  }

  private elementsAtPoint(event: PointerEvent): Element[] {
    return document.elementsFromPoint(event.clientX, event.clientY);
  }

  private setHandDropPreviewAt(
    clientX: number,
    playerId: string,
    draggedInstanceId: string,
    context: GameTableBattlefieldDragContext,
  ): void {
    const hand = context.snapshot()?.players[playerId]?.zones.hand ?? [];
    const preview = this.pointerDrag.handDropPreviewAt(document, playerId, clientX, hand, draggedInstanceId);
    if (!preview) {
      this.state.clearHandDropPreview();
      return;
    }

    this.state.setHandDropPreview({ playerId, ...preview });
  }

  private isGameZone(zone: string | undefined, zones: readonly GameZoneName[]): zone is GameZoneName {
    return zone !== undefined && zones.includes(zone as GameZoneName);
  }
}
