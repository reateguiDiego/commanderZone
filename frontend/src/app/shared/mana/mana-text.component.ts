import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { ManaSymbolService } from './mana-symbol.service';

@Component({
  selector: 'app-mana-text',
  template: `
    <span class="mana-text">
      @for (part of parts(); track $index) {
        @if (part.kind === 'text') {
          {{ part.value }}
        } @else if (part.token.known) {
          <i [class]="part.token.className" [title]="part.token.raw" [attr.aria-label]="part.token.raw"></i>
        } @else {
          <span class="mana-symbol-fallback">{{ part.token.raw }}</span>
        }
      }
    </span>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ManaTextComponent {
  private readonly manaSymbols = inject(ManaSymbolService);

  readonly text = input<string | null | undefined>(null);
  readonly parts = computed(() => this.manaSymbols.parseText(this.text()));
}
