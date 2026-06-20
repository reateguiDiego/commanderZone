import { ChangeDetectionStrategy, Component, HostBinding, input, output } from '@angular/core';
import { GameCardStatValue } from '../../../../../../core/models/game.model';
import { StatCounterChangeEvent, StatCounterComponent } from '../stat-counter/stat-counter.component';

type StatPulse = 'increase' | 'decrease' | null;

@Component({
  selector: 'app-loyalty-counter',
  imports: [StatCounterComponent],
  templateUrl: './loyalty-counter.component.html',
  styleUrl: './loyalty-counter.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoyaltyCounterComponent {
  readonly value = input.required<GameCardStatValue>();
  readonly pulse = input<StatPulse>(null);
  readonly entrySettling = input(false);
  readonly inline = input(false);
  readonly loyaltyChanged = output<StatCounterChangeEvent>();

  @HostBinding('class.inline-loyalty-counter')
  get inlineLoyaltyCounter(): boolean {
    return this.inline();
  }

  onChanged(event: StatCounterChangeEvent): void {
    this.loyaltyChanged.emit(event);
  }
}
