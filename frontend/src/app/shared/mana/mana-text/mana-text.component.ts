import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { ManaSymbolService } from '../mana-symbol.service';

@Component({
  selector: 'app-mana-text',
  templateUrl: './mana-text.component.html',
  styleUrl: './mana-text.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ManaTextComponent {
  private readonly manaSymbols = inject(ManaSymbolService);

  readonly text = input<string | null | undefined>(null);
  readonly parts = computed(() => this.manaSymbols.parseText(this.text()));
}
