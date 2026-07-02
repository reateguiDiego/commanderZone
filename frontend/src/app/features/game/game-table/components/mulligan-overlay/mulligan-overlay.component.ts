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

type ScryDestination = 'TOP' | 'BOTTOM';

interface MulliganRuleDescriptionLine {
  readonly key: string;
  readonly params?: Readonly<Record<string, number>>;
}

@Component({
  selector: 'app-mulligan-overlay',
  imports: [GameCardViewComponent, LucideAngularModule, RuntimeTranslatePipe],
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
  readonly cardImage = input.required<(card: GameCardInstance) => string | null>();

  readonly take = output<void>();
  readonly keep = output<readonly string[]>();
  readonly scryConfirmed = output<ScryDestination>();

  readonly selectedBottomIds = signal<readonly string[]>([]);
  readonly selectedBottomCards = computed(() => {
    const cardsById = new Map(this.hand().map((card) => [card.instanceId, card]));

    return this.selectedBottomIds()
      .map((instanceId) => cardsById.get(instanceId) ?? null)
      .filter((card): card is GameCardInstance => card !== null);
  });
  readonly selectedBottomIdSet = computed(() => new Set(this.selectedBottomIds()));
  readonly isOpen = computed(() => this.gamePhase() === 'MULLIGAN');
  readonly rule = computed<MulliganRule>(() => this.currentMulligan()?.rule ?? this.config()?.rule ?? 'LONDON');
  readonly bottomOrderMode = computed<BottomOrderMode>(() => this.currentMulligan()?.bottomOrderMode ?? 'NONE');
  readonly status = computed<MulliganPlayerStatus>(() => this.currentMulligan()?.status ?? 'DECIDING');
  readonly bottomSelectionCount = computed(() => this.currentMulligan()?.bottomSelectionCount ?? 0);
  readonly selectedCountParams = computed(() => ({
    selected: this.selectedBottomIds().length,
    total: this.bottomSelectionCount(),
  }));
  readonly acceptDisabled = computed(() =>
    this.pending()
      || (this.bottomSelectionCount() > 0 && this.selectedBottomIds().length !== this.bottomSelectionCount()),
  );
  readonly otherPlayers = computed(() => {
    const currentPlayerId = this.currentPlayerId();

    return this.publicPlayers().filter((player) => player.playerId !== currentPlayerId);
  });
  readonly ruleDescription = computed<readonly MulliganRuleDescriptionLine[]>(() => this.descriptionForRule());
  readonly scryCard = computed(() => this.currentMulligan()?.scryCard ?? null);

  private readonly animations = new MulliganOverlayAnimations(
    inject<ElementRef<HTMLElement>>(ElementRef),
    inject(NgZone),
  );

  constructor() {
    effect(() => {
      const validHandIds = new Set(this.hand().map((card) => card.instanceId));
      const bottomSelectionCount = this.bottomSelectionCount();
      const status = this.status();
      const validSelection = this.selectedBottomIds()
        .filter((instanceId) => validHandIds.has(instanceId))
        .slice(0, bottomSelectionCount);

      if (status !== 'DECIDING' || bottomSelectionCount === 0) {
        if (this.selectedBottomIds().length > 0) {
          this.selectedBottomIds.set([]);
        }
        return;
      }

      if (!sameStringArray(validSelection, this.selectedBottomIds())) {
        this.selectedBottomIds.set(validSelection);
      }
    });
  }

  ngAfterViewChecked(): void {
    if (!this.isOpen()) {
      this.animations.resetTransientState();
      return;
    }

    this.animations.syncHand(this.status() === 'DECIDING' ? this.handAnimationKey() : '');
    this.animations.syncPills(this.selectedBottomIds());
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

  statusLabelKey(status: MulliganPlayerStatus): string {
    const labels: Record<MulliganPlayerStatus, string> = {
      DECIDING: 'game.mulliganOverlay.status.deciding',
      SCRYING: 'game.mulliganOverlay.status.scrying',
      READY: 'game.mulliganOverlay.status.ready',
    };

    return labels[status];
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

  removeBottomCard(instanceId: string): void {
    if (this.status() !== 'DECIDING') {
      return;
    }

    this.animations.animatePillRemoval(instanceId);
    this.selectedBottomIds.set(this.selectedBottomIds().filter((candidate) => candidate !== instanceId));
  }

  moveBottomCard(index: number, delta: -1 | 1): void {
    if (this.rule() !== 'LONDON' || this.status() !== 'DECIDING') {
      return;
    }

    const nextIndex = index + delta;
    const selected = [...this.selectedBottomIds()];
    if (nextIndex < 0 || nextIndex >= selected.length) {
      return;
    }

    [selected[index], selected[nextIndex]] = [selected[nextIndex], selected[index]];
    this.selectedBottomIds.set(selected);
  }

  takeMulligan(): void {
    if (this.pending() || this.status() !== 'DECIDING' || this.currentMulligan()?.canTakeAnotherMulligan === false) {
      return;
    }

    this.selectedBottomIds.set([]);
    this.animations.animateHandExit();
    this.take.emit();
  }

  acceptMulligan(): void {
    if (this.acceptDisabled() || this.status() !== 'DECIDING') {
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

  private canSelectBottomCards(): boolean {
    return this.status() === 'DECIDING'
      && this.bottomSelectionCount() > 0
      && (this.rule() === 'LONDON' || this.rule() === 'GENEROUS');
  }

  private toggleBottomCard(card: GameCardInstance): void {
    if (this.pending() || !this.canSelectBottomCards()) {
      return;
    }

    const selected = this.selectedBottomIds();
    if (selected.includes(card.instanceId)) {
      this.animations.animatePillRemoval(card.instanceId);
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

  private descriptionForRule(): readonly MulliganRuleDescriptionLine[] {
    const state = this.currentMulligan();
    const drawCount = state?.drawCount ?? 0;
    const bottomSelectionCount = this.bottomSelectionCount();

    switch (this.rule()) {
      case 'LONDON':
        return bottomSelectionCount === 0
          ? [{ key: 'game.mulliganOverlay.description.londonNoBottom' }]
          : [
              { key: 'game.mulliganOverlay.description.londonChooseBottom', params: { count: bottomSelectionCount } },
              { key: 'game.mulliganOverlay.description.londonBottomOrder' },
            ];
      case 'VANCOUVER':
        return state?.needsScryAfterKeep
          ? [
              { key: 'game.mulliganOverlay.description.drawCards', params: { count: drawCount } },
              { key: 'game.mulliganOverlay.description.vancouverScry' },
            ]
          : [{ key: 'game.mulliganOverlay.description.drawCards', params: { count: drawCount } }];
      case 'PARIS':
        return [{ key: 'game.mulliganOverlay.description.drawCards', params: { count: drawCount } }];
      case 'GENEROUS':
        return bottomSelectionCount === 0
          ? [{ key: 'game.mulliganOverlay.description.generousNoBottom', params: { count: drawCount } }]
          : [
              { key: 'game.mulliganOverlay.description.generousChooseBottom', params: { drawCount, bottomCount: bottomSelectionCount } },
              { key: 'game.mulliganOverlay.description.generousRandomOrder' },
            ];
    }
  }
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
