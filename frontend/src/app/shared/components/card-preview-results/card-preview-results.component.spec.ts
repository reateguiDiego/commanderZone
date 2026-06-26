import { importProvidersFrom, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { LucideAngularModule, RotateCw } from 'lucide-angular';
import { CardFace } from '../../../core/models/card.model';
import { DeviceProfileService } from '../../services/device-profile.service';
import { CardPreviewResultsComponent } from './card-preview-results.component';

describe('CardPreviewResultsComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CardPreviewResultsComponent],
      providers: [
        importProvidersFrom(LucideAngularModule.pick({ RotateCw })),
        { provide: DeviceProfileService, useValue: { isMobile: signal(true), isDesktopLayout: signal(false), hasCoarsePointer: signal(true), hasHover: signal(false) } },
      ],
    }).compileComponents();
  });

  it('opens the shared context menu for interactive results and emits the selected action', async () => {
    const fixture = TestBed.createComponent(CardPreviewResultsComponent);
    const actionSpy = vi.fn();
    fixture.componentInstance.actionSelected.subscribe(actionSpy);

    fixture.componentRef.setInput('items', [
      {
        id: 'card-1',
        scryfallId: 'scryfall-1',
        name: 'Sol Ring',
        cropImage: 'https://cards.test/sol-ring.jpg',
      },
    ]);
    fixture.componentRef.setInput('contextMenuEnabled', true);
    fixture.detectChanges();

    const article = fixture.nativeElement.querySelector('.card-preview-result') as HTMLElement | null;
    expect(article).not.toBeNull();

    article?.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 120, clientY: 140 }));
    fixture.detectChanges();

    const menu = fixture.nativeElement.querySelector('app-common-card-menu') as HTMLElement | null;
    expect(menu).not.toBeNull();

    const component = fixture.componentInstance;
    component.selectMenuAction('details', {
      id: 'card-1',
      scryfallId: 'scryfall-1',
      name: 'Sol Ring',
      cropImage: 'https://cards.test/sol-ring.jpg',
    });

    expect(actionSpy).toHaveBeenCalledWith({
      action: 'details',
      item: {
        id: 'card-1',
        scryfallId: 'scryfall-1',
        name: 'Sol Ring',
        cropImage: 'https://cards.test/sol-ring.jpg',
      },
    });
  });

  it('shows the same debounced hover preview in list mode', async () => {
    vi.useFakeTimers();

    const fixture = TestBed.createComponent(CardPreviewResultsComponent);
    fixture.componentRef.setInput('items', [
      {
        id: 'card-1',
        scryfallId: 'scryfall-1',
        name: 'Sol Ring',
        cropImage: 'https://cards.test/sol-ring.jpg',
        imageUris: { normal: 'https://cards.test/sol-ring-normal.jpg' },
      },
    ]);
    fixture.componentRef.setInput('viewMode', 'list');
    fixture.detectChanges();

    const article = fixture.nativeElement.querySelector('.card-preview-result') as HTMLElement;
    article.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, clientX: 120, clientY: 80 }));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.card-hover-preview')).toBeNull();

    vi.advanceTimersByTime(180);
    fixture.detectChanges();

    const preview = fixture.nativeElement.querySelector('.card-hover-preview img') as HTMLImageElement | null;
    expect(preview?.getAttribute('src')).toBe('https://cards.test/sol-ring-normal.jpg');

    article.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.card-hover-preview')).toBeNull();
    vi.useRealTimers();
  });

  it('keeps double-face toggle taps isolated from the shared context menu container', async () => {
    const fixture = TestBed.createComponent(CardPreviewResultsComponent);
    fixture.componentRef.setInput('items', [
      {
        id: 'card-1',
        scryfallId: 'scryfall-1',
        name: 'Kolvori, God of Kinship // The Ringhart Crest',
        cropImage: 'https://cards.test/kolvori-crop.jpg',
        imageUris: {},
        cardFaces: [
          cardFace('Front', 'https://cards.test/kolvori-front.jpg'),
          cardFace('Back', 'https://cards.test/kolvori-back.jpg'),
        ],
      },
    ]);
    fixture.componentRef.setInput('contextMenuEnabled', true);
    fixture.componentRef.setInput('viewMode', 'spoiler');
    fixture.detectChanges();

    const toggle = fixture.nativeElement.querySelector('app-card-face-toggle-button button') as HTMLButtonElement;
    const image = () => fixture.nativeElement.querySelector('.card-preview-result img') as HTMLImageElement | null;

    expect(image()?.getAttribute('src')).toBe('https://cards.test/kolvori-front.jpg');

    toggle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }));
    toggle.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch' }));
    toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fixture.detectChanges();

    expect(image()?.getAttribute('src')).toBe('https://cards.test/kolvori-back.jpg');
    expect(fixture.nativeElement.querySelector('app-common-card-menu')).toBeNull();

    toggle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }));
    toggle.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch' }));
    toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fixture.detectChanges();

    expect(image()?.getAttribute('src')).toBe('https://cards.test/kolvori-front.jpg');
    expect(fixture.nativeElement.querySelector('app-common-card-menu')).toBeNull();
  });

  it('does not treat overlay toggle mouse clicks as article clicks', async () => {
    const fixture = TestBed.createComponent(CardPreviewResultsComponent);
    fixture.componentRef.setInput('items', [
      {
        id: 'card-1',
        scryfallId: 'scryfall-1',
        name: 'Kolvori, God of Kinship // The Ringhart Crest',
        cropImage: 'https://cards.test/kolvori-crop.jpg',
        imageUris: {},
        cardFaces: [
          cardFace('Front', 'https://cards.test/kolvori-front.jpg'),
          cardFace('Back', 'https://cards.test/kolvori-back.jpg'),
        ],
      },
    ]);
    fixture.componentRef.setInput('contextMenuEnabled', true);
    fixture.componentRef.setInput('viewMode', 'spoiler');
    fixture.detectChanges();

    const toggle = fixture.nativeElement.querySelector('app-card-face-toggle-button button') as HTMLButtonElement;
    const image = () => fixture.nativeElement.querySelector('.card-preview-result img') as HTMLImageElement | null;

    toggle.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    fixture.detectChanges();

    expect(image()?.getAttribute('src')).toBe('https://cards.test/kolvori-back.jpg');
    expect(fixture.nativeElement.querySelector('app-common-card-menu')).toBeNull();
  });
});

function cardFace(name: string, imageUrl: string): CardFace {
  return {
    name,
    manaCost: null,
    typeLine: null,
    oracleText: null,
    power: null,
    toughness: null,
    loyalty: null,
    colors: [],
    imageUris: { normal: imageUrl },
  };
}
