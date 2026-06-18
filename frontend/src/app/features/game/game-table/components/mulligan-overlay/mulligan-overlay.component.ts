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

type ScryDestination = 'TOP' | 'BOTTOM';

@Component({
  selector: 'app-mulligan-overlay',
  imports: [GameCardViewComponent, LucideAngularModule],
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
  readonly selectedCountLabel = computed(() => `${this.selectedBottomIds().length} / ${this.bottomSelectionCount()} seleccionadas`);
  readonly acceptDisabled = computed(() =>
    this.pending()
      || (this.bottomSelectionCount() > 0 && this.selectedBottomIds().length !== this.bottomSelectionCount()),
  );
  readonly otherPlayers = computed(() => {
    const currentPlayerId = this.currentPlayerId();

    return this.publicPlayers().filter((player) => player.playerId !== currentPlayerId);
  });
  readonly ruleDescription = computed(() => this.descriptionForRule());
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

  ruleLabel(rule: MulliganRule = this.rule()): string {
    const labels: Record<MulliganRule, string> = {
      LONDON: 'Londres',
      VANCOUVER: 'Vancouver',
      PARIS: 'París',
      GENEROUS: 'Generoso',
    };

    return labels[rule];
  }

  statusLabel(status: MulliganPlayerStatus): string {
    const labels: Record<MulliganPlayerStatus, string> = {
      DECIDING: 'decidiendo',
      SCRYING: 'haciendo scry',
      READY: 'listo',
    };

    return labels[status];
  }

  selectedCard(card: GameCardInstance): boolean {
    return this.selectedBottomIdSet().has(card.instanceId);
  }

  bottomCardActionLabel(card: GameCardInstance): string {
    return this.selectedCard(card) ? 'Quitar del fondo' : 'Mandar al fondo';
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

  private descriptionForRule(): readonly string[] {
    const state = this.currentMulligan();
    const drawCount = state?.drawCount ?? 0;
    const bottomSelectionCount = this.bottomSelectionCount();

    switch (this.rule()) {
      case 'LONDON':
        return bottomSelectionCount === 0
          ? ['Roba 7. No tienes que mandar cartas al fondo.']
          : [
              `Roba 7. Elige ${bottomSelectionCount} carta(s) para mandar al fondo.`,
              'El orden elegido será el orden en el fondo.',
            ];
      case 'VANCOUVER':
        return state?.needsScryAfterKeep
          ? [`Roba ${drawCount} carta(s).`, 'Después harás Scry 1.']
          : [`Roba ${drawCount} carta(s).`];
      case 'PARIS':
        return [`Roba ${drawCount} carta(s).`];
      case 'GENEROUS':
        return bottomSelectionCount === 0
          ? [`Roba ${drawCount} carta(s). No tienes que mandar cartas al fondo.`]
          : [
              `Roba ${drawCount} carta(s). Elige ${bottomSelectionCount} para mandar al fondo en orden aleatorio.`,
              'El orden final será aleatorio.',
            ];
    }
  }
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
