import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { ManaSymbolService } from './mana-symbol.service';

@Component({
  selector: 'app-mana-symbols',
  template: `
    <span class="mana-symbols" [attr.aria-label]="ariaLabel()">
      @for (token of tokens(); track $index + token.raw) {
        @if (token.known) {
          <i [class]="token.className" [title]="token.raw" aria-hidden="true"></i>
        } @else {
          <span class="mana-symbol-fallback">{{ token.raw }}</span>
        }
      } @empty {
        @if (fallback()) {
          <span class="mana-symbol-fallback">{{ fallback() }}</span>
        }
      }
    </span>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ManaSymbolsComponent {
  private readonly manaSymbols = inject(ManaSymbolService);

  readonly value = input<string | null | undefined>(null);
  readonly symbols = input<readonly string[] | null | undefined>(null);
  readonly fallback = input('');

  readonly tokens = computed(() => {
    const symbols = this.symbols();

    return symbols ? this.manaSymbols.parseSymbols(symbols) : this.manaSymbols.parseCost(this.value());
  });
  readonly ariaLabel = computed(() => this.tokens().map((token) => token.raw).join(' ') || this.fallback());
}
