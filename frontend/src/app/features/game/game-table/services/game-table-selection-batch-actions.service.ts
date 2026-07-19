import { Injectable, computed, inject, signal } from '@angular/core';
import { AuthStore } from '../../../../core/auth/auth.store';
import { GameBattlefieldStack, GameCommandType, GameZoneName } from '../../../../core/models/game.model';
import { SelectionActionAvailability, SelectionActionConfirmation, SelectionActionId } from '../models/selection-action.model';
import { GameTableBattlefieldState } from '../state/battlefield/game-table-battlefield.state';
import { GameTableCommandStore } from '../state/core/game-table-command.store';
import { GameTableContextStore } from '../state/core/game-table-context.store';
import { GameTableCoreState } from '../state/core/game-table-core.state';
import { buildLandStackGroups, removeLandStackMoves } from '../utils/land-stack';
import { resolveSelectionActions, ResolvedSelectionActionState } from '../utils/selection-action-availability';
import { BattlefieldStackSelectionRef, GameTableSelectionService } from './game-table-selection.service';

@Injectable()
export class GameTableSelectionBatchActionsService {
  private readonly auth = inject(AuthStore);
  private readonly battlefield = inject(GameTableBattlefieldState);
  private readonly commands = inject(GameTableCommandStore);
  private readonly contexts = inject(GameTableContextStore);
  private readonly core = inject(GameTableCoreState);
  private readonly selection = inject(GameTableSelectionService);

  readonly pendingActionId = signal<SelectionActionId | null>(null);
  readonly confirmation = signal<SelectionActionConfirmation | null>(null);
  readonly actionError = signal<string | null>(null);
  readonly actionErrorCode = signal<string | null>(null);
  readonly resolved = computed(() => resolveSelectionActions({
    actorPlayerId: this.actorPlayerId(),
    snapshot: this.core.snapshot(),
    selectedCards: this.selection.selectedCards(),
    selectedGroupRefs: this.selection.selectedGroupRefs(),
  }));
  readonly actions = computed(() => this.resolved().actions.filter((action) => action.visible));

  request(actionId: SelectionActionId): void {
    if (this.pendingActionId() !== null) {
      return;
    }
    const action = this.currentAction(actionId);
    if (!action?.enabled) {
      this.actionError.set(action?.reasonDisabled ?? 'game.selectionBatch.disabled.stale');
      return;
    }
    this.actionError.set(null);
    this.actionErrorCode.set(null);
    if (action.requiresConfirmation) {
      this.confirmation.set({ action, messageKey: this.confirmationMessage(action.actionId) });
      return;
    }
    void this.execute(action.actionId);
  }

  cancelConfirmation(): void {
    this.confirmation.set(null);
  }

  async confirmAction(): Promise<void> {
    const confirmation = this.confirmation();
    if (!confirmation) {
      return;
    }
    this.confirmation.set(null);
    await this.execute(confirmation.action.actionId);
  }

  clearError(): void {
    this.actionError.set(null);
    this.actionErrorCode.set(null);
  }

  private async execute(actionId: SelectionActionId): Promise<void> {
    const action = this.currentAction(actionId);
    if (!action?.enabled || this.pendingActionId() !== null) {
      this.actionError.set(action?.reasonDisabled ?? 'game.selectionBatch.disabled.stale');
      return;
    }
    this.pendingActionId.set(actionId);
    this.actionError.set(null);
    this.actionErrorCode.set(null);
    try {
      const resolved = this.resolved();
      const applied = await this.executeResolved(action, resolved);
      if (!applied) {
        const errorCode = this.commands.lastErrorCode();
        this.actionErrorCode.set(errorCode);
        this.actionError.set(this.errorMessageKey(errorCode));
      }
    } finally {
      this.pendingActionId.set(null);
    }
  }

  private async executeResolved(action: SelectionActionAvailability, resolved: ResolvedSelectionActionState): Promise<boolean> {
    const actorPlayerId = this.actorPlayerId();
    if (!actorPlayerId || !resolved.sourcePlayerId || !resolved.sourceZone || resolved.resolvedInstanceIds.length === 0) {
      return false;
    }

    if (action.actionId.startsWith('move:')) {
      const toZone = action.actionId.slice('move:'.length) as GameZoneName;
      const applied = await this.command('cards.moved', {
        playerId: resolved.sourcePlayerId,
        fromZone: resolved.sourceZone,
        toZone,
        instanceIds: resolved.resolvedInstanceIds,
      });
      if (applied) this.selection.clearSelection();
      return applied;
    }

    if (action.actionId === 'tap' || action.actionId === 'untap') {
      return this.command('cards.tapped.set', {
        playerId: actorPlayerId,
        instanceIds: resolved.resolvedInstanceIds,
        tapped: action.actionId === 'tap',
      });
    }

    if (action.actionId === 'faceDown' || action.actionId === 'faceUp') {
      return this.command('cards.face_down.set', {
        playerId: actorPlayerId,
        instanceIds: resolved.resolvedInstanceIds,
        faceDown: action.actionId === 'faceDown',
      });
    }

    if (action.actionId === 'createStack') {
      const rootInstanceId = resolved.resolvedInstanceIds[0]!;
      const stackId = `battlefield-stack-${crypto.randomUUID()}`;
      const applied = await this.command('battlefield.stack.created', {
        stackId,
        rootInstanceId,
        orderedInstanceIds: resolved.resolvedInstanceIds,
        stackKind: 'generic',
      });
      if (applied) this.selectCreatedStack(resolved.sourcePlayerId, stackId, rootInstanceId, resolved.resolvedInstanceIds.length);
      return applied;
    }

    if (action.actionId === 'dissolveStack') {
      const stack = resolved.resolvedStacks[0];
      if (!stack) return false;
      const positions = this.dissolvePositions(resolved.sourcePlayerId, stack);
      if (positions.length !== stack.orderedMemberIds.length) return false;
      const applied = await this.command('battlefield.stack.dissolved', { stackId: stack.id, positions });
      if (applied) this.selectRootOnly(resolved.sourcePlayerId, stack.rootInstanceId);
      return applied;
    }

    if (action.actionId === 'detach') {
      const attachment = resolved.selectedAttachments[0];
      if (!attachment) return false;
      return this.command('attachment.removed', {
        id: attachment.id,
        equipmentInstanceId: attachment.equipmentInstanceId,
      });
    }

    return false;
  }

  private dissolvePositions(playerId: string, stack: GameBattlefieldStack): Array<{ instanceId: string; position: unknown }> {
    const snapshot = this.core.snapshot();
    const cards = snapshot?.players[playerId]?.zones.battlefield ?? [];
    const groups = buildLandStackGroups(cards, snapshot?.battlefieldStacks ?? [], (card) => this.battlefield.cardPosition(card));
    const group = groups.find((candidate) => candidate.id === stack.id);
    if (!group) return [];
    return removeLandStackMoves(group).map((move) => ({
      instanceId: move.card.instanceId,
      position: this.battlefield.ratioPositionForBattlefield(playerId, move.card.instanceId, move.position),
    }));
  }

  private selectCreatedStack(playerId: string, stackId: string, rootInstanceId: string, memberCount: number): void {
    const snapshot = this.core.snapshot();
    const root = snapshot?.players[playerId]?.zones.battlefield.find((card) => card.instanceId === rootInstanceId);
    if (!root) {
      this.selection.clearSelection();
      return;
    }
    const ref: BattlefieldStackSelectionRef = {
      kind: 'battlefield-stack', stackId, rootInstanceId, playerId, zone: 'battlefield', memberCount,
    };
    this.selection.selectMany(playerId, 'battlefield', [root], [ref]);
  }

  private selectRootOnly(playerId: string, rootInstanceId: string): void {
    const root = this.core.snapshot()?.players[playerId]?.zones.battlefield.find((card) => card.instanceId === rootInstanceId);
    if (root) this.selection.selectSingle(playerId, 'battlefield', root);
    else this.selection.clearSelection();
  }

  private currentAction(actionId: SelectionActionId): SelectionActionAvailability | null {
    return this.resolved().actions.find((action) => action.actionId === actionId) ?? null;
  }

  private actorPlayerId(): string | null {
    const userId = this.auth.user()?.id ?? null;
    if (!userId) return null;
    return Object.entries(this.core.snapshot()?.players ?? {}).find(([, player]) => player.user.id === userId)?.[0] ?? null;
  }

  private async command(type: GameCommandType, payload: Record<string, unknown>): Promise<boolean> {
    return this.commands.command(this.contexts.command(), type, payload);
  }

  private confirmationMessage(actionId: SelectionActionId): string {
    if (actionId.startsWith('move:')) return 'game.selectionBatch.confirm.move';
    if (actionId === 'createStack') return 'game.selectionBatch.confirm.createStack';
    if (actionId === 'dissolveStack') return 'game.selectionBatch.confirm.dissolveStack';
    if (actionId === 'faceDown') return 'game.selectionBatch.confirm.faceDown';
    if (actionId === 'faceUp') return 'game.selectionBatch.confirm.faceUp';
    return 'game.selectionBatch.confirm.generic';
  }

  private errorMessageKey(errorCode: string | null): string {
    switch (errorCode) {
      case 'GAME_CLOSED':
        return 'game.selectionBatch.disabled.gameClosed';
      case 'PLAYER_NOT_ACTIVE':
        return 'game.selectionBatch.disabled.playerInactive';
      case 'INSTANCE_NOT_FOUND':
      case 'ZONE_MISMATCH':
      case 'RELATION_NOT_FOUND':
      case 'STALE_SELECTION':
        return 'game.selectionBatch.disabled.stale';
      case 'DUPLICATE_INSTANCE':
      case 'INCOMPATIBLE_SELECTION':
        return 'game.selectionBatch.disabled.incompatible';
      case 'INSTANCE_NOT_CONTROLLED':
      case 'INSTANCE_NOT_OWNED':
      case 'MIXED_AUTHORITY_BATCH':
      case 'PERMISSION_DENIED':
        return 'game.selectionBatch.disabled.notControlled';
      default:
        return 'game.selectionBatch.errors.rejected';
    }
  }
}
