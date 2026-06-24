import { ChangeDetectionStrategy, Component, HostListener, input, signal } from '@angular/core';
import { Card } from '../../../../../core/models/card.model';
import { RuntimeTranslatePipe } from '../../../../../core/localization/runtime-translate.pipe';
import { bestCardImage } from '../../../../../shared/utils/card-image';
import { CardSearchViewMode } from '../../card-search.models';

interface CardContextMenuState {
  readonly card: Card;
  readonly top: number;
  readonly left: number;
}

interface CardHoverPreviewState {
  readonly card: Card;
  readonly imageUrl: string | null;
  readonly top: number;
  readonly left: number;
}

@Component({
  selector: 'app-card-search-results',
  imports: [RuntimeTranslatePipe],
  templateUrl: './card-search-results.component.html',
  styleUrl: './card-search-results.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CardSearchResultsComponent {
  readonly results = input.required<readonly Card[]>();
  readonly loading = input(false);
  readonly error = input<string | null>(null);
  readonly searched = input(false);
  readonly viewMode = input<CardSearchViewMode>('list');
  readonly contextMenu = signal<CardContextMenuState | null>(null);
  readonly hoverPreview = signal<CardHoverPreviewState | null>(null);

  image(card: Card): string | null {
    return bestCardImage(card);
  }

  openContextMenu(event: MouseEvent, card: Card): void {
    event.preventDefault();
    event.stopPropagation();
    this.hideHoverPreview();

    const menuWidth = 12;
    const menuHeight = 3.5;
    const margin = 0.75;
    const rootFontSize = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const maxLeft = window.innerWidth - ((menuWidth + margin) * rootFontSize);
    const maxTop = window.innerHeight - ((menuHeight + margin) * rootFontSize);

    this.contextMenu.set({
      card,
      left: Math.max(margin * rootFontSize, Math.min(event.clientX, maxLeft)),
      top: Math.max(margin * rootFontSize, Math.min(event.clientY, maxTop)),
    });
  }

  showHoverPreview(event: MouseEvent, card: Card): void {
    if (this.viewMode() !== 'list') {
      return;
    }

    this.updateHoverPreview(event, card);
  }

  moveHoverPreview(event: MouseEvent, card: Card): void {
    if (!this.hoverPreview()) {
      return;
    }

    this.updateHoverPreview(event, card);
  }

  hideHoverPreview(): void {
    this.hoverPreview.set(null);
  }

  selectTodo(event: MouseEvent): void {
    event.stopPropagation();
    this.contextMenu.set(null);
  }

  @HostListener('document:click')
  closeContextMenu(): void {
    this.contextMenu.set(null);
  }

  @HostListener('document:keydown.escape')
  closeContextMenuFromKeyboard(): void {
    this.contextMenu.set(null);
  }

  private updateHoverPreview(event: MouseEvent, card: Card): void {
    const imageUrl = this.image(card);
    const previewWidth = 280;
    const previewHeight = 390;
    const margin = 12;
    const gap = 18;
    const preferRight = event.clientX + gap + previewWidth <= window.innerWidth - margin;
    const left = preferRight
      ? event.clientX + gap
      : event.clientX - previewWidth - gap;
    const top = event.clientY - (previewHeight / 2);

    this.hoverPreview.set({
      card,
      imageUrl,
      left: Math.max(margin, Math.min(left, window.innerWidth - previewWidth - margin)),
      top: Math.max(margin, Math.min(top, window.innerHeight - previewHeight - margin)),
    });
  }
}
