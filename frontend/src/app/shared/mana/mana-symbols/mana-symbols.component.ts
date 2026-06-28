import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { ManaStylesService } from '../mana-styles.service';
import { ManaSymbolService } from '../mana-symbol.service';

export type ManaSymbolsSize = 'normal' | 'small';

@Component({
  selector: 'app-mana-symbols',
  templateUrl: './mana-symbols.component.html',
  styleUrl: './mana-symbols.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ManaSymbolsComponent {
  private readonly manaSymbols = inject(ManaSymbolService);
  private readonly manaStyles = inject(ManaStylesService);

  readonly value = input<string | null | undefined>(null);
  readonly symbols = input<readonly string[] | null | undefined>(null);
  readonly fallback = input('');
  readonly size = input<ManaSymbolsSize>('normal');
  readonly costBackground = input(true);

  readonly tokens = computed(() => {
    const symbols = this.symbols();

    return symbols ? this.manaSymbols.parseSymbols(symbols) : this.manaSymbols.parseCost(this.value());
  });
  readonly ariaLabel = computed(() => this.tokens().map((token) => token.label).join(' ') || this.fallback());

  constructor() {
    this.manaStyles.load();
  }

  tokenClassName(className: string): string {
    return this.costBackground() ? className : className.replace(/\bms-cost\b/g, '').replace(/\s+/g, ' ').trim();
  }
}
