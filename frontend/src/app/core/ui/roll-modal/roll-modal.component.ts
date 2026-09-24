import { RuntimeTranslatePipe } from '../../localization/runtime-translate.pipe';
import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, effect, inject, input, output, signal } from '@angular/core';
import { gsap } from 'gsap';
import { BodyScrollLockService } from '../../../shared/services/body-scroll-lock.service';
import { CzButtonDirective } from '../../../shared/ui/button/button.directive';
import {
  ROLL_OPTIONS,
  displayedRollResult,
  RollKind,
  RollResult,
  rollOption,
} from './roll';

export type RollModalSize = 'default' | 'big';

const ALL_ROLL_KINDS = ROLL_OPTIONS.map((option) => option.kind) as readonly RollKind[];

@Component({
  selector: 'app-roll-modal',
  imports: [RuntimeTranslatePipe, CzButtonDirective],
  templateUrl: './roll-modal.component.html',
  styleUrl: './roll-modal.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RollModalComponent implements OnInit, OnDestroy {
  private readonly bodyScrollLock = inject(BodyScrollLockService);
  private resultAnimation: gsap.core.Tween | null = null;

  readonly size = input<RollModalSize>('default');
  readonly authoritative = input(false);
  readonly pending = input(false);
  readonly failed = input(false);
  readonly rollEnabled = input(true);
  readonly result = input<string | null>(null);
  readonly availableKinds = input<readonly RollKind[]>(ALL_ROLL_KINDS);
  readonly title = input('shared.text.rollDice');
  readonly notice = input<string | null>(null);
  readonly closed = output<void>();
  readonly rolled = output<RollResult>();
  readonly rollRequested = output<RollKind>();
  readonly resultRevealed = output<void>();
  readonly selectionChanged = output<RollKind>();
  readonly selectedKind = signal<RollKind>('coin');
  readonly rollOptions = computed(() => {
    const allowedKinds = new Set(this.availableKinds());
    const options = ROLL_OPTIONS.filter((option) => allowedKinds.has(option.kind));

    return options.length > 0 ? options : ROLL_OPTIONS;
  });
  private readonly activeKind = computed<RollKind>(() => (
    this.rollOptions().some((option) => option.kind === this.selectedKind())
      ? this.selectedKind()
      : this.rollOptions()[0]?.kind ?? 'coin'
  ));
  readonly rollResult = signal<RollResult | null>(null);
  readonly rollingResult = signal<string | null>(null);
  readonly isRolling = signal(false);
  private readonly minimumRollDurationElapsed = signal(false);
  readonly displayedResult = computed(() => {
    const result = this.authoritative()
      ? this.isRolling() ? this.rollingResult() : this.result()
      : this.rollResult()?.finalResult ?? null;

    return result === null ? null : displayedRollResult(this.activeKind(), result);
  });
  readonly interactionLocked = computed(() => !this.rollEnabled() || this.pending() || this.isRolling());
  readonly hasResolvedAuthoritativeResult = computed(() =>
    this.authoritative() && !this.isRolling() && this.result() !== null,
  );
  readonly selectedLabel = computed(() => (
    this.rollOptions().find((option) => option.kind === this.activeKind())?.label ?? ROLL_OPTIONS[0].label
  ));

  ngOnInit(): void {
    this.bodyScrollLock.lock();
  }

  ngOnDestroy(): void {
    this.resultAnimation?.kill();
    this.bodyScrollLock.unlock();
  }

  constructor() {
    effect(() => {
      if (this.authoritative() && this.failed()) {
        this.cancelAuthoritativeRoll();
        return;
      }

      if (this.authoritative() && this.result() !== null && this.minimumRollDurationElapsed()) {
        this.finishAuthoritativeRoll();
      }
    });
  }

  selectRoll(kind: RollKind): void {
    if (this.interactionLocked()) {
      return;
    }

    if (!this.rollOptions().some((option) => option.kind === kind)) {
      return;
    }

    this.selectedKind.set(kind);
    this.rollResult.set(null);
    this.selectionChanged.emit(kind);
  }

  isSelected(kind: RollKind): boolean {
    return this.activeKind() === kind;
  }

  rollIconSrc(kind: RollKind): string {
    const iconByKind: Record<RollKind, string> = {
      coin: '/assets/icons/chance/coin.png',
      d4: '/assets/icons/chance/dice_4.png',
      d6: '/assets/icons/chance/dice_6.png',
      d10: '/assets/icons/chance/dice_10.png',
      d20: '/assets/icons/chance/dice_20.png',
    };

    return iconByKind[kind];
  }

  roll(): void {
    if (this.interactionLocked()) {
      return;
    }

    if (this.authoritative()) {
      this.startAuthoritativeRoll();
      this.rollRequested.emit(this.activeKind());
      return;
    }

    const result = rollOption(this.activeKind());
    this.rollResult.set(result);
    this.rolled.emit(result);
  }

  private startAuthoritativeRoll(): void {
    this.resultAnimation?.kill();
    this.minimumRollDurationElapsed.set(false);
    this.isRolling.set(true);

    const animationState = { step: 0 };
    const stepCount = 20;
    let lastRenderedStep = -1;
    this.rollingResult.set(this.randomVisualResult(this.activeKind()));
    this.resultAnimation = gsap.to(animationState, {
      step: stepCount,
      duration: 3,
      ease: 'none',
      onUpdate: () => {
        const currentStep = Math.floor(animationState.step);
        if (currentStep === lastRenderedStep) {
          return;
        }

        lastRenderedStep = currentStep;
        this.rollingResult.set(this.randomVisualResult(this.activeKind()));
      },
      onComplete: () => {
        this.resultAnimation = null;
        this.minimumRollDurationElapsed.set(true);
        this.finishAuthoritativeRoll();
      },
    });
  }

  private finishAuthoritativeRoll(): void {
    if (!this.isRolling() || !this.minimumRollDurationElapsed() || this.result() === null) {
      return;
    }

    this.isRolling.set(false);
    this.rollingResult.set(null);
    this.resultRevealed.emit();
  }

  private cancelAuthoritativeRoll(): void {
    this.resultAnimation?.kill();
    this.resultAnimation = null;
    this.minimumRollDurationElapsed.set(false);
    this.isRolling.set(false);
    this.rollingResult.set(null);
  }

  private randomVisualResult(kind: RollKind): string {
    if (kind === 'coin') {
      return Math.random() < 0.5 ? 'heads' : 'tails';
    }

    const sides: Record<Exclude<RollKind, 'coin'>, number> = {
      d4: 4,
      d6: 6,
      d10: 10,
      d20: 20,
    };

    return String(Math.floor(Math.random() * sides[kind]) + 1);
  }

  blockBackgroundInteraction(event: Event): void {
    if (event.target !== event.currentTarget) {
      event.stopPropagation();
      return;
    }

    event.preventDefault();
    event.stopPropagation();
  }

  close(): void {
    this.closed.emit();
  }
}
