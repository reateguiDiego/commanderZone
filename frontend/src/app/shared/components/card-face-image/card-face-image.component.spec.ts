import { importProvidersFrom, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { gsap } from 'gsap';
import { LucideAngularModule, RotateCw } from 'lucide-angular';
import { Card, CardFace } from '../../../core/models/card.model';
import { DeviceProfileService } from '../../services/device-profile.service';
import { CardFaceImageComponent } from './card-face-image.component';

describe('CardFaceImageComponent', () => {
  let isMobile: ReturnType<typeof signal<boolean>>;
  let isDesktopLayout: ReturnType<typeof signal<boolean>>;
  let hasCoarsePointer: ReturnType<typeof signal<boolean>>;
  let hasHover: ReturnType<typeof signal<boolean>>;

  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(async () => {
    isMobile = signal(false);
    isDesktopLayout = signal(true);
    hasCoarsePointer = signal(false);
    hasHover = signal(true);

    await TestBed.configureTestingModule({
      imports: [CardFaceImageComponent],
      providers: [
        importProvidersFrom(LucideAngularModule.pick({ RotateCw })),
        { provide: DeviceProfileService, useValue: { isMobile, isDesktopLayout, hasCoarsePointer, hasHover } },
      ],
    }).compileComponents();
  });

  it('renders the primary card image without a toggle for single-faced cards', () => {
    const fixture = createComponent(cardFixture());
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('img')?.getAttribute('src')).toBe('/front.jpg');
    expect(fixture.nativeElement.querySelector('.card-face-image__toggle')).toBeNull();
  });

  it('toggles to the alternate face image for double-faced cards', () => {
    const fixture = createComponent(cardFixture({
      imageUris: {},
      cardFaces: [
        cardFace('Front', '/face-front.jpg'),
        cardFace('Back', '/face-back.jpg'),
      ],
    }));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('img')?.getAttribute('src')).toBe('/face-front.jpg');

    mockGsapFlipAnimation();

    const toggle = fixture.nativeElement.querySelector('app-card-face-toggle-button button') as HTMLButtonElement;
    toggle.click();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('img')?.getAttribute('src')).toBe('/face-back.jpg');
  });

  it('updates the battle rotation class from the visible face after flipping', () => {
    const fixture = createComponent(cardFixture({
      typeLine: 'Battle - Siege',
      imageUris: {},
      cardFaces: [
        cardFace('Invasion', '/face-front.jpg', 'Battle - Siege'),
        cardFace('Awakened Land', '/face-back.jpg', 'Land'),
      ],
    }));
    fixture.componentRef.setInput('battle', true);
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).classList.contains('card-face-image--battle')).toBe(true);

    mockGsapFlipAnimation();
    const toggle = fixture.nativeElement.querySelector('app-card-face-toggle-button button') as HTMLButtonElement;
    toggle.click();
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).classList.contains('card-face-image--battle')).toBe(false);
  });

  it('keeps allowing repeated toggles after the first flip', () => {
    const fixture = createComponent(cardFixture({
      imageUris: {},
      cardFaces: [
        cardFace('Front', '/face-front.jpg'),
        cardFace('Back', '/face-back.jpg'),
      ],
    }));
    fixture.detectChanges();

    mockGsapFlipAnimation();

    const toggle = fixture.nativeElement.querySelector('app-card-face-toggle-button button') as HTMLButtonElement;
    toggle.click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('img')?.getAttribute('src')).toBe('/face-back.jpg');

    toggle.click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('img')?.getAttribute('src')).toBe('/face-front.jpg');
  });

  it('uses the large image when readability is preferred', () => {
    const fixture = createComponent(cardFixture({
      imageUris: {
        normal: '/normal.jpg',
        large: '/large.jpg',
      },
    }));
    fixture.componentRef.setInput('preferLarge', true);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('img')?.getAttribute('src')).toBe('/large.jpg');
  });

  it('syncs the visible face from the controlled input for hover previews', () => {
    const fixture = createComponent(cardFixture({
      imageUris: {},
      cardFaces: [
        cardFace('Front', '/face-front.jpg'),
        cardFace('Back', '/face-back.jpg'),
      ],
    }));
    fixture.detectChanges();

    mockGsapFlipAnimation();
    fixture.componentRef.setInput('controlledFlipped', true);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('img')?.getAttribute('src')).toBe('/face-back.jpg');
  });

  it('skips GSAP and flips instantly on mobile devices', () => {
    isMobile.set(true);
    isDesktopLayout.set(false);
    hasCoarsePointer.set(true);
    hasHover.set(false);

    const fixture = createComponent(cardFixture({
      imageUris: {},
      cardFaces: [
        cardFace('Front', '/face-front.jpg'),
        cardFace('Back', '/face-back.jpg'),
      ],
    }));
    fixture.detectChanges();

    const gsapToSpy = vi.spyOn(gsap, 'to');
    vi.spyOn(gsap, 'killTweensOf').mockImplementation(() => undefined);
    vi.spyOn(gsap, 'set').mockImplementation(() => undefined as never);

    const toggle = fixture.nativeElement.querySelector('app-card-face-toggle-button button') as HTMLButtonElement;
    toggle.click();
    fixture.detectChanges();

    expect(gsapToSpy).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('img')?.getAttribute('src')).toBe('/face-back.jpg');
  });

  it('skips GSAP on compact layouts even if the browser reports hover', () => {
    isDesktopLayout.set(false);
    hasCoarsePointer.set(true);
    hasHover.set(true);

    const fixture = createComponent(cardFixture({
      imageUris: {},
      cardFaces: [
        cardFace('Front', '/face-front.jpg'),
        cardFace('Back', '/face-back.jpg'),
      ],
    }));
    fixture.detectChanges();

    const gsapToSpy = vi.spyOn(gsap, 'to');
    vi.spyOn(gsap, 'killTweensOf').mockImplementation(() => undefined);
    vi.spyOn(gsap, 'set').mockImplementation(() => undefined as never);

    const toggle = fixture.nativeElement.querySelector('app-card-face-toggle-button button') as HTMLButtonElement;
    toggle.click();
    fixture.detectChanges();

    expect(gsapToSpy).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('img')?.getAttribute('src')).toBe('/face-back.jpg');
  });
});

function createComponent(card: Card): ComponentFixture<CardFaceImageComponent> {
  const fixture = TestBed.createComponent(CardFaceImageComponent);
  fixture.componentRef.setInput('card', card);

  return fixture;
}

function mockGsapFlipAnimation(): void {
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
  vi.spyOn(gsap, 'killTweensOf').mockImplementation(() => undefined);
  vi.spyOn(gsap, 'set').mockImplementation(() => undefined as never);
  vi.spyOn(gsap, 'to').mockImplementation((_target, vars) => {
    vars.onComplete?.();
    return {
      kill: vi.fn(),
    } as unknown as gsap.core.Tween;
  });
}

function cardFace(name: string, imageUrl: string, typeLine: string | null = null): CardFace {
  return {
    name,
    manaCost: null,
    typeLine,
    oracleText: null,
    power: null,
    toughness: null,
    loyalty: null,
    colors: [],
    imageUris: { normal: imageUrl },
  };
}

function cardFixture(overrides: Partial<Card> = {}): Card {
  return {
    id: 'card-1',
    scryfallId: 'card-1',
    name: 'Double Faced Card',
    manaCost: '{1}',
    typeLine: 'Artifact',
    oracleText: '',
    colors: [],
    colorIdentity: [],
    legalities: {},
    imageUris: { normal: '/front.jpg' },
    cardFaces: [],
    hasRulings: false,
    allParts: [],
    manaValue: 1,
    producedMana: [],
    prices: {},
    layout: 'normal',
    commanderLegal: true,
    set: 'tst',
    collectorNumber: '1',
    ...overrides,
  };
}
