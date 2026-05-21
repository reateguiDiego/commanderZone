import { Injectable, inject } from '@angular/core';
import { GameCardInstance, GameSnapshot, GameZoneName } from '../../../../core/models/game.model';
import { GameTableBattlefieldDragState } from '../state/drag-drop/game-table-battlefield-drag.state';
import { DEFAULT_BATTLEFIELD_CARD_SIZE } from '../utils/battlefield-position';
import { buildAttachmentStackGroups } from '../utils/attachment-stack';
import { buildLandStackGroups } from '../utils/land-stack';
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
  cardPosition(card: GameCardInstance): { x: number; y: number } | null;
  updateLocalCardPosition(playerId: string, instanceId: string, position: { x: number; y: number }): void;
}

@Injectable()
export class GameTableBattlefieldDragCoordinatorService {
  private readonly drag = inject(GameTableDragService);
  private readonly pointerDrag = inject(GameTablePointerDragService);
  private readonly state = inject(GameTableBattlefieldDragState);
  private readonly battlefieldAlignmentGuideThreshold = 12;
  private readonly battlefieldAlignmentSnapThreshold = 12;
  private readonly activeHandHorizontalRetentionOverlap = 0.4;
  private readonly activeHandTopExitRatio = 0.35;
  private readonly handActivationOverlapFromManaLane = 0.5;

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

    if (this.isHandDropActiveForPlayer(selected.playerId)) {
      this.state.clearManaLaneAndAlignment();
      return;
    }

    const card = context.findCard(selected.playerId, 'battlefield', instanceId);
    const position = card ? context.cardPosition(card) : null;

    if (this.isCardTopNearManaLane(event, selected.playerId, instanceId, position)) {
      this.state.setManaLaneDropPlayer(selected.playerId);
      this.state.setAlignmentGuide(null);
      const manaPosition = position ? this.positionWithManaLaneBottom(selected.playerId, position) : null;
      if (manaPosition) {
        context.updateLocalCardPosition(selected.playerId, instanceId, manaPosition);
      }
      return;
    }

    this.state.setManaLaneDropPlayer(null);
    if (position && this.isManaLanePosition(selected.playerId, position)) {
      this.state.setAlignmentGuide(null);
      return;
    }

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

    if (this.isManaLanePosition(playerId, position)) {
      return position;
    }

    const guide = this.nearestBattlefieldRow(context, playerId, instanceId, position.y, this.battlefieldAlignmentSnapThreshold);

    return guide ? { ...position, y: guide.y } : position;
  }

  positionWithManaLane(playerId: string, position: { x: number; y: number }): { x: number; y: number } {
    return this.positionWithManaLaneBottom(playerId, position);
  }

  positionWithManaLaneBottom(
    playerId: string,
    position: { x: number; y: number },
    visualHeight = DEFAULT_BATTLEFIELD_CARD_SIZE.height,
  ): { x: number; y: number } {
    const y = this.manaLaneBottomY(playerId, visualHeight);

    return y === null ? position : { ...position, y };
  }

  isManaLanePosition(playerId: string, position: { x: number; y: number }): boolean {
    return this.isManaLaneRow(playerId, position.y);
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
      this.state.setHandExternalRevealAllowed(true);
      this.state.clearHandDropPreview();
      return;
    }

    const targetPlayerId = this.playerDropTargetAt(event, selected.playerId);
    if (targetPlayerId) {
      this.state.setActivePlayerDropTarget(targetPlayerId);
      this.state.setActiveDropTarget(null);
      this.state.setHandExternalRevealAllowed(true);
      this.state.clearHandDropPreview();
      return;
    }

    this.state.setActivePlayerDropTarget(null);
    const pointerZone = this.drag.pointerDropZone(event, selected.playerId, [...context.zones]);
    const zone = this.pointerDropZoneWithHandActivation(pointerZone, selected.playerId);
    if (pointerZone === 'hand' && zone !== 'hand') {
      this.state.setHandExternalRevealAllowed(false);
      this.state.setActiveDropTarget(null);
      this.state.clearHandDropPreview();
      return;
    }

    this.state.setHandExternalRevealAllowed(true);
    this.state.setActiveDropTarget(zone ? { playerId: selected.playerId, zone } : null);
    if (zone === 'hand') {
      this.state.clearManaLaneAndAlignment();
      this.setHandDropPreviewAt(event.clientX, selected.playerId, selected.card.instanceId, context);
    } else {
      this.state.clearHandDropPreview();
    }
  }

  pointerDropZone(event: PointerEvent, playerId: string, context: GameTableBattlefieldDragContext): GameZoneName | null {
    const pointerZone = this.drag.pointerDropZone(event, playerId, [...context.zones]);

    return this.pointerDropZoneWithHandActivation(pointerZone, playerId);
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
        this.state.clearManaLaneAndAlignment();
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
          this.state.clearManaLaneAndAlignment();
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
    const stackReferenceIds = this.stackAlignmentReferenceIds(context, playerId);

    return context.snapshot()?.players[playerId]?.zones.battlefield
      .filter((card) => card.instanceId !== instanceId)
      .filter((card) => stackReferenceIds === null || stackReferenceIds.has(card.instanceId))
      .map((card) => ({ position: context.cardPosition(card), referenceInstanceIds: [card.instanceId] }))
      .filter((card): card is { position: { x: number; y: number }; referenceInstanceIds: string[] } => card.position !== null)
      .map((card) => ({ y: card.position.y, referenceInstanceIds: card.referenceInstanceIds }))
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
      .filter((element) => !element.classList.contains('land-stack-under'))
      .filter((element) => !element.classList.contains('attachment-stack-equipment'))
      .filter((element) => element.getClientRects().length > 0)
      .map((element) => ({
        y: element.offsetTop,
        referenceInstanceIds: element.dataset['cardInstanceId'] ? [element.dataset['cardInstanceId']] : [],
      }))
      .filter((row) => row.referenceInstanceIds.length > 0)
      .filter((row) => !this.isManaLaneRow(playerId, row.y));
  }

  private stackAlignmentReferenceIds(
    context: GameTableBattlefieldDragContext,
    playerId: string,
  ): ReadonlySet<string> | null {
    const battlefield = context.snapshot()?.players[playerId]?.zones.battlefield;
    if (!battlefield) {
      return null;
    }

    const groups = buildLandStackGroups(battlefield, (card) => context.cardPosition(card));
    const attachmentGroups = buildAttachmentStackGroups(
      battlefield,
      context.snapshot()?.attachments ?? [],
      (card) => context.cardPosition(card),
    );
    if (groups.length === 0 && attachmentGroups.length === 0) {
      return null;
    }

    const underIds = new Set(groups.flatMap((group) =>
      group.members.filter((member) => member.role === 'under').map((member) => member.card.instanceId),
    ));
    for (const instanceId of attachmentGroups.flatMap((group) =>
      group.members.filter((member) => member.role === 'equipment').map((member) => member.card.instanceId),
    )) {
      underIds.add(instanceId);
    }

    return new Set(battlefield
      .filter((card) => !underIds.has(card.instanceId))
      .map((card) => card.instanceId));
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

  private manaLaneBottomY(playerId: string, visualHeight: number): number | null {
    const manaLane = this.manaLaneElement(playerId);
    if (!manaLane) {
      return null;
    }

    const laneHeight = manaLane.offsetHeight || manaLane.getBoundingClientRect().height;
    if (laneHeight <= 0) {
      return this.manaLaneY(playerId);
    }

    return Math.round(Math.max(0, manaLane.offsetTop + laneHeight - visualHeight));
  }

  private manaLaneElement(playerId: string): HTMLElement | null {
    const battlefield = this.battlefieldElement(playerId);

    return battlefield?.querySelector<HTMLElement>('[data-mana-lane]') ?? null;
  }

  private battlefieldElement(playerId: string): HTMLElement | null {
    return Array.from(document.querySelectorAll<HTMLElement>('.battlefield'))
      .find((element) => element.dataset['playerId'] === playerId) ?? null;
  }

  private isCardTopNearManaLane(
    event: PointerEvent,
    playerId: string,
    instanceId: string,
    position: { x: number; y: number } | null | undefined,
  ): boolean {
    if (!position) {
      return false;
    }

    const manaLane = this.manaLaneElement(playerId);
    if (!manaLane) {
      return false;
    }

    const battlefield = this.battlefieldElement(playerId);
    if (!battlefield) {
      return false;
    }

    const bounds = manaLane.getBoundingClientRect();
    const battlefieldBounds = battlefield.getBoundingClientRect();
    const cardElement = Array.from(battlefield.querySelectorAll<HTMLElement>('[data-testid="game-card"][data-zone="battlefield"]'))
      .find((element) => element.dataset['cardInstanceId'] === instanceId);
    const cardWidth = cardElement?.offsetWidth || cardElement?.getBoundingClientRect().width || 116;
    const cardLeft = battlefieldBounds.left + position.x;
    const cardTop = battlefieldBounds.top + position.y;
    const horizontalOverlap = cardLeft + cardWidth >= bounds.left && cardLeft <= bounds.right;
    const topEdgeMagnetDistance = 12;
    const topEdgeInLaneBand = cardTop >= bounds.top - topEdgeMagnetDistance && cardTop <= bounds.bottom;

    return horizontalOverlap && topEdgeInLaneBand;
  }

  private pointerDropZoneWithHandActivation(pointerZone: GameZoneName | null, playerId: string): GameZoneName | null {
    if (pointerZone !== 'hand') {
      return pointerZone;
    }

    if (this.isHandDropActiveForPlayer(playerId)) {
      return this.isDraggedCardInsideActiveHandBounds(playerId) ? 'hand' : null;
    }

    return this.isDraggedCardInsideCollapsedHandForActivation(playerId) ? 'hand' : null;
  }

  private isHandDropActiveForPlayer(playerId: string): boolean {
    const target = this.state.activeDropTarget();

    return target?.playerId === playerId && target.zone === 'hand';
  }

  private isDraggedCardInsideActiveHandBounds(playerId: string): boolean {
    const target = this.state.activeDropTarget();
    if (target?.playerId !== playerId || target.zone !== 'hand') {
      return false;
    }

    const preview = this.drag.pointerDragPreview();
    const hand = this.handDropZoneElement(playerId);
    if (!preview || !hand) {
      return false;
    }

    const bounds = this.handVisualBounds(hand, 'revealed');
    if (!this.hasEnoughHandHorizontalOverlap(preview.x, preview.width, bounds)) {
      return false;
    }

    if (!this.hasExceededTopExitThreshold(preview.y, preview.height, bounds.top, this.activeHandTopExitRatio)) {
      return true;
    }

    return false;
  }

  private isDraggedCardInsideCollapsedHandForActivation(playerId: string): boolean {
    const preview = this.drag.pointerDragPreview();
    const hand = this.handDropZoneElement(playerId);
    if (!preview || !hand) {
      return false;
    }

    const bounds = this.handVisualBounds(hand, 'collapsed');
    if (!this.hasEnoughHandHorizontalOverlap(preview.x, preview.width, bounds)) {
      return false;
    }

    return this.hasEnoughVerticalOverlap(preview.y, preview.height, bounds.top, bounds.bottom, this.handActivationOverlapFromManaLane);
  }

  private handVisualBounds(hand: HTMLElement, state: 'collapsed' | 'revealed'): DOMRect {
    const bounds = hand.getBoundingClientRect();
    const collapsedOffset = state === 'collapsed' ? this.handRevealLiftOffset(hand) : 0;

    return {
      x: bounds.x,
      y: bounds.y + collapsedOffset,
      width: bounds.width,
      height: bounds.height,
      top: bounds.top + collapsedOffset,
      right: bounds.right,
      bottom: bounds.bottom + collapsedOffset,
      left: bounds.left,
      toJSON: () => ({}),
    } as DOMRect;
  }

  private hasEnoughHandHorizontalOverlap(previewLeft: number, previewWidth: number, bounds: DOMRect): boolean {
    const overlapWidth = Math.max(0, Math.min(previewLeft + previewWidth, bounds.right) - Math.max(previewLeft, bounds.left));
    const horizontalOverlapRatio = previewWidth > 0 ? overlapWidth / previewWidth : 0;

    return horizontalOverlapRatio >= this.activeHandHorizontalRetentionOverlap;
  }

  private hasEnoughVerticalOverlap(
    previewTop: number,
    previewHeight: number,
    zoneTop: number,
    zoneBottom: number,
    requiredRatio: number,
  ): boolean {
    const previewBottom = previewTop + previewHeight;
    const visibleHeight = Math.max(0, Math.min(previewBottom, zoneBottom) - Math.max(previewTop, zoneTop));
    const verticalOverlapRatio = previewHeight > 0 ? visibleHeight / previewHeight : 0;

    return verticalOverlapRatio > requiredRatio;
  }

  private hasExceededTopExitThreshold(previewTop: number, previewHeight: number, zoneTop: number, exitRatio: number): boolean {
    if (previewHeight <= 0) {
      return false;
    }

    return zoneTop - previewTop > previewHeight * exitRatio;
  }

  private handRevealLiftOffset(hand: HTMLElement): number {
    const handArea = hand.closest<HTMLElement>('.hand-area');
    if (!handArea) {
      return 0;
    }

    const rawOffset = (
      handArea.style.getPropertyValue('--hand-hidden-offset')
      || getComputedStyle(handArea).getPropertyValue('--hand-hidden-offset')
    ).trim();
    if (!rawOffset) {
      return 0;
    }

    if (rawOffset.endsWith('rem')) {
      const value = Number.parseFloat(rawOffset.slice(0, -3));
      const rootFontSize = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);

      return Number.isFinite(value) && Number.isFinite(rootFontSize) ? value * rootFontSize : 0;
    }

    if (rawOffset.endsWith('px')) {
      const value = Number.parseFloat(rawOffset.slice(0, -2));

      return Number.isFinite(value) ? value : 0;
    }

    const numericValue = Number.parseFloat(rawOffset);

    return Number.isFinite(numericValue) ? numericValue : 0;
  }

  private handDropZoneElement(playerId: string): HTMLElement | null {
    return document.querySelector<HTMLElement>(`[data-game-drop-zone][data-zone="hand"][data-player-id="${playerId}"]`);
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
