import {
  AfterViewChecked,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  NgZone,
  OnDestroy,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import {
  BottomOrderMode,
  GameCardInstance,
  GameMulliganConfig,
  GamePhase,
  GamePlayerMulliganState,
  MulliganPlayerStatus,
  MulliganRule,
} from '../../../../../core/models/game.model';
import { GameplayErrorPayload, GameplayMulliganPublicPlayerState } from '../../../../../core/models/game-realtime.model';
import { GameCardViewComponent } from '../game-card-view/game-card-view.component';
import { MulliganOverlayAnimations } from './mulligan-overlay.animations';
import { RuntimeTranslatePipe } from '../../../../../core/localization/runtime-translate.pipe';
import { CzButtonDirective } from '../../../../../shared/ui/button/button.directive';
import { activeCardFaceIndex, canShowAlternateFaceToggle, nextCardFaceIndex } from '../../utils/double-faced-card';

type ScryDestination = 'TOP' | 'BOTTOM';
type MulliganStatusCandidate = MulliganPlayerStatus | string | null | undefined;

interface MulliganRuleDescriptionLine {
  readonly key: string;
}

@Component({
  selector: 'app-mulligan-overlay',
  imports: [GameCardViewComponent, LucideAngularModule, RuntimeTranslatePipe, CzButtonDirective],
  templateUrl: './mulligan-overlay.component.html',
  styleUrl: './mulligan-overlay.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MulliganOverlayComponent implements AfterViewChecked, OnDestroy {
  readonly gamePhase = input<GamePhase | null>(null);
  readonly config = input<GameMulliganConfig | null>(null);
  readonly currentPlayerId = input<string | null>(null);
  readonly currentMulligan = input<GamePlayerMulliganState | null>(null);
  readonly hand = input<readonly GameCardInstance[]>([]);
  readonly publicPlayers = input<readonly GameplayMulliganPublicPlayerState[]>([]);
  readonly pending = input(false);
  readonly error = input<GameplayErrorPayload | null>(null);
  readonly ownerBackgroundImage = input<string | null>(null);
  readonly cardImage = input.required<(card: GameCardInstance) => string | null>();

  readonly take = output<void>();
  readonly keep = output<readonly string[]>();
  readonly scryConfirmed = output<ScryDestination>();

  readonly selectedBottomIds = signal<readonly string[]>([]);
  readonly facePreviewIndexes = signal<Readonly<Record<string, number>>>({});
  readonly selectedBottomIdSet = computed(() => new Set(this.selectedBottomIds()));
  readonly isOpen = computed(() => this.gamePhase() === 'MULLIGAN');
  readonly rule = computed<MulliganRule>(() => this.config()?.rule ?? this.currentMulligan()?.rule ?? 'LONDON');
  readonly bottomOrderMode = computed<BottomOrderMode>(() => this.currentMulligan()?.bottomOrderMode ?? 'NONE');
  readonly status = computed<MulliganPlayerStatus>(() => this.normalizeStatus(this.currentMulligan()?.status));
  readonly bottomSelectionCount = computed(() => this.currentMulligan()?.bottomSelectionCount ?? 0);
  readonly selectedCountParams = computed(() => ({
    selected: this.selectedBottomIds().length,
    total: this.bottomSelectionCount(),
  }));
  readonly acceptDisabled = computed(() =>
    this.pending()
      || !this.canSubmitBottomSelection()
      || (this.bottomSelectionCount() > 0 && this.selectedBottomIds().length !== this.bottomSelectionCount()),
  );
  readonly takeDisabled = computed(() =>
    this.pending()
      || this.status() !== 'DECIDING'
      || this.currentMulligan()?.canTakeAnotherMulligan === false,
  );
  readonly keepActionLabelKey = computed(() =>
    this.bottomSelectionCount() > 0
      ? 'game.mulliganOverlay.actions.keepWithBottom'
      : 'game.mulliganOverlay.actions.keepHand',
  );
  readonly firstMulliganFreeLabelKey = computed<string | null>(() => {
    const mulligan = this.currentMulligan();
    const firstMulliganFree = this.config()?.firstMulliganFree ?? mulligan?.firstMulliganFree;

    if (typeof firstMulliganFree === 'boolean') {
      return firstMulliganFree
        ? 'game.mulliganOverlay.firstMulliganFree'
        : 'game.mulliganOverlay.firstMulliganNotFree';
    }

    if (!mulligan || mulligan.mulligansTaken <= 0) {
      return null;
    }

    return mulligan.mulligansTaken > mulligan.effectiveMulligans
      ? 'game.mulliganOverlay.firstMulliganFree'
      : 'game.mulliganOverlay.firstMulliganNotFree';
  });
  readonly otherPlayers = computed(() => {
    const currentPlayerId = this.currentPlayerId();

    return this.publicPlayers().filter((player) => player.playerId !== currentPlayerId);
  });
  readonly ruleDescriptionKey = computed(() => this.descriptionKeyForRule(this.rule()));
  readonly ruleDescription = computed<readonly MulliganRuleDescriptionLine[]>(() => [{ key: this.ruleDescriptionKey() }]);
  readonly scryCard = computed(() => this.currentMulligan()?.scryCard ?? null);
  readonly ownerBackgroundImageCss = computed(() => {
    const image = this.ownerBackgroundImage()?.trim();

    return image ? `url("${image}")` : 'none';
  });

  private readonly animations = new MulliganOverlayAnimations(
    inject<ElementRef<HTMLElement>>(ElementRef),
    inject(NgZone),
  );

  constructor() {
    effect(() => {
      const validHandIds = new Set(this.hand().map((card) => card.instanceId));
      const scryCard = this.scryCard();
      if (scryCard) {
        validHandIds.add(scryCard.instanceId);
      }
      const bottomSelectionCount = this.bottomSelectionCount();
      const validSelection = this.selectedBottomIds()
        .filter((instanceId) => validHandIds.has(instanceId))
        .slice(0, bottomSelectionCount);
      const validFacePreviewIndexes = Object.fromEntries(
        Object.entries(this.facePreviewIndexes()).filter(([instanceId]) => validHandIds.has(instanceId)),
      );

      if (!this.canSubmitBottomSelection() || bottomSelectionCount === 0) {
        if (this.selectedBottomIds().length > 0) {
          this.selectedBottomIds.set([]);
        }
      } else if (!sameStringArray(validSelection, this.selectedBottomIds())) {
        this.selectedBottomIds.set(validSelection);
      }

      if (!sameNumberRecord(validFacePreviewIndexes, this.facePreviewIndexes())) {
        this.facePreviewIndexes.set(validFacePreviewIndexes);
      }
    });
  }

  ngAfterViewChecked(): void {
    if (!this.isOpen()) {
      this.facePreviewIndexes.set({});
      this.animations.resetTransientState();
      return;
    }

    this.animations.syncHand(this.status() === 'DECIDING' ? this.handAnimationKey() : '');
  }

  ngOnDestroy(): void {
    this.animations.destroy();
  }

  ruleLabelKey(rule: MulliganRule = this.rule()): string {
    const labels: Record<MulliganRule, string> = {
      LONDON: 'game.mulliganOverlay.rules.london',
      VANCOUVER: 'game.mulliganOverlay.rules.vancouver',
      PARIS: 'game.mulliganOverlay.rules.paris',
      GENEROUS: 'game.mulliganOverlay.rules.generous',
    };

    return labels[rule];
  }

  statusLabelKey(status: MulliganStatusCandidate): string {
    const labels: Record<MulliganPlayerStatus, string> = {
      DECIDING: 'game.mulliganOverlay.status.deciding',
      SCRYING: 'game.mulliganOverlay.status.scrying',
      READY: 'game.mulliganOverlay.status.ready',
    };

    return labels[this.normalizeStatus(status)];
  }

  normalizedStatus(status: MulliganStatusCandidate): MulliganPlayerStatus {
    return this.normalizeStatus(status);
  }

  selectedCard(card: GameCardInstance): boolean {
    return this.selectedBottomIdSet().has(card.instanceId);
  }

  bottomCardActionLabelKey(card: GameCardInstance): string {
    return this.selectedCard(card)
      ? 'game.mulliganOverlay.actions.removeFromBottom'
      : 'game.mulliganOverlay.actions.putOnBottom';
  }

  bottomCardActionDisabled(card: GameCardInstance): boolean {
    return this.pending()
      || !this.canSelectBottomCards()
      || (!this.selectedCard(card) && this.selectedBottomIds().length >= this.bottomSelectionCount());
  }

  toggleBottomSelection(event: MouseEvent, card: GameCardInstance): void {
    event.preventDefault();
    event.stopPropagation();

    this.toggleBottomCard(card);
  }

  toggleBottomSelectionFromButton(event: MouseEvent, card: GameCardInstance): void {
    event.preventDefault();
    event.stopPropagation();

    this.toggleBottomCard(card);
  }

  takeMulligan(): void {
    if (this.pending() || this.status() !== 'DECIDING' || this.currentMulligan()?.canTakeAnotherMulligan === false) {
      return;
    }

    this.selectedBottomIds.set([]);
    this.facePreviewIndexes.set({});
    this.animations.animateHandExit();
    this.take.emit();
  }

  acceptMulligan(): void {
    if (this.acceptDisabled() || !this.canSubmitBottomSelection()) {
      return;
    }

    const selectedBottomIds = this.bottomSelectionCount() > 0 ? this.selectedBottomIds() : [];
    if (selectedBottomIds.length > 0) {
      this.animations.animateSelectedCardsToLibrary(selectedBottomIds, this.rule());
    }

    this.keep.emit(selectedBottomIds);
  }

  confirmScry(destination: ScryDestination): void {
    if (this.pending() || this.status() !== 'SCRYING') {
      return;
    }

    this.scryConfirmed.emit(destination);
  }

  stopCardClick(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
  }

  previewCard(card: GameCardInstance): GameCardInstance {
    const faceIndex = this.facePreviewIndexes()[card.instanceId];

    return faceIndex === undefined ? card : { ...card, activeFaceIndex: faceIndex };
  }

  canShowFaceToggle(card: GameCardInstance): boolean {
    return card.hidden !== true
      && card.faceDown !== true
      && canShowAlternateFaceToggle(card);
  }

  lookAtOtherFace(event: Event, card: GameCardInstance): void {
    this.stopFaceToggleEvent(event);
    const nextFaceIndex = nextCardFaceIndex(card, this.facePreviewIndexes()[card.instanceId] ?? activeCardFaceIndex(card));
    if (nextFaceIndex === null) {
      return;
    }

    this.facePreviewIndexes.update((indexes) => ({ ...indexes, [card.instanceId]: nextFaceIndex }));
    this.animations.animateFaceFlip(card.instanceId);
  }

  resetFacePreview(card: GameCardInstance): void {
    if (this.facePreviewIndexes()[card.instanceId] === undefined) {
      return;
    }

    this.facePreviewIndexes.update((indexes) => {
      const { [card.instanceId]: _removed, ...rest } = indexes;

      return rest;
    });
    this.animations.animateFaceFlip(card.instanceId);
  }

  stopFaceToggleEvent(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
  }

  stopFaceTogglePointer(event: PointerEvent): void {
    event.stopPropagation();
    if (event.button === 0) {
      event.preventDefault();
    }
  }

  private canSelectBottomCards(): boolean {
    return this.canSubmitBottomSelection()
      && this.bottomSelectionCount() > 0
      && (this.rule() === 'LONDON' || this.rule() === 'GENEROUS');
  }

  private canSubmitBottomSelection(): boolean {
    return this.status() === 'DECIDING';
  }

  private toggleBottomCard(card: GameCardInstance): void {
    if (this.pending() || !this.canSelectBottomCards()) {
      return;
    }

    const selected = this.selectedBottomIds();
    if (selected.includes(card.instanceId)) {
      this.selectedBottomIds.set(selected.filter((instanceId) => instanceId !== card.instanceId));
      return;
    }

    if (selected.length >= this.bottomSelectionCount()) {
      return;
    }

    this.selectedBottomIds.set([...selected, card.instanceId]);
  }

  private handAnimationKey(): string {
    return [
      this.currentMulligan()?.mulligansTaken ?? 0,
      ...this.hand().map((card) => card.instanceId),
    ].join('|');
  }

  private descriptionKeyForRule(rule: MulliganRule): string {
    return `rooms.roomSetupControls.mulliganDescriptions.${rule.toLowerCase()}`;
  }

  private normalizeStatus(status: MulliganStatusCandidate): MulliganPlayerStatus {
    return status === 'SCRYING' || status === 'READY' ? status : 'DECIDING';
  }
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameNumberRecord(left: Readonly<Record<string, number>>, right: Readonly<Record<string, number>>): boolean {
  const leftEntries = Object.entries(left);

  return leftEntries.length === Object.keys(right).length
    && leftEntries.every(([key, value]) => right[key] === value);
}
