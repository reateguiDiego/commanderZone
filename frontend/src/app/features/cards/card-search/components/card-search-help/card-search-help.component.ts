import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, inject, input, output, signal } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { RuntimeTranslatePipe } from '../../../../../core/localization/runtime-translate.pipe';
import { CzButtonDirective } from '../../../../../shared/ui/button/button.directive';

@Component({
  selector: 'app-card-search-help',
  imports: [LucideAngularModule, RuntimeTranslatePipe, CzButtonDirective],
  templateUrl: './card-search-help.component.html',
  styleUrl: './card-search-help.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CardSearchHelpComponent {
  private readonly document = inject(DOCUMENT);
  private readonly elementRef = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);

  readonly triggerVisible = input(true);
  readonly externalOpen = input<boolean | null>(null, { alias: 'open' });
  readonly openChange = output<boolean>();
  readonly internalOpen = signal(false);
  readonly open = computed(() => this.externalOpen() ?? this.internalOpen());

  constructor() {
    const closeFromOutsidePointerDown = (event: Event): void => this.closeFromOutsidePointerDown(event);

    this.document.addEventListener('pointerdown', closeFromOutsidePointerDown, true);
    this.destroyRef.onDestroy(() => {
      this.document.removeEventListener('pointerdown', closeFromOutsidePointerDown, true);
    });
  }

  toggle(): void {
    this.setOpen(!this.open());
  }

  private closeFromOutsidePointerDown(event: Event): void {
    if (!this.open()) {
      return;
    }

    const target = event.target;
    if (target instanceof Node && this.elementRef.nativeElement.contains(target)) {
      return;
    }

    this.setOpen(false);
  }

  private setOpen(open: boolean): void {
    if (this.externalOpen() === null) {
      this.internalOpen.set(open);
    }
    this.openChange.emit(open);
  }
}
