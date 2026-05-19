import { Injectable, signal } from '@angular/core';
import { GameCardInstance, GameZoneName } from '../../../../../core/models/game.model';

export interface HandDropPreview {
  playerId: string;
  targetInstanceId: string;
  placement: 'before' | 'after';
}

export interface AlignmentGuide {
  playerId: string;
  y: number;
  referenceInstanceIds: readonly string[];
}

export interface ActiveDropTarget {
  playerId: string;
  zone: GameZoneName;
}

export interface PointerDragPreview {
  card: GameCardInstance;
  x: number;
  y: number;
  width: number;
  height: number;
  count: number;
}

@Injectable()
export class GameTableBattlefieldDragState {
  readonly draggingCardInstanceId = signal<string | null>(null);
  readonly handDropPreview = signal<HandDropPreview | null>(null);
  readonly manaLaneDropPlayerId = signal<string | null>(null);
  readonly alignmentGuide = signal<AlignmentGuide | null>(null);
  readonly activeDropTarget = signal<ActiveDropTarget | null>(null);
  readonly activePlayerDropTarget = signal<string | null>(null);
  readonly pointerDragPreview = signal<PointerDragPreview | null>(null);
  readonly handExternalRevealAllowed = signal(true);

  beginCardDrag(instanceId: string): void {
    this.draggingCardInstanceId.set(instanceId);
  }

  endCardDrag(): void {
    this.draggingCardInstanceId.set(null);
    this.manaLaneDropPlayerId.set(null);
    this.alignmentGuide.set(null);
    this.activeDropTarget.set(null);
    this.activePlayerDropTarget.set(null);
    this.pointerDragPreview.set(null);
    this.handExternalRevealAllowed.set(true);
    this.clearHandDropPreview();
  }

  setHandDropPreview(preview: HandDropPreview): void {
    this.handDropPreview.set(preview);
  }

  clearHandDropPreview(): void {
    this.handDropPreview.set(null);
  }

  setPointerDragPreview(preview: PointerDragPreview): void {
    this.pointerDragPreview.set(preview);
  }

  clearManaLaneAndAlignment(): void {
    this.manaLaneDropPlayerId.set(null);
    this.alignmentGuide.set(null);
  }

  setManaLaneDropPlayer(playerId: string | null): void {
    this.manaLaneDropPlayerId.set(playerId);
  }

  setAlignmentGuide(guide: AlignmentGuide | null): void {
    this.alignmentGuide.set(guide);
  }

  setActiveDropTarget(target: ActiveDropTarget | null): void {
    this.activeDropTarget.set(target);
  }

  setActivePlayerDropTarget(playerId: string | null): void {
    this.activePlayerDropTarget.set(playerId);
  }

  setHandExternalRevealAllowed(allowed: boolean): void {
    this.handExternalRevealAllowed.set(allowed);
  }

  clearDropTargets(): void {
    this.manaLaneDropPlayerId.set(null);
    this.alignmentGuide.set(null);
    this.activePlayerDropTarget.set(null);
    this.activeDropTarget.set(null);
    this.handExternalRevealAllowed.set(true);
    this.clearHandDropPreview();
  }

  isManaLaneHighlighted(playerId: string): boolean {
    const target = this.activeDropTarget();
    if (target?.playerId === playerId && target.zone === 'hand') {
      return false;
    }

    return this.manaLaneDropPlayerId() === playerId;
  }

  isDropZoneHighlighted(playerId: string, zone: GameZoneName): boolean {
    const target = this.activeDropTarget();

    return target?.playerId === playerId && target.zone === zone || zone === 'battlefield' && this.manaLaneDropPlayerId() === playerId;
  }

  isPlayerDropHighlighted(playerId: string): boolean {
    return this.activePlayerDropTarget() === playerId;
  }

  alignmentGuideFor(playerId: string): AlignmentGuide | null {
    const target = this.activeDropTarget();
    if (target?.playerId === playerId && target.zone === 'hand') {
      return null;
    }

    const guide = this.alignmentGuide();

    return guide?.playerId === playerId ? guide : null;
  }
}
