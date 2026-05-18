import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, output, signal } from '@angular/core';
import { BodyScrollLockService } from '../../../shared/services/body-scroll-lock.service';
import {
  ROLL_OPTIONS,
  RollKind,
  RollResult,
  rollOption,
} from './roll';

@Component({
  selector: 'app-roll-modal',
  templateUrl: './roll-modal.component.html',
  styleUrl: './roll-modal.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RollModalComponent implements OnInit, OnDestroy {
  private readonly bodyScrollLock = inject(BodyScrollLockService);

  readonly closed = output<void>();
  readonly rolled = output<RollResult>();
  readonly rollOptions = ROLL_OPTIONS;
  readonly selectedKind = signal<RollKind>('coin');
  readonly rollResult = signal<RollResult | null>(null);
  readonly selectedLabel = computed(() => (
    this.rollOptions.find((option) => option.kind === this.selectedKind())?.label ?? this.rollOptions[0].label
  ));

  ngOnInit(): void {
    this.bodyScrollLock.lock();
  }

  ngOnDestroy(): void {
    this.bodyScrollLock.unlock();
  }

  selectRoll(kind: RollKind): void {
    this.selectedKind.set(kind);
    this.rollResult.set(null);
  }

  isSelected(kind: RollKind): boolean {
    return this.selectedKind() === kind;
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
    const result = rollOption(this.selectedKind());
    this.rollResult.set(result);
    this.rolled.emit(result);
  }

  close(): void {
    this.closed.emit();
  }
}
