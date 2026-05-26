import { ChangeDetectionStrategy, Component, ElementRef, HostListener, computed, inject, input, output, signal } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';

type ExtraActionsMenuAlign = 'left' | 'center' | 'right';
type ExtraActionsMenuVariant = 'compact' | 'gold';

interface ExtraActionsPanelStyle {
  readonly left: number;
  readonly top: number;
  readonly width: number;
}

const VIEWPORT_EDGE_GAP = 8;
const VIEWPORT_PANEL_GAP = 6;
const VIEWPORT_PANEL_WIDTH = 336;

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
  readonly viewportSafe = input(false);
  readonly openedChange = output<boolean>();
  readonly open = signal(false);
  readonly viewportPanelStyle = signal<ExtraActionsPanelStyle | null>(null);
  readonly viewportPanelMaxHeight = computed(() => {
    const top = this.viewportPanelStyle()?.top;

    return top === undefined ? null : `calc(100dvh - ${top}px - 0.5rem)`;
  });

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

  @HostListener('window:resize')
  repositionOnResize(): void {
    if (this.open() && this.viewportSafe()) {
      this.updateViewportPanelStyle();
    }
  }

  private setOpen(open: boolean): void {
    if (this.open() === open) {
      return;
    }

    this.open.set(open);
    this.viewportPanelStyle.set(open && this.viewportSafe() ? this.computeViewportPanelStyle() : null);
    this.openedChange.emit(open);
  }

  private updateViewportPanelStyle(): void {
    this.viewportPanelStyle.set(this.computeViewportPanelStyle());
  }

  private computeViewportPanelStyle(): ExtraActionsPanelStyle {
    const toggle = this.host.nativeElement.querySelector<HTMLElement>('.extra-actions-toggle');
    const anchor = toggle?.getBoundingClientRect() ?? this.host.nativeElement.getBoundingClientRect();
    const fixedRoot = this.fixedContainingBlock();
    const rootRect = fixedRoot?.getBoundingClientRect() ?? null;
    const rootLeft = rootRect?.left ?? 0;
    const rootTop = rootRect?.top ?? 0;
    const rootWidth = rootRect?.width ?? window.innerWidth;
    const viewportWidth = rootWidth || VIEWPORT_PANEL_WIDTH + VIEWPORT_EDGE_GAP * 2;
    const width = Math.max(1, Math.min(VIEWPORT_PANEL_WIDTH, viewportWidth - VIEWPORT_EDGE_GAP * 2));
    const alignedLeft = this.alignedPanelLeft(anchor, width) - rootLeft;

    return {
      left: clamp(alignedLeft, VIEWPORT_EDGE_GAP, viewportWidth - width - VIEWPORT_EDGE_GAP),
      top: Math.max(VIEWPORT_EDGE_GAP, anchor.bottom - rootTop + VIEWPORT_PANEL_GAP),
      width,
    };
  }

  private alignedPanelLeft(anchor: DOMRect, width: number): number {
    switch (this.align()) {
      case 'left':
        return anchor.left;
      case 'center':
        return anchor.left + (anchor.width - width) / 2;
      case 'right':
        return anchor.right - width;
    }
  }

  private fixedContainingBlock(): HTMLElement | null {
    let element = this.host.nativeElement.parentElement;
    while (element) {
      const style = window.getComputedStyle(element);
      const backdropFilter = style.getPropertyValue('backdrop-filter');
      const contain = style.getPropertyValue('contain');
      if (
        this.createsFixedContainingBlock(style.transform)
        || this.createsFixedContainingBlock(style.perspective)
        || this.createsFixedContainingBlock(style.filter)
        || (backdropFilter !== '' && backdropFilter !== 'none')
        || contain.includes('paint')
        || contain.includes('layout')
      ) {
        return element;
      }

      element = element.parentElement;
    }

    return null;
  }

  private createsFixedContainingBlock(value: string): boolean {
    return value !== '' && value !== 'none';
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
