import { RuntimeTranslatePipe } from '../../../../../../core/localization/runtime-translate.pipe';
import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { GameCardStatValue } from '../../../../../../core/models/game.model';

export type StatCounterPulse = 'increase' | 'decrease' | null;
export type StatCounterChangeEvent = { event: MouseEvent; delta: number };

@Component({
  selector: 'app-stat-counter',
  imports: [RuntimeTranslatePipe],
  templateUrl: './stat-counter.component.html',
  styleUrl: './stat-counter.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StatCounterComponent {
  readonly value = input.required<GameCardStatValue>();
  readonly pulse = input<StatCounterPulse>(null);
  readonly entrySettling = input(false);
  readonly inline = input(false);
  readonly icon = input.required<string>();
  readonly iconClass = input('');
  readonly counterClass = input('');
  readonly titleTranslation = input('game.loyaltyCounter.loyaltyLeftClickAddsRightClickRemoves');
  readonly ariaLabelTranslation = input('game.loyaltyCounter.loyalty');
  readonly changed = output<StatCounterChangeEvent>();

  protected containerClass(): string {
    return ['stat-counter', this.counterClass()]
      .filter((value): value is string => value !== '')
      .join(' ');
  }

  protected shapeClass(): string {
    return ['stat-counter-shape', this.counterClass() ? `${this.counterClass()}-shape` : '']
      .filter((value): value is string => value !== '')
      .join(' ');
  }

  protected valueClass(): string {
    return ['stat-counter-value', this.counterClass() ? `${this.counterClass()}-value` : '']
      .filter((value): value is string => value !== '')
      .join(' ');
  }

  changeFromPointer(event: PointerEvent): void {
    event.preventDefault();
    event.stopPropagation();

    if (event.button !== 0 && event.button !== 2) {
      return;
    }

    const delta = event.button === 2 ? -1 : 1;
    this.changed.emit({ event, delta });
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
