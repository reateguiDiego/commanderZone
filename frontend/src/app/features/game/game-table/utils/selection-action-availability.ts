import { GameAttachment, GameBattlefieldStack, GameSnapshot, GameZoneName } from '../../../../core/models/game.model';
import { SelectionActionAvailability, SelectionActionId } from '../models/selection-action.model';
import { GroupSelectionRef, SelectedCardState } from '../services/game-table-selection.service';

export interface SelectionActionResolutionInput {
  readonly actorPlayerId: string | null;
  readonly snapshot: GameSnapshot | null;
  readonly selectedCards: readonly SelectedCardState[];
  readonly selectedGroupRefs: readonly GroupSelectionRef[];
}

export interface ResolvedSelectionActionState {
  readonly actions: readonly SelectionActionAvailability[];
  readonly resolvedInstanceIds: readonly string[];
  readonly resolvedStacks: readonly GameBattlefieldStack[];
  readonly selectedAttachments: readonly GameAttachment[];
  readonly sourcePlayerId: string | null;
  readonly sourceZone: GameZoneName | null;
}

export function resolveSelectionActions(input: SelectionActionResolutionInput): ResolvedSelectionActionState {
  const { actorPlayerId, snapshot, selectedCards, selectedGroupRefs } = input;
  const source = selectedCards[0] ?? null;
  const sourcePlayerId = source?.playerId ?? null;
  const sourceZone = source?.zone ?? null;
  const compatible = source !== null && selectedCards.every((item) => item.playerId === sourcePlayerId && item.zone === sourceZone);
  const resolvedStacks = selectedGroupRefs
    .map((ref) => snapshot?.battlefieldStacks?.find((stack) => stack.id === ref.stackId) ?? null)
    .filter((stack): stack is GameBattlefieldStack => stack !== null);
  const resolvedInstanceIds = unique([
    ...selectedCards.map((item) => item.card.instanceId),
    ...resolvedStacks.flatMap((stack) => stack.orderedMemberIds),
  ]);
  const resolvedCards = resolvedInstanceIds
    .map((instanceId) => findCard(snapshot, instanceId))
    .filter((card): card is NonNullable<ReturnType<typeof findCard>> => card !== null);
  const actorActive = actorPlayerId !== null
    && snapshot?.players[actorPlayerId]?.status === 'active'
    && snapshot.gamePhase !== 'FINISHED';
  const allResolved = resolvedCards.length === resolvedInstanceIds.length && resolvedInstanceIds.length > 0;
  const allActionable = actorActive && compatible && allResolved && resolvedCards.every(({ playerId, zone, card }) => {
    if (zone === 'battlefield') {
      return (card.controllerId ?? playerId) === actorPlayerId;
    }
    return playerId === actorPlayerId && (card.ownerId ?? playerId) === actorPlayerId;
  });
  const baseReason = disabledReason(actorPlayerId, snapshot, source, compatible, allResolved, allActionable);
  const battlefield = sourceZone === 'battlefield';
  const existingStackMemberIds = new Set((snapshot?.battlefieldStacks ?? []).flatMap((stack) => stack.orderedMemberIds));
  const selectedAttachments = (snapshot?.attachments ?? []).filter((relation) => resolvedInstanceIds.includes(relation.equipmentInstanceId));
  const moveDestinations = movementDestinations(sourceZone);

  const canTap = allActionable && resolvedCards.some(({ card }) => !card.tapped);
  const canUntap = allActionable && resolvedCards.some(({ card }) => card.tapped);
  const canFaceDown = allActionable && resolvedCards.some(({ card }) => !card.faceDown);
  const canFaceUp = allActionable && resolvedCards.some(({ card }) => card.faceDown);

  const actions: SelectionActionAvailability[] = moveDestinations.map((destination) => action({
    actionId: `move:${destination}` as SelectionActionId,
    category: 'movement',
    commandType: 'cards.moved',
    labelKey: `game.selectionBatch.actions.move.${destination}`,
    visible: true,
    enabled: allActionable,
    reasonDisabled: baseReason,
    requiresConfirmation: resolvedInstanceIds.length > 1 || destination === 'graveyard' || destination === 'exile' || destination === 'library',
    affectedCount: resolvedInstanceIds.length,
    resolvesGroupMembers: selectedGroupRefs.length > 0,
    destinationOptions: moveDestinations,
  }));

  actions.push(action({
    actionId: 'tap', category: 'battlefield', commandType: 'cards.tapped.set', labelKey: 'game.selectionBatch.actions.tap',
    visible: battlefield, enabled: canTap,
    reasonDisabled: canTap ? null : baseReason ?? 'game.selectionBatch.disabled.alreadyTapped', affectedCount: resolvedInstanceIds.length,
    resolvesGroupMembers: selectedGroupRefs.length > 0,
  }));
  actions.push(action({
    actionId: 'untap', category: 'battlefield', commandType: 'cards.tapped.set', labelKey: 'game.selectionBatch.actions.untap',
    visible: battlefield, enabled: canUntap,
    reasonDisabled: canUntap ? null : baseReason ?? 'game.selectionBatch.disabled.alreadyUntapped', affectedCount: resolvedInstanceIds.length,
    resolvesGroupMembers: selectedGroupRefs.length > 0,
  }));
  actions.push(action({
    actionId: 'faceDown', category: 'battlefield', commandType: 'cards.face_down.set', labelKey: 'game.selectionBatch.actions.faceDown',
    visible: battlefield, enabled: canFaceDown,
    reasonDisabled: canFaceDown ? null : baseReason ?? 'game.selectionBatch.disabled.alreadyFaceDown', requiresConfirmation: true,
    affectedCount: resolvedInstanceIds.length, resolvesGroupMembers: selectedGroupRefs.length > 0, privacyImpact: 'conceal',
  }));
  actions.push(action({
    actionId: 'faceUp', category: 'battlefield', commandType: 'cards.face_down.set', labelKey: 'game.selectionBatch.actions.faceUp',
    visible: battlefield && resolvedCards.some(({ card }) => card.faceDown),
    enabled: canFaceUp, reasonDisabled: canFaceUp ? null : baseReason,
    requiresConfirmation: true, affectedCount: resolvedInstanceIds.length,
    resolvesGroupMembers: selectedGroupRefs.length > 0, privacyImpact: 'materialize',
  }));
  const canCreateStack = allActionable && battlefield && resolvedInstanceIds.length >= 2
    && selectedGroupRefs.length === 0 && resolvedInstanceIds.every((id) => !existingStackMemberIds.has(id));
  actions.push(action({
    actionId: 'createStack', category: 'relations', commandType: 'battlefield.stack.created', labelKey: 'game.selectionBatch.actions.createStack',
    visible: battlefield && resolvedInstanceIds.length >= 2, enabled: canCreateStack,
    reasonDisabled: canCreateStack ? null : baseReason ?? (selectedGroupRefs.length > 0 || resolvedInstanceIds.some((id) => existingStackMemberIds.has(id))
      ? 'game.selectionBatch.disabled.alreadyStacked' : 'game.selectionBatch.disabled.needTwo'),
    requiresConfirmation: true, affectedCount: resolvedInstanceIds.length,
  }));
  const canDissolve = allActionable && selectedGroupRefs.length === 1 && resolvedStacks.length === 1;
  actions.push(action({
    actionId: 'dissolveStack', category: 'relations', commandType: 'battlefield.stack.dissolved', labelKey: 'game.selectionBatch.actions.dissolveStack',
    visible: selectedGroupRefs.length > 0, enabled: canDissolve,
    reasonDisabled: canDissolve ? null : baseReason ?? (selectedGroupRefs.length !== 1 ? 'game.selectionBatch.disabled.oneStackOnly' : null),
    requiresConfirmation: true, affectedCount: resolvedStacks[0]?.orderedMemberIds.length ?? 0, resolvesGroupMembers: true,
  }));
  const canDetach = allActionable && resolvedInstanceIds.length === 1 && selectedAttachments.length === 1;
  actions.push(action({
    actionId: 'detach', category: 'relations', commandType: 'attachment.removed', labelKey: 'game.selectionBatch.actions.detach',
    visible: battlefield && selectedAttachments.length > 0,
    enabled: canDetach,
    reasonDisabled: canDetach ? null : baseReason ?? 'game.selectionBatch.disabled.singleAttachmentOnly', affectedCount: 1,
  }));

  return { actions, resolvedInstanceIds, resolvedStacks, selectedAttachments, sourcePlayerId, sourceZone };
}

function action(values: Partial<SelectionActionAvailability> & Pick<SelectionActionAvailability, 'actionId' | 'category' | 'commandType' | 'labelKey'>): SelectionActionAvailability {
  return {
    enabled: false,
    visible: false,
    reasonDisabled: null,
    requiresConfirmation: false,
    supportsBatch: true,
    affectedCount: 0,
    resolvesGroupMembers: false,
    destinationOptions: [],
    privacyImpact: 'none',
    ...values,
  };
}

function movementDestinations(sourceZone: GameZoneName | null): GameZoneName[] {
  if (!sourceZone) {
    return [];
  }
  // Library placement needs an explicit top/bottom intent. The existing single-card
  // flow owns that dialog, so the batch toolbar must not manufacture an ambiguous move.
  const allowed: GameZoneName[] = ['battlefield', 'hand', 'graveyard', 'exile'];
  return allowed.filter((zone) => zone !== sourceZone);
}

function disabledReason(
  actorPlayerId: string | null,
  snapshot: GameSnapshot | null,
  source: SelectedCardState | null,
  compatible: boolean,
  allResolved: boolean,
  allActionable: boolean,
): string | null {
  if (!actorPlayerId || !snapshot || !source) return 'game.selectionBatch.disabled.empty';
  if (snapshot.gamePhase === 'FINISHED') return 'game.selectionBatch.disabled.gameClosed';
  if (snapshot.players[actorPlayerId]?.status !== 'active') return 'game.selectionBatch.disabled.playerInactive';
  if (!compatible) return 'game.selectionBatch.disabled.incompatible';
  if (!allResolved) return 'game.selectionBatch.disabled.stale';
  if (!allActionable) return 'game.selectionBatch.disabled.notControlled';
  return null;
}

function findCard(snapshot: GameSnapshot | null, instanceId: string): { playerId: string; zone: GameZoneName; card: GameSnapshot['players'][string]['zones'][GameZoneName][number] } | null {
  if (!snapshot) return null;
  for (const [playerId, player] of Object.entries(snapshot.players)) {
    for (const [zone, cards] of Object.entries(player.zones) as [GameZoneName, typeof player.zones[GameZoneName]][]) {
      const card = cards.find((candidate) => candidate.instanceId === instanceId);
      if (card) return { playerId, zone, card };
    }
  }
  return null;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value !== ''))];
}
