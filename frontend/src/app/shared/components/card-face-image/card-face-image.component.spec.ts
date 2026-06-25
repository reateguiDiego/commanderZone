import { importProvidersFrom } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { LucideAngularModule, RotateCw } from 'lucide-angular';
import { Card, CardFace } from '../../../core/models/card.model';
import { CardFaceImageComponent } from './card-face-image.component';

describe('CardFaceImageComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CardFaceImageComponent],
      providers: [
        importProvidersFrom(LucideAngularModule.pick({ RotateCw })),
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

    const toggle = fixture.nativeElement.querySelector('.card-face-image__toggle') as HTMLButtonElement;
    toggle.click();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('img')?.getAttribute('src')).toBe('/face-back.jpg');
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
});

function createComponent(card: Card): ComponentFixture<CardFaceImageComponent> {
  const fixture = TestBed.createComponent(CardFaceImageComponent);
  fixture.componentRef.setInput('card', card);

  return fixture;
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
