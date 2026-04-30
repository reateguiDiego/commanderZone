import { ChangeDetectionStrategy, Component, computed, output, signal } from '@angular/core';
import {
  TABLE_ASSISTANT_ROLL_OPTIONS,
  TableAssistantRollKind,
  TableAssistantRollResult,
  rollTableAssistantOption,
} from '../domain/table-assistant-roll';

@Component({
  selector: 'app-table-assistant-roll-modal',
  templateUrl: './table-assistant-roll-modal.component.html',
  styleUrl: './table-assistant-roll-modal.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TableAssistantRollModalComponent {
  readonly closed = output<void>();
  readonly rollOptions = TABLE_ASSISTANT_ROLL_OPTIONS;
  readonly selectedKind = signal<TableAssistantRollKind>('coin');
  readonly rollResult = signal<TableAssistantRollResult | null>(null);
  readonly selectedLabel = computed(() => (
    this.rollOptions.find((option) => option.kind === this.selectedKind())?.label ?? this.rollOptions[0].label
  ));

  selectRoll(kind: TableAssistantRollKind): void {
    this.selectedKind.set(kind);
    this.rollResult.set(null);
  }

  isSelected(kind: TableAssistantRollKind): boolean {
    return this.selectedKind() === kind;
  }

  rollIconSrc(kind: TableAssistantRollKind): string {
    const iconByKind: Record<TableAssistantRollKind, string> = {
      coin: '/assets/icons/coin.png',
      d4: '/assets/icons/dice_4.png',
      d6: '/assets/icons/dice_6.png',
      d10: '/assets/icons/dice_10.png',
      d20: '/assets/icons/dice_20.png',
    };

    return iconByKind[kind];
  }

  roll(): void {
    this.rollResult.set(rollTableAssistantOption(this.selectedKind()));
  }

  close(): void {
    this.closed.emit();
  }
}
