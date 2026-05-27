import { ChangeDetectionStrategy, Component, ElementRef, HostListener, computed, inject, input, output, signal } from '@angular/core';
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
  readonly randomDeckOptionValue = '__random_deck__';
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly menuGapPx = 6;

  readonly deckOptions = input<readonly WaitingDeckOption[]>([]);
  readonly selectedDeck = input<WaitingDeckOption | null>(null);
  readonly selectedDeckId = input('');
  readonly selectorOpen = input(false);
  readonly updatingDeck = input(false);
  readonly canRoll = input(false);
  readonly rolling = input(false);
  readonly showRandomDeckOption = computed(() => this.deckOptions().length > 1);
  readonly menuDirection = signal<'down' | 'up'>('down');

  readonly selectorToggled = output<void>();
  readonly selectorClosed = output<void>();
  readonly selectedDeckIdChange = output<string>();
  readonly deckSelected = output<string>();
  readonly randomDeckRequested = output<void>();
  readonly rollRequested = output<void>();

  toggleSelector(): void {
    if (!this.selectorOpen()) {
      this.updateMenuDirection();
    }

    this.selectorToggled.emit();
  }

  selectNativeDeck(deckId: string): void {
    if (deckId === this.randomDeckOptionValue) {
      this.randomDeckRequested.emit();
      return;
    }

    this.selectedDeckIdChange.emit(deckId);
  }

  @HostListener('document:click', ['$event'])
  closeFromOutside(event: MouseEvent): void {
    if (!this.selectorOpen() || !(event.target instanceof Element)) {
      return;
    }

    if (!this.host.nativeElement.contains(event.target)) {
      this.selectorClosed.emit();
    }
  }

  @HostListener('window:resize')
  @HostListener('window:scroll')
  updateMenuDirection(): void {
    const trigger = this.host.nativeElement.querySelector<HTMLElement>('.deck-select-trigger');
    if (!trigger) {
      this.menuDirection.set('down');
      return;
    }

    const triggerBounds = trigger.getBoundingClientRect();
    const menu = this.host.nativeElement.querySelector<HTMLElement>('.deck-select-menu');
    const estimatedMenuHeight = menu?.getBoundingClientRect().height
      ?? Math.min(288, Math.max(160, (window.innerHeight || 0) * 0.52));
    const spaceBelow = (window.innerHeight || 0) - triggerBounds.bottom - this.menuGapPx;
    const spaceAbove = triggerBounds.top - this.menuGapPx;

    this.menuDirection.set(spaceBelow < estimatedMenuHeight && spaceAbove > spaceBelow ? 'up' : 'down');
  }
}
