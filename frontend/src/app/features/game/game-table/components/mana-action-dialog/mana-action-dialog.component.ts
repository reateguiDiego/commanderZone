import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { ManaSymbolsComponent } from '../../../../../shared/mana/mana-symbols/mana-symbols.component';
import { ManaPoolColor, ManaSourceSuggestion } from '../../utils/mana-source-detector';

export interface ManaActionDialogValueChange {
  readonly color?: ManaPoolColor;
  readonly amount?: number;
}

@Component({
  selector: 'app-mana-action-dialog',
  imports: [LucideAngularModule, ManaSymbolsComponent],
  templateUrl: './mana-action-dialog.component.html',
  styleUrl: './mana-action-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ManaActionDialogComponent {
  readonly suggestion = input.required<ManaSourceSuggestion>();
  readonly selectedColor = input<ManaPoolColor | null>(null);
  readonly amount = input(1);

  readonly valueChanged = output<ManaActionDialogValueChange>();
  readonly confirmed = output<void>();
  readonly cancelled = output<void>();

  readonly canAddMana = computed(() => !this.suggestion().manualOnly);
  readonly confirmLabel = computed(() => this.canAddMana() ? 'Add mana' : 'Close');

  updateColor(color: ManaPoolColor): void {
    this.valueChanged.emit({ color });
  }

  updateAmount(event: Event): void {
    if (!(event.target instanceof HTMLInputElement)) {
      return;
    }

    const parsed = Math.floor(Number(event.target.value));
    this.valueChanged.emit({ amount: Number.isFinite(parsed) ? Math.max(1, parsed) : 1 });
  }

  stepAmount(delta: number): void {
    this.valueChanged.emit({ amount: Math.max(1, this.amount() + delta) });
  }
}
