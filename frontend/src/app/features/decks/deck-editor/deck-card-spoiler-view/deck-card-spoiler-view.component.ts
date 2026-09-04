import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { RuntimeTranslatePipe } from '../../../../core/localization/runtime-translate.pipe';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  PLATFORM_ID,
  QueryList,
  ViewChildren,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { LucideAngularModule } from 'lucide-angular';
import { Card } from '../../../../core/models/card.model';
import {
  FormatSelectComponent,
  type FormatSelectOption,
} from '../../../../shared/components/format-select/format-select.component';
import { ManaSymbolsComponent } from '../../../../shared/mana/mana-symbols/mana-symbols.component';
import { GameChangerIconComponent } from '../../../../shared/ui/game-changer-icon/game-changer-icon.component';
import { DeckCardMenuComponent } from '../deck-card-menu/deck-card-menu.component';
import { runDeckFaceToggleAnimation } from '../deck-face-toggle-animation';
import { DECK_VIEW_STORE } from '../deck-view-store.token';
import { DeviceProfileService } from '../../../../shared/services/device-profile.service';

const MOBILE_IMAGE_BATCH_SIZE = 12;
const MOBILE_IMAGE_PRELOAD_MARGIN = '720px 0px';

@Component({
  selector: 'app-deck-card-spoiler-view',
  imports: [
    RuntimeTranslatePipe,
    LucideAngularModule,
    FormatSelectComponent,
    ManaSymbolsComponent,
    GameChangerIconComponent,
    DeckCardMenuComponent,
  ],
  templateUrl: './deck-card-spoiler-view.component.html',
  styleUrl: './deck-card-spoiler-view.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeckCardSpoilerViewComponent implements AfterViewInit {
  readonly interactive = input(true);
  readonly cardClickEnabled = input(true);
  readonly full = input(false);
  readonly headerFilterOptions = input<readonly FormatSelectOption[]>([]);
  readonly headerFilterValue = input('all');
  readonly headerFilterLabelKey = input<string | null>(null);
  readonly headerFilterName = input('spoiler-section-filter');
  readonly headerFilterValueChange = output<string>();
  readonly store = inject(DECK_VIEW_STORE);
  private readonly device = inject(DeviceProfileService);
  private readonly documentRef = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly prioritizedCardIds = signal<ReadonlySet<string>>(new Set());
  private readonly preloadedImageUrls = new Set<string>();
  private readonly pendingImagePreloads = new Map<string, HTMLImageElement>();
  private imageObserver: IntersectionObserver | null = null;

  @ViewChildren('spoilerCard') private readonly spoilerCards!: QueryList<ElementRef<HTMLElement>>;

  constructor() {
    this.store.hideCardPreview();

    effect(() => {
      const cards = this.store.cardGroups().flatMap((group) => group.cards);
      const cardsToLoad = this.usesProgressiveMobileLoading()
        ? cards.filter((entry) => this.prioritizedCardIds().has(entry.id))
        : cards;

      if (cardsToLoad.length > 0) {
        this.store.ensureCardImages(cardsToLoad);
      }
    });

    effect(() => {
      if (!this.usesProgressiveMobileLoading()) {
        return;
      }

      const prioritizedCardIds = this.prioritizedCardIds();
      for (const group of this.store.cardGroups()) {
        for (const entry of group.cards) {
          if (prioritizedCardIds.has(entry.id)) {
            this.preloadImage(this.store.displayCardImageUrl(entry.card));
          }
        }
      }
    });

    this.destroyRef.onDestroy(() => {
      this.imageObserver?.disconnect();
      this.pendingImagePreloads.clear();
    });
  }

  ngAfterViewInit(): void {
    if (!this.usesProgressiveMobileLoading()) {
      return;
    }

    this.syncMobileImageQueue();
    this.spoilerCards.changes
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.syncMobileImageQueue());
  }

  imageLoading(entryId: string): 'eager' | 'lazy' {
    return this.prioritizedCardIds().has(entryId) ? 'eager' : 'lazy';
  }

  stopFaceTogglePointer(event: Event): void {
    event.stopPropagation();
    event.stopImmediatePropagation?.();
  }

  stopFaceToggleContextMenu(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
  }

  isBattleVisibleFace(card: Card): boolean {
    return (this.store.displayCardTypeLine(card) ?? '').trim().toLowerCase().startsWith('battle');
  }

  isRowMenuOpen(entryId: string): boolean {
    return this.store.cardMenu()?.entryId === entryId;
  }

  spoilerCardName(card: Card): string {
    const name = this.store.displayCardListName(card);
    const frontName = name.split(/\s*\/\/\s*/, 1)[0].trim();

    return frontName || name;
  }

  toggleCardFace(event: MouseEvent, card: Card): void {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    this.store.toggleCardFace(event, card, { updatePreview: false });
    runDeckFaceToggleAnimation(event.currentTarget, 'card-image');
  }

  private usesProgressiveMobileLoading(): boolean {
    return this.isBrowser && !this.device.isDesktopLayout() && !this.device.hasHover();
  }

  private syncMobileImageQueue(): void {
    this.prioritizeCardBatch(0);
    this.observeSpoilerCards();
  }

  private observeSpoilerCards(): void {
    const Observer = this.documentRef.defaultView?.IntersectionObserver;
    if (!Observer) {
      return;
    }

    this.imageObserver?.disconnect();
    this.imageObserver = new Observer(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            this.prioritizeNextBatchNear(entry.target as HTMLElement);
          }
        }
      },
      { rootMargin: MOBILE_IMAGE_PRELOAD_MARGIN },
    );

    for (const card of this.spoilerCards) {
      this.imageObserver.observe(card.nativeElement);
    }
  }

  private prioritizeNextBatchNear(card: HTMLElement): void {
    const cards = this.spoilerCards.toArray();
    const cardIndex = cards.findIndex((item) => item.nativeElement === card);
    const queuedCount = this.prioritizedCardIds().size;

    if (cardIndex >= Math.max(0, queuedCount - 4)) {
      this.prioritizeCardBatch(queuedCount);
    }
  }

  private prioritizeCardBatch(startIndex: number): void {
    const nextBatch = this.spoilerCards
      .toArray()
      .slice(startIndex, startIndex + MOBILE_IMAGE_BATCH_SIZE)
      .map((item) => item.nativeElement.dataset['cardEntryId'])
      .filter((entryId): entryId is string => Boolean(entryId));

    if (nextBatch.length === 0) {
      return;
    }

    this.prioritizedCardIds.update((current) => new Set([...current, ...nextBatch]));
  }

  private preloadImage(url: string | null): void {
    if (!url || this.preloadedImageUrls.has(url)) {
      return;
    }

    this.preloadedImageUrls.add(url);
    const image = new Image();
    image.decoding = 'async';
    image.onload = image.onerror = () => this.pendingImagePreloads.delete(url);
    image.src = url;
    this.pendingImagePreloads.set(url, image);
  }
}
