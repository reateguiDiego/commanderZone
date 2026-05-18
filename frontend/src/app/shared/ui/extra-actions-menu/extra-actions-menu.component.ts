import { ChangeDetectionStrategy, Component, ElementRef, HostListener, inject, input, output, signal } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';

type ExtraActionsMenuAlign = 'left' | 'center' | 'right';
type ExtraActionsMenuVariant = 'compact' | 'gold';

@Component({
  selector: 'app-extra-actions-menu',
  imports: [LucideAngularModule],
  templateUrl: './extra-actions-menu.component.html',
  styleUrl: './extra-actions-menu.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExtraActionsMenuComponent {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly label = input('Extras');
  readonly ariaLabel = input('Open extra actions');
  readonly icon = input('plus');
  readonly menuLabel = input('Extra actions');
  readonly align = input<ExtraActionsMenuAlign>('right');
  readonly variant = input<ExtraActionsMenuVariant>('gold');
  readonly showText = input(false);
  readonly openedChange = output<boolean>();
  readonly open = signal(false);

  toggle(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.setOpen(!this.open());
  }

  close(): void {
    this.setOpen(false);
  }

  stopMenuClick(event: MouseEvent): void {
    event.stopPropagation();
  }

  stopMenuContextMenu(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
  }

  @HostListener('document:mousedown', ['$event'])
  closeFromOutsidePointer(event: MouseEvent): void {
    const target = event.target instanceof Node ? event.target : null;
    if (target && this.host.nativeElement.contains(target)) {
      return;
    }

    this.close();
  }

  private setOpen(open: boolean): void {
    if (this.open() === open) {
      return;
    }

    this.open.set(open);
    this.openedChange.emit(open);
  }
}
