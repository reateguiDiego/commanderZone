import { ChangeDetectionStrategy, Component, ElementRef, HostListener, inject, output, signal } from '@angular/core';

@Component({
  selector: 'app-table-assistant-table-menu',
  templateUrl: './table-assistant-table-menu.component.html',
  styleUrl: './table-assistant-table-menu.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TableAssistantTableMenuComponent {
  private readonly centralOpenAreaWidthRatio = 0.36;
  private readonly centralOpenAreaHeightRatio = 0.44;
  private readonly elementRef = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly dashboardSelected = output<void>();
  readonly newTableSelected = output<void>();
  readonly rollSelected = output<void>();
  readonly fullscreenSelected = output<void>();
  readonly menuOpen = signal(false);

  @HostListener('document:click', ['$event'])
  handleDocumentClick(event: MouseEvent): void {
    const target = event.target;
    if (!(target instanceof Node)) {
      return;
    }

    if (!this.elementRef.nativeElement.contains(target)) {
      if (this.menuOpen()) {
        this.closeMenu();
        return;
      }

      if (this.isCentralOpenAreaClick(event)) {
        this.menuOpen.set(true);
      }
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

  selectRoll(): void {
    this.menuOpen.set(false);
    this.rollSelected.emit();
  }

  selectFullscreen(): void {
    this.menuOpen.set(false);
    this.fullscreenSelected.emit();
  }

  closeMenu(): void {
    this.menuOpen.set(false);
  }

  private isCentralOpenAreaClick(event: MouseEvent): boolean {
    const target = event.target;
    if (!(target instanceof Element) || this.shouldIgnoreTableClick(target)) {
      return false;
    }

    const tableSurface = target.closest('.players-grid');
    if (!(tableSurface instanceof HTMLElement)) {
      return false;
    }

    const bounds = tableSurface.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) {
      return false;
    }

    const openAreaWidth = bounds.width * this.centralOpenAreaWidthRatio;
    const openAreaHeight = bounds.height * this.centralOpenAreaHeightRatio;
    const openAreaLeft = bounds.left + (bounds.width - openAreaWidth) / 2;
    const openAreaTop = bounds.top + (bounds.height - openAreaHeight) / 2;

    return (
      event.clientX >= openAreaLeft &&
      event.clientX <= openAreaLeft + openAreaWidth &&
      event.clientY >= openAreaTop &&
      event.clientY <= openAreaTop + openAreaHeight
    );
  }

  private shouldIgnoreTableClick(target: Element): boolean {
    return Boolean(
      target.closest('app-table-assistant-replay-modal, app-roll-modal') ||
        target.closest('app-table-assistant-turn-controls, .player-turn-controls') ||
        target.closest('button, a, input, select, textarea, [role="button"]'),
    );
  }
}
