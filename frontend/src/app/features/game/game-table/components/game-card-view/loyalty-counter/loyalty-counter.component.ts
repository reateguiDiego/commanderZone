import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

type StatPulse = 'increase' | 'decrease' | null;

@Component({
  selector: 'app-loyalty-counter',
  templateUrl: './loyalty-counter.component.html',
  styleUrl: './loyalty-counter.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoyaltyCounterComponent {
  readonly value = input.required<number>();
  readonly pulse = input<StatPulse>(null);
  readonly entrySettling = input(false);
  readonly loyaltyChanged = output<{ event: MouseEvent; delta: number }>();

  changeLoyaltyFromPointer(event: PointerEvent): void {
    event.preventDefault();
    event.stopPropagation();
    if (event.button !== 0 && event.button !== 2) {
      return;
    }

    const delta = event.button === 2 ? -1 : 1;
    this.loyaltyChanged.emit({ event, delta });
  }

  stopPointer(event: PointerEvent): void {
    if (event.button === 2) {
      event.preventDefault();
    }
    event.stopPropagation();
  }

  stopClick(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
  }

  stopContextMenu(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
  }

  stopDoubleClick(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
  }
}
