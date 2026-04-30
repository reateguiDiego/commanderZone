import { ChangeDetectionStrategy, Component, ElementRef, HostListener, inject, output, signal } from '@angular/core';

@Component({
  selector: 'app-table-assistant-table-menu',
  templateUrl: './table-assistant-table-menu.component.html',
  styleUrl: './table-assistant-table-menu.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TableAssistantTableMenuComponent {
  private readonly elementRef = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly dashboardSelected = output<void>();
  readonly newTableSelected = output<void>();
  readonly menuOpen = signal(false);

  @HostListener('document:click', ['$event.target'])
  closeOnOutsideClick(target: EventTarget | null): void {
    if (!this.menuOpen() || !(target instanceof Node)) {
      return;
    }

    if (!this.elementRef.nativeElement.contains(target)) {
      this.closeMenu();
    }
  }

  toggleMenu(): void {
    this.menuOpen.update((open) => !open);
  }

  selectDashboard(): void {
    this.menuOpen.set(false);
    this.dashboardSelected.emit();
  }

  selectNewTable(): void {
    this.menuOpen.set(false);
    this.newTableSelected.emit();
  }

  closeMenu(): void {
    this.menuOpen.set(false);
  }
}
