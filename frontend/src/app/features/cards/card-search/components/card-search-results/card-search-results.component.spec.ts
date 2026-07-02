import { importProvidersFrom, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { LucideAngularModule, RotateCw } from 'lucide-angular';
import { Card, CardFace } from '../../../../../core/models/card.model';
import { DeviceProfileService } from '../../../../../shared/services/device-profile.service';
import { CardSearchResultsComponent } from './card-search-results.component';

describe('CardSearchResultsComponent', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  beforeEach(async () => {
    vi.stubGlobal('innerWidth', 1024);
    vi.stubGlobal('innerHeight', 768);

    await TestBed.configureTestingModule({
      imports: [CardSearchResultsComponent],
      providers: [
        importProvidersFrom(LucideAngularModule.pick({ RotateCw })),
        { provide: DeviceProfileService, useValue: { isMobile: signal(true), isDesktopLayout: signal(false), hasCoarsePointer: signal(true), hasHover: signal(false) } },
      ],
    }).compileComponents();
  });

  it('renders list results as compact non-navigating rows', () => {
    const fixture = TestBed.createComponent(CardSearchResultsComponent);
    fixture.componentRef.setInput('results', [cardFixture()]);
    fixture.componentRef.setInput('searched', true);
    fixture.componentRef.setInput('viewMode', 'list');
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Sol Ring');
    expect(fixture.nativeElement.textContent).not.toContain('Commander Masters');
    expect(fixture.nativeElement.textContent).not.toContain('rare');
    expect(fixture.nativeElement.querySelector('a.mtg-card-result')).toBeNull();
    expect(fixture.nativeElement.querySelector('button.mtg-card-result')).toBeNull();
    expect(fixture.nativeElement.querySelector('.mtg-card-result img')?.getAttribute('src')).toBe('/sol-ring.jpg');
  });

  it('opens an action context menu instead of navigating', () => {
    const fixture = TestBed.createComponent(CardSearchResultsComponent);
    fixture.componentRef.setInput('results', [cardFixture({ hasRulings: true })]);
    fixture.componentRef.setInput('searched', true);
    fixture.detectChanges();

    const result = fixture.nativeElement.querySelector('.mtg-card-result') as HTMLElement;
    vi.spyOn(result, 'getBoundingClientRect').mockReturnValue({
      x: 100,
      y: 200,
      left: 100,
      top: 200,
      right: 160,
      bottom: 280,
      width: 60,
      height: 80,
      toJSON: () => ({}),
    });

    result.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 12, clientY: 18 }));
    fixture.detectChanges();

    const menu = fixture.nativeElement.querySelector('.common-card-menu') as HTMLElement;
    expect(menu.textContent).toContain('Show details');
    expect(menu.textContent).toContain('Add to deck');
    expect(menu.textContent).toContain('Show rulings');
    expect(menu.textContent).toContain('View all printings');
    expect(menu.style.left).toBe('34px');
    expect(menu.style.top).toBe('142px');
  });

  it('emits the selected context menu action', () => {
    const fixture = TestBed.createComponent(CardSearchResultsComponent);
    const actionSpy = vi.fn();
    fixture.componentInstance.actionSelected.subscribe(actionSpy);
    fixture.componentRef.setInput('results', [cardFixture()]);
    fixture.componentRef.setInput('searched', true);
    fixture.detectChanges();

    const result = fixture.nativeElement.querySelector('.mtg-card-result') as HTMLElement;
    result.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 12, clientY: 18 }));
    fixture.detectChanges();

    const details = fixture.nativeElement.querySelector('.common-card-menu button') as HTMLButtonElement;
    details.click();
    fixture.detectChanges();

    expect(actionSpy).toHaveBeenCalledWith({
      action: 'details',
      card: expect.objectContaining({ name: 'Sol Ring' }),
    });
    expect(fixture.nativeElement.querySelector('.common-card-menu')).toBeNull();
  });

  it('toggles the context menu when clicking the same card again', () => {
    const fixture = TestBed.createComponent(CardSearchResultsComponent);
    fixture.componentRef.setInput('results', [cardFixture()]);
    fixture.componentRef.setInput('searched', true);
    fixture.detectChanges();

    const result = fixture.nativeElement.querySelector('.mtg-card-result') as HTMLElement;
    result.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 12, clientY: 18 }));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.common-card-menu')).not.toBeNull();

    result.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 12, clientY: 18 }));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.common-card-menu')).toBeNull();
  });

  it('closes the context menu when clicking outside or scrolling', () => {
    const fixture = TestBed.createComponent(CardSearchResultsComponent);
    fixture.componentRef.setInput('results', [cardFixture()]);
    fixture.componentRef.setInput('searched', true);
    fixture.detectChanges();

    const result = fixture.nativeElement.querySelector('.mtg-card-result') as HTMLElement;
    result.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 12, clientY: 18 }));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.common-card-menu')).not.toBeNull();

    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.common-card-menu')).toBeNull();

    result.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 12, clientY: 18 }));
    window.dispatchEvent(new Event('scroll'));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.common-card-menu')).toBeNull();
  });

  it('hides the hover preview as soon as the user clicks anywhere', () => {
    vi.useFakeTimers();
    const fixture = TestBed.createComponent(CardSearchResultsComponent);
    fixture.componentRef.setInput('results', [cardFixture()]);
    fixture.componentRef.setInput('searched', true);
    fixture.componentRef.setInput('viewMode', 'list');
    fixture.detectChanges();

    const result = fixture.nativeElement.querySelector('.mtg-card-result') as HTMLElement;
    result.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, clientX: 120, clientY: 80 }));
    vi.advanceTimersByTime(180);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.card-hover-preview')).not.toBeNull();

    document.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.card-hover-preview')).toBeNull();
    vi.useRealTimers();
  });

  it('debounces the hover preview when the pointer only crosses a result', () => {
    vi.useFakeTimers();
    const fixture = TestBed.createComponent(CardSearchResultsComponent);
    fixture.componentRef.setInput('results', [cardFixture()]);
    fixture.componentRef.setInput('searched', true);
    fixture.componentRef.setInput('viewMode', 'list');
    fixture.detectChanges();

    const result = fixture.nativeElement.querySelector('.mtg-card-result') as HTMLElement;
    result.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, clientX: 120, clientY: 80 }));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.card-hover-preview')).toBeNull();

    result.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
    vi.advanceTimersByTime(180);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.card-hover-preview')).toBeNull();
    vi.useRealTimers();
  });

  it('renders spoiler results as card images only', () => {
    const fixture = TestBed.createComponent(CardSearchResultsComponent);
    fixture.componentRef.setInput('results', [cardFixture()]);
    fixture.componentRef.setInput('searched', true);
    fixture.componentRef.setInput('viewMode', 'spoiler');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.card-results--spoiler img')?.getAttribute('src')).toBe('/sol-ring.jpg');
    expect(fixture.nativeElement.textContent).not.toContain('Sol Ring');
  });

  it('keeps the flip gesture inside the toggle on mobile interaction sequences', () => {
    const fixture = TestBed.createComponent(CardSearchResultsComponent);
    fixture.componentRef.setInput('results', [cardFixture({
      imageUris: {},
      cardFaces: [
        cardFace('Front', '/face-front.jpg'),
        cardFace('Back', '/face-back.jpg'),
      ],
    })]);
    fixture.componentRef.setInput('searched', true);
    fixture.componentRef.setInput('viewMode', 'spoiler');
    fixture.detectChanges();

    const toggle = fixture.nativeElement.querySelector('app-card-face-toggle-button button') as HTMLButtonElement;
    const image = () => fixture.nativeElement.querySelector('.mtg-card-result img') as HTMLImageElement | null;

    expect(image()?.getAttribute('src')).toBe('/face-front.jpg');

    toggle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }));
    toggle.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch' }));
    toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fixture.detectChanges();

    expect(image()?.getAttribute('src')).toBe('/face-back.jpg');
    expect(fixture.nativeElement.querySelector('.common-card-menu')).toBeNull();

    toggle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }));
    toggle.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch' }));
    toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fixture.detectChanges();

    expect(image()?.getAttribute('src')).toBe('/face-front.jpg');
    expect(fixture.nativeElement.querySelector('.common-card-menu')).toBeNull();
  });

  it('does not treat overlay toggle mouse clicks as result clicks', () => {
    const fixture = TestBed.createComponent(CardSearchResultsComponent);
    fixture.componentRef.setInput('results', [cardFixture({
      imageUris: {},
      cardFaces: [
        cardFace('Front', '/face-front.jpg'),
        cardFace('Back', '/face-back.jpg'),
      ],
    })]);
    fixture.componentRef.setInput('searched', true);
    fixture.componentRef.setInput('viewMode', 'spoiler');
    fixture.detectChanges();

    const toggle = fixture.nativeElement.querySelector('app-card-face-toggle-button button') as HTMLButtonElement;
    const image = () => fixture.nativeElement.querySelector('.mtg-card-result img') as HTMLImageElement | null;

    toggle.dispatchEvent(new Event('touchstart', { bubbles: true, cancelable: true }));
    toggle.dispatchEvent(new Event('touchend', { bubbles: true, cancelable: true }));
    toggle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }));
    toggle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    toggle.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' }));
    toggle.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
    toggle.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    fixture.detectChanges();

    expect(image()?.getAttribute('src')).toBe('/face-back.jpg');
    expect(fixture.nativeElement.querySelector('.common-card-menu')).toBeNull();
  });

  it('switches list results to two ten-row columns after ten visible cards', () => {
    const fixture = TestBed.createComponent(CardSearchResultsComponent);
    fixture.componentRef.setInput('results', Array.from({ length: 11 }, (_, index) => cardFixture({
      scryfallId: `00000000-0000-0000-0000-0000000000${String(index).padStart(2, '0')}`,
      name: `Very Long Search Result Name ${index}`,
    })));
    fixture.componentRef.setInput('searched', true);
    fixture.componentRef.setInput('viewMode', 'list');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.card-results')?.classList.contains('card-results--list-columns')).toBe(true);
  });

  it('marks battle card images for rotated rendering', () => {
    const fixture = TestBed.createComponent(CardSearchResultsComponent);
    fixture.componentRef.setInput('results', [cardFixture({
      typeLine: 'Battle - Siege',
    })]);
    fixture.componentRef.setInput('searched', true);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('app-card-face-image')?.classList.contains('card-face-image--battle')).toBe(true);
  });

  it('renders empty state after a completed search', () => {
    const fixture = TestBed.createComponent(CardSearchResultsComponent);
    fixture.componentRef.setInput('results', []);
    fixture.componentRef.setInput('searched', true);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('No cards found.');
  });
});

function cardFixture(overrides: Partial<Card> = {}): Card {
  return {
    id: 'card-1',
    scryfallId: '00000000-0000-0000-0000-000000000001',
    name: 'Sol Ring',
    manaCost: '{1}',
    typeLine: 'Artifact',
    oracleText: '',
    colors: [],
    colorIdentity: [],
    legalities: { commander: 'legal' },
    imageUris: { normal: '/sol-ring.jpg' },
    layout: 'normal',
    commanderLegal: true,
    set: 'cmm',
    setName: 'Commander Masters',
    rarity: 'rare',
    collectorNumber: '1',
    ...overrides,
  };
}

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
