import { ChangeDetectionStrategy, Component, ElementRef, HostListener, inject, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule } from 'lucide-angular';
import { ManaSymbolsComponent } from '../../../../../shared/mana/mana-symbols/mana-symbols.component';
import { PrettyScrollDirective } from '../../../../../shared/ui/pretty-scroll/pretty-scroll.directive';

export interface WaitingDeckOption {
  id: string;
  name: string;
  colorIdentity: readonly string[];
  fallback: string;
  invalid: boolean;
  validating: boolean;
}

@Component({
  selector: 'app-waiting-room-deck-selector',
  imports: [FormsModule, LucideAngularModule, ManaSymbolsComponent, PrettyScrollDirective],
  templateUrl: './waiting-room-deck-selector.component.html',
  styleUrl: './waiting-room-deck-selector.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WaitingRoomDeckSelectorComponent {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly deckOptions = input<readonly WaitingDeckOption[]>([]);
  readonly selectedDeck = input<WaitingDeckOption | null>(null);
  readonly selectedDeckId = input('');
  readonly selectorOpen = input(false);
  readonly updatingDeck = input(false);

  readonly selectorToggled = output<void>();
  readonly selectorClosed = output<void>();
  readonly selectedDeckIdChange = output<string>();
  readonly deckSelected = output<string>();
  readonly randomDeckRequested = output<void>();

  @HostListener('document:click', ['$event'])
  closeFromOutside(event: MouseEvent): void {
    if (!this.selectorOpen() || !(event.target instanceof Element)) {
      return;
    }

    if (!this.host.nativeElement.contains(event.target)) {
      this.selectorClosed.emit();
    }
  }
}
