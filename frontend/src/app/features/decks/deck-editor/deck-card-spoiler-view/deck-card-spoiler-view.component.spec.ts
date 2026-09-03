import { importProvidersFrom, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  ChevronDown,
  ChevronRight,
  LucideAngularModule,
  RotateCw,
  TriangleAlert,
} from 'lucide-angular';
import { Card } from '../../../../core/models/card.model';
import { DeckCard } from '../../../../core/models/deck.model';
import { CardMenuState } from '../../models/deck-editor.models';
import { DeviceProfileService } from '../../../../shared/services/device-profile.service';
import { DECK_VIEW_STORE } from '../deck-view-store.token';
import { DeckCardSpoilerViewComponent } from './deck-card-spoiler-view.component';

describe('DeckCardSpoilerViewComponent', () => {
  it('loads and renders grouped card images', async () => {
    const store = storeStub();
    await TestBed.configureTestingModule({
      imports: [DeckCardSpoilerViewComponent],
      providers: [
        importProvidersFrom(
          LucideAngularModule.pick({ ChevronDown, ChevronRight, RotateCw, TriangleAlert }),
        ),
        { provide: DECK_VIEW_STORE, useValue: store },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(DeckCardSpoilerViewComponent);
    fixture.detectChanges();

    expect(store.ensureCardImages).toHaveBeenCalledOnce();
    expect(fixture.nativeElement.querySelector('img')?.getAttribute('src')).toBe(
      'https://img.test/card.jpg',
    );
  });

  it('queues mobile spoiler images in nearby batches', async () => {
    const store = storeStub({ groupCards: 25 });
    const originalIntersectionObserver = window.IntersectionObserver;
    MobileImageIntersectionObserver.latest = null;
    Object.defineProperty(window, 'IntersectionObserver', {
      configurable: true,
      value: MobileImageIntersectionObserver,
    });

    try {
      await TestBed.configureTestingModule({
        imports: [DeckCardSpoilerViewComponent],
        providers: [
          importProvidersFrom(
            LucideAngularModule.pick({ ChevronDown, ChevronRight, RotateCw, TriangleAlert }),
          ),
          { provide: DECK_VIEW_STORE, useValue: store },
          {
            provide: DeviceProfileService,
            useValue: {
              isDesktopLayout: () => false,
              hasHover: () => false,
            },
          },
        ],
      }).compileComponents();

      const fixture = TestBed.createComponent(DeckCardSpoilerViewComponent);
      fixture.detectChanges();

      const cards = store.cardGroups()[0].cards;
      expect(store.ensureCardImages).toHaveBeenLastCalledWith(cards.slice(0, 12));

      const renderedCards = (fixture.nativeElement as HTMLElement).querySelectorAll(
        '.spoiler-card',
      ) as NodeListOf<HTMLElement>;
      MobileImageIntersectionObserver.triggerLatest(renderedCards[8]);
      fixture.detectChanges();

      expect(store.ensureCardImages).toHaveBeenLastCalledWith(cards.slice(0, 24));
    } finally {
      Object.defineProperty(window, 'IntersectionObserver', {
        configurable: true,
        value: originalIntersectionObserver,
      });
    }
  });

  it('renders the game changer icon next to a game changer spoiler card name', async () => {
    const store = storeStub({ isGameChanger: true });
    await TestBed.configureTestingModule({
      imports: [DeckCardSpoilerViewComponent],
      providers: [
        importProvidersFrom(
          LucideAngularModule.pick({ ChevronDown, ChevronRight, RotateCw, TriangleAlert }),
        ),
        { provide: DECK_VIEW_STORE, useValue: store },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(DeckCardSpoilerViewComponent);
    fixture.detectChanges();

    const icon = fixture.nativeElement.querySelector(
      '.spoiler-card-name app-game-changer-icon img.game-changer-icon',
    ) as HTMLImageElement | null;

    expect(icon).not.toBeNull();
    expect(icon?.getAttribute('src')).toBe('assets/icons/card-types/game-changers.png');
    expect(icon?.getAttribute('title')).toBe('Game Changer');
    expect(icon?.getAttribute('alt')).toBe('Game Changer');
  });

  it('renders the spoiler toggle icon before the category title and count', async () => {
    const store = storeStub();
    await TestBed.configureTestingModule({
      imports: [DeckCardSpoilerViewComponent],
      providers: [
        importProvidersFrom(
          LucideAngularModule.pick({ ChevronDown, ChevronRight, RotateCw, TriangleAlert }),
        ),
        { provide: DECK_VIEW_STORE, useValue: store },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(DeckCardSpoilerViewComponent);
    fixture.detectChanges();

    const toggle = fixture.nativeElement.querySelector(
      '.spoiler-section-toggle',
    ) as HTMLButtonElement | null;
    const firstChild = toggle?.firstElementChild;
    const secondChild = firstChild?.nextElementSibling;

    expect(firstChild?.tagName.toLowerCase()).toBe('lucide-icon');
    expect(secondChild?.classList.contains('spoiler-section-title')).toBe(true);
    expect(secondChild?.textContent?.replace(/\s+/g, ' ').trim()).toContain('(1)');
  });

  it('does not render commander color identity when no commander identity exists', async () => {
    const store = storeStub({ groupId: 'commander', groupTitle: 'Comandante', groupCards: 0 });
    await TestBed.configureTestingModule({
      imports: [DeckCardSpoilerViewComponent],
      providers: [
        importProvidersFrom(
          LucideAngularModule.pick({ ChevronDown, ChevronRight, RotateCw, TriangleAlert }),
        ),
        { provide: DECK_VIEW_STORE, useValue: store },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(DeckCardSpoilerViewComponent);
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('.commander-colors')).toBeNull();
    expect(element.textContent).not.toContain('shared.text.colorless');
  });

  it('renders generic mana for a colorless commander identity', async () => {
    const store = storeStub({
      groupId: 'commander',
      groupTitle: 'Comandante',
      deckColorIdentitySymbols: ['1'],
    });
    await TestBed.configureTestingModule({
      imports: [DeckCardSpoilerViewComponent],
      providers: [
        importProvidersFrom(
          LucideAngularModule.pick({ ChevronDown, ChevronRight, RotateCw, TriangleAlert }),
        ),
        { provide: DECK_VIEW_STORE, useValue: store },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(DeckCardSpoilerViewComponent);
    fixture.detectChanges();

    expect(
      (fixture.nativeElement as HTMLElement).querySelector('.commander-colors .ms-1'),
    ).not.toBeNull();
  });

  it('flips card faces without opening the card menu preview flow', async () => {
    const store = storeStub({ hasAlternateFace: true });
    await TestBed.configureTestingModule({
      imports: [DeckCardSpoilerViewComponent],
      providers: [
        importProvidersFrom(
          LucideAngularModule.pick({ ChevronDown, ChevronRight, RotateCw, TriangleAlert }),
        ),
        { provide: DECK_VIEW_STORE, useValue: store },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(DeckCardSpoilerViewComponent);
    fixture.detectChanges();

    const button = fixture.nativeElement.querySelector('.face-toggle-button') as HTMLButtonElement;
    const cardEntry = store.cardGroups()[0]?.cards[0];

    button.click();

    expect(cardEntry).toBeDefined();
    expect(store.toggleCardFace).toHaveBeenCalledWith(expect.any(MouseEvent), cardEntry?.card, {
      updatePreview: false,
    });
    expect(store.toggleCardMenu).not.toHaveBeenCalled();
  });

  it('keeps spoiler cards highlighted while their contextual menu is open', async () => {
    const store = storeStub();
    await TestBed.configureTestingModule({
      imports: [DeckCardSpoilerViewComponent],
      providers: [
        importProvidersFrom(
          LucideAngularModule.pick({ ChevronDown, ChevronRight, RotateCw, TriangleAlert }),
        ),
        { provide: DECK_VIEW_STORE, useValue: store },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(DeckCardSpoilerViewComponent);
    fixture.componentRef.setInput('interactive', false);
    store.cardMenu.set({
      entryId: 'deck-card-1',
      top: 0,
      left: 0,
      amount: 1,
      showImagePreview: false,
    });
    fixture.detectChanges();

    const article = fixture.nativeElement.querySelector('.spoiler-card') as HTMLElement | null;
    expect(article?.classList.contains('spoiler-card--menu-open')).toBe(true);

    store.cardMenu.set(null);
    fixture.detectChanges();

    expect(article?.classList.contains('spoiler-card--menu-open')).toBe(false);
  });

  it('still flips after the button pointerdown isolation runs first', async () => {
    const store = storeStub({ hasAlternateFace: true });
    await TestBed.configureTestingModule({
      imports: [DeckCardSpoilerViewComponent],
      providers: [
        importProvidersFrom(
          LucideAngularModule.pick({ ChevronDown, ChevronRight, RotateCw, TriangleAlert }),
        ),
        { provide: DECK_VIEW_STORE, useValue: store },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(DeckCardSpoilerViewComponent);
    fixture.detectChanges();

    const button = fixture.nativeElement.querySelector('.face-toggle-button') as HTMLButtonElement;
    const cardEntry = store.cardGroups()[0]?.cards[0];

    button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }));
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(cardEntry).toBeDefined();
    expect(store.toggleCardFace).toHaveBeenCalledWith(expect.any(MouseEvent), cardEntry?.card, {
      updatePreview: false,
    });
  });

  it('suppresses contextmenu interactions from the spoiler face toggle', async () => {
    const store = storeStub({ hasAlternateFace: true });
    await TestBed.configureTestingModule({
      imports: [DeckCardSpoilerViewComponent],
      providers: [
        importProvidersFrom(
          LucideAngularModule.pick({ ChevronDown, ChevronRight, RotateCw, TriangleAlert }),
        ),
        { provide: DECK_VIEW_STORE, useValue: store },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(DeckCardSpoilerViewComponent);
    const parentContextMenuSpy = vi.fn();
    fixture.nativeElement.addEventListener('contextmenu', parentContextMenuSpy);
    fixture.detectChanges();

    const button = fixture.nativeElement.querySelector('.face-toggle-button') as HTMLButtonElement;
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    button.dispatchEvent(event);

    expect(parentContextMenuSpy).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
    expect(store.toggleCardMenu).not.toHaveBeenCalled();
  });

  it('does not reset double-faced cards to the front face after hover', async () => {
    const store = storeStub({ hasAlternateFace: true, resetCardFace: true });
    await TestBed.configureTestingModule({
      imports: [DeckCardSpoilerViewComponent],
      providers: [
        importProvidersFrom(
          LucideAngularModule.pick({ ChevronDown, ChevronRight, RotateCw, TriangleAlert }),
        ),
        { provide: DECK_VIEW_STORE, useValue: store },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(DeckCardSpoilerViewComponent);
    fixture.detectChanges();

    const article = fixture.nativeElement.querySelector('.spoiler-card') as HTMLElement;
    const cardEntry = store.cardGroups()[0]?.cards[0];

    article.dispatchEvent(new Event('pointerleave'));

    expect(cardEntry).toBeDefined();
    expect(store.resetCardFace).not.toHaveBeenCalled();
  });

  it('collapses and expands spoiler sections from the section title', async () => {
    const store = storeStub();
    await TestBed.configureTestingModule({
      imports: [DeckCardSpoilerViewComponent],
      providers: [
        importProvidersFrom(
          LucideAngularModule.pick({ ChevronDown, ChevronRight, RotateCw, TriangleAlert }),
        ),
        { provide: DECK_VIEW_STORE, useValue: store },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(DeckCardSpoilerViewComponent);
    fixture.detectChanges();

    const toggle = fixture.nativeElement.querySelector(
      '.spoiler-section-toggle',
    ) as HTMLButtonElement;

    expect(toggle.getAttribute('aria-expanded')).toBe('true');

    toggle.click();
    fixture.detectChanges();

    expect(store.toggleGroup).toHaveBeenCalledWith('creature');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(
      fixture.nativeElement.querySelector('.spoiler-section-body')?.classList.contains('collapsed'),
    ).toBe(true);
  });

  it('renders battle cards with the rotated spoiler treatment used in cards', async () => {
    const store = storeStub({ cardTypeLine: 'Battle - Siege' });
    await TestBed.configureTestingModule({
      imports: [DeckCardSpoilerViewComponent],
      providers: [
        importProvidersFrom(
          LucideAngularModule.pick({ ChevronDown, ChevronRight, RotateCw, TriangleAlert }),
        ),
        { provide: DECK_VIEW_STORE, useValue: store },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(DeckCardSpoilerViewComponent);
    fixture.detectChanges();

    const frame = fixture.nativeElement.querySelector('.spoiler-image-frame') as HTMLElement | null;
    const image = fixture.nativeElement.querySelector(
      '.spoiler-image-frame img',
    ) as HTMLImageElement | null;

    expect(frame?.classList.contains('spoiler-image-frame--battle')).toBe(true);
    expect(image?.classList.contains('card-image--battle')).toBe(true);
  });

  it('spans spoiler sections across the full row when they contain more than three cards', async () => {
    const store = storeStub({ groupCards: 4 });
    await TestBed.configureTestingModule({
      imports: [DeckCardSpoilerViewComponent],
      providers: [
        importProvidersFrom(
          LucideAngularModule.pick({ ChevronDown, ChevronRight, RotateCw, TriangleAlert }),
        ),
        { provide: DECK_VIEW_STORE, useValue: store },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(DeckCardSpoilerViewComponent);
    fixture.detectChanges();

    const section = fixture.nativeElement.querySelector('.spoiler-section') as HTMLElement | null;

    expect(section?.classList.contains('spoiler-section--full')).toBe(true);
  });

  it('shows only the front name for split double-faced card names', async () => {
    const store = storeStub({ cardName: 'Mila, Crafty Companion // Lukka, Wayward Bonder' });
    await TestBed.configureTestingModule({
      imports: [DeckCardSpoilerViewComponent],
      providers: [
        importProvidersFrom(
          LucideAngularModule.pick({ ChevronDown, ChevronRight, RotateCw, TriangleAlert }),
        ),
        { provide: DECK_VIEW_STORE, useValue: store },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(DeckCardSpoilerViewComponent);
    fixture.detectChanges();

    const name = fixture.nativeElement.querySelector('.spoiler-card-name') as HTMLElement | null;

    expect(name?.textContent?.trim()).toBe('Mila, Crafty Companion');
  });

  it('can force full spoiler mode for compact embedded views', async () => {
    const store = storeStub({ groupCards: 1 });
    await TestBed.configureTestingModule({
      imports: [DeckCardSpoilerViewComponent],
      providers: [
        importProvidersFrom(
          LucideAngularModule.pick({ ChevronDown, ChevronRight, RotateCw, TriangleAlert }),
        ),
        { provide: DECK_VIEW_STORE, useValue: store },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(DeckCardSpoilerViewComponent);
    fixture.componentRef.setInput('full', true);
    fixture.detectChanges();

    const root = fixture.nativeElement.querySelector('.spoiler-sections') as HTMLElement | null;
    const section = fixture.nativeElement.querySelector('.spoiler-section') as HTMLElement | null;

    expect(root?.classList.contains('spoiler-sections--full')).toBe(true);
    expect(section?.classList.contains('spoiler-section--full')).toBe(true);
  });

  it('stops rotating the visible card when the flipped face is no longer a battle', async () => {
    const store = storeStub({ cardTypeLine: 'Battle - Siege' });
    await TestBed.configureTestingModule({
      imports: [DeckCardSpoilerViewComponent],
      providers: [
        importProvidersFrom(
          LucideAngularModule.pick({ ChevronDown, ChevronRight, RotateCw, TriangleAlert }),
        ),
        { provide: DECK_VIEW_STORE, useValue: store },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(DeckCardSpoilerViewComponent);
    fixture.detectChanges();

    store.visibleTypeLine.set('Land');
    fixture.detectChanges();

    const frame = fixture.nativeElement.querySelector('.spoiler-image-frame') as HTMLElement | null;
    const image = fixture.nativeElement.querySelector(
      '.spoiler-image-frame img',
    ) as HTMLImageElement | null;

    expect(frame?.classList.contains('spoiler-image-frame--battle')).toBe(false);
    expect(image?.classList.contains('card-image--battle')).toBe(false);
  });
});

function storeStub(
  options: {
    hasAlternateFace?: boolean;
    resetCardFace?: boolean;
    cardTypeLine?: string;
    groupCards?: number;
    groupId?: string;
    groupTitle?: string;
    cardName?: string;
    isGameChanger?: boolean;
    deckColorIdentitySymbols?: readonly string[];
  } = {},
) {
  const entries = Array.from({ length: options.groupCards ?? 1 }, (_, index) => ({
    id: `deck-card-${index + 1}`,
    quantity: 1,
    section: 'main',
    card: card(options.cardTypeLine, index + 1, options.cardName, options.isGameChanger),
  })) satisfies DeckCard[];
  const collapsedGroups = signal<Set<string>>(new Set());
  const visibleTypeLine = signal(options.cardTypeLine ?? entries[0]?.card.typeLine ?? 'Creature');

  return {
    visibleTypeLine,
    cardGroups: signal([
      {
        id: options.groupId ?? 'creature',
        title: options.groupTitle ?? 'Criaturas',
        quantity: entries.length,
        cards: entries,
      },
    ]),
    cardMenu: signal<CardMenuState | null>(null),
    toggleGroup: vi.fn((groupId: string) => {
      const next = new Set(collapsedGroups());
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      collapsedGroups.set(next);
    }),
    isGroupCollapsed: vi.fn((groupId: string) => collapsedGroups().has(groupId)),
    ensureCardImages: vi.fn(),
    deckColorIdentitySymbols: () => options.deckColorIdentitySymbols ?? [],
    showCardPreview: vi.fn(),
    moveCardPreview: vi.fn(),
    hideCardPreview: vi.fn(),
    toggleCardMenu: vi.fn(),
    imageUrl: () => 'https://img.test/card.jpg',
    displayCardImageUrl: () => 'https://img.test/card.jpg',
    displayCardName: (value: Card) => value.name,
    displayCardListName: (value: Card) => value.name,
    displayCardTypeLine: vi.fn((value: Card) => visibleTypeLine() ?? value.typeLine),
    displayCardManaCost: (value: Card) => value.manaCost,
    hasAlternateFace: () => options.hasAlternateFace ?? false,
    toggleCardFace: vi.fn(),
    resetCardFace: vi.fn().mockReturnValue(options.resetCardFace ?? false),
    isCardInvalidForDeck: () => false,
    invalidCardMessage: () => '',
    shouldShowManaCost: () => false,
    setCardMenuAmount: vi.fn(),
    addCardCopy: vi.fn(),
    removeCardCopy: vi.fn(),
    moveCardToSection: vi.fn(),
  };
}

function card(typeLine = 'Creature', index = 1, cardName?: string, isGameChanger = false): Card {
  return {
    id: `card-${index}`,
    scryfallId: `scryfall-${index}`,
    name: cardName ?? (index === 1 ? 'Esper Sentinel' : `Esper Sentinel ${index}`),
    manaCost: '{W}',
    typeLine,
    oracleText: null,
    colors: ['W'],
    colorIdentity: ['W'],
    legalities: {},
    imageUris: {},
    layout: 'normal',
    commanderLegal: true,
    set: null,
    collectorNumber: null,
    isGameChanger,
  };
}

class MobileImageIntersectionObserver {
  static latest: MobileImageIntersectionObserver | null = null;

  private readonly observed = new Set<Element>();

  constructor(private readonly callback: IntersectionObserverCallback) {
    MobileImageIntersectionObserver.latest = this;
  }

  observe(element: Element): void {
    this.observed.add(element);
  }

  unobserve(element: Element): void {
    this.observed.delete(element);
  }

  disconnect(): void {
    this.observed.clear();
  }

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }

  trigger(target: Element): void {
    this.callback(
      [
        {
          target,
          isIntersecting: true,
        } as IntersectionObserverEntry,
      ],
      this as unknown as IntersectionObserver,
    );
  }

  static triggerLatest(target: Element): void {
    this.latest?.trigger(target);
  }

  readonly root = null;
  readonly rootMargin = '720px 0px';
  readonly thresholds = [0];
}
