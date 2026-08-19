import { ComponentFixture, TestBed } from '@angular/core/testing';
import { importProvidersFrom } from '@angular/core';
import { Eye, EyeOff, Link, LucideAngularModule } from 'lucide-angular';
import { GameCardInstance } from '../../../../../core/models/game.model';
import { CardPreviewOverlayComponent } from './card-preview-overlay.component';

describe('CardPreviewOverlayComponent', () => {
  it('renders premium attachment details when provided', async () => {
    const fixture = await renderPreview({
      attachmentInfo: {
        attachedTo: { instanceId: 'target', name: 'Kor Duelist' },
        attachedCards: [
          { instanceId: 'sword', name: 'Sword of Fire and Ice' },
          { instanceId: 'aura', name: 'Ethereal Armor' },
          { instanceId: 'greaves', name: 'Lightning Greaves' },
        ],
      },
    });
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('.attachment-preview')?.textContent).toContain('Attached to');
    expect(element.querySelector('.attachment-preview')?.textContent).toContain('Kor Duelist');
    expect(element.querySelector('.attachment-preview')?.textContent).toContain('Attached');
    expect(element.querySelector('.attachment-preview')?.textContent).not.toContain('Attached cards');
    expect(element.querySelector('.attachment-preview')?.textContent).toContain('Sword of Fire and Ice');
    expect(element.querySelector('.attachment-preview')?.textContent).toContain('Lightning Greaves');
    expect(element.querySelector('.attachment-preview')?.textContent).not.toContain('+1');
    expect(element.querySelector('.attachment-preview-label-with-icon lucide-icon')).not.toBeNull();
    expect(element.querySelector('.attached-to-row .attachment-preview-label-with-icon lucide-icon')).not.toBeNull();
  });

  it('renders modified power toughness and counters in the same premium detail box', async () => {
    const fixture = await renderPreview({
      attachmentInfo: {
        attachedTo: null,
        attachedCards: [{ instanceId: 'aura', name: 'Ethereal Armor' }],
      },
      cardStateInfo: {
        powerToughness: { power: 4, toughness: 5 },
        battle: null,
        saga: null,
        loyalty: null,
        counters: [
          { key: '+1/+1', value: 2 },
          { key: 'charge', value: 3 },
        ],
      },
    });
    const detailBox = fixture.nativeElement.querySelector('.attachment-preview') as HTMLElement;

    expect(detailBox.textContent).toContain('Attached');
    expect(detailBox.textContent).not.toContain('Attached cards');
    expect(detailBox.textContent).toContain('Current');
    expect(detailBox.textContent).not.toContain('Current P/T');
    expect(detailBox.textContent).not.toContain('Loyalty');
    expect(Array.from(detailBox.querySelectorAll('.preview-power-toughness span')).map((entry) => entry.textContent?.trim())).toEqual(['4', '5']);
    expect(detailBox.textContent).toContain('+1/+1');
    expect(detailBox.textContent).toContain('charge');
    expect(detailBox.querySelector('app-loyalty-counter')).toBeNull();
    expect(detailBox.querySelector('app-card-marker-rail')).not.toBeNull();
  });

  it('shows the reveal recipients beneath the card preview', async () => {
    const fixture = await renderPreview({ revealLabel: 'Revealed to JD' });

    const detailBox = fixture.nativeElement.querySelector('.attachment-preview') as HTMLElement;
    expect(detailBox.textContent).toContain('Revealed');
    expect(detailBox.textContent).toContain('Revealed to JD');
    expect(detailBox.querySelector('.preview-reveal-counter')).not.toBeNull();
  });

  it('shows the face-down pill only while the card remains face down', async () => {
    const fixture = await renderPreview({ showFaceDownPill: true });

    expect(fixture.nativeElement.querySelector('.preview-face-down-pill')?.textContent).toContain('Played face down');

    fixture.componentRef.setInput('showFaceDownPill', false);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.preview-face-down-pill')).toBeNull();
  });

  it('renders battle defense in the same premium detail box', async () => {
    const fixture = await renderPreview({
      card: {
        ...gameCard(),
        typeLine: 'Battle - Siege',
        defense: 5,
      },
      cardStateInfo: {
        powerToughness: null,
        battle: 5,
        saga: null,
        loyalty: null,
        counters: [],
      },
    });
    const detailBox = fixture.nativeElement.querySelector('.attachment-preview') as HTMLElement;

    expect(detailBox.textContent).toContain('Current');
    expect(detailBox.textContent).toContain('5');
    expect(detailBox.querySelector('app-battle-counter')).not.toBeNull();
    expect(detailBox.querySelector('app-loyalty-counter')).toBeNull();
  });

  it('renders saga chapters in the same premium detail box', async () => {
    const fixture = await renderPreview({
      card: {
        ...gameCard(),
        typeLine: 'Enchantment - Saga',
        activeFaceIndex: 1,
      },
      cardStateInfo: {
        powerToughness: null,
        battle: null,
        saga: 2,
        loyalty: null,
        counters: [],
      },
    });
    const detailBox = fixture.nativeElement.querySelector('.attachment-preview') as HTMLElement;

    expect(detailBox.textContent).toContain('Current');
    expect(detailBox.textContent).toContain('II');
    expect(detailBox.querySelector('app-saga-counter')).not.toBeNull();
    expect(detailBox.querySelector('app-battle-counter')).toBeNull();
  });

  it('does not show the column separator when only card state details are shown', async () => {
    const fixture = await renderPreview({
      cardStateInfo: {
        powerToughness: { power: 4, toughness: 5 },
        battle: null,
        saga: null,
        loyalty: 6,
        counters: [],
      },
    });
    const detailBox = fixture.nativeElement.querySelector('.attachment-preview') as HTMLElement;
    const layout = detailBox.querySelector('.attachment-preview-layout') as HTMLElement;

    expect(detailBox.textContent).toContain('Current');
    expect(detailBox.textContent).not.toContain('Attached');
    expect(layout.classList.contains('attachment-preview-layout-with-attachments')).toBe(false);
  });

  it('renders the dungeon marker over the preview image', async () => {
    const fixture = await renderPreview({
      card: {
        ...gameCard(),
        typeLine: 'Dungeon',
        dungeonMarker: { x: 0.25, y: 0.75 },
      },
    });

    const pin = fixture.nativeElement.querySelector('app-dungeon-location-pin') as HTMLElement | null;
    expect(pin).not.toBeNull();
  });

  it('renders the dungeon marker for legacy official dungeon cards without layout metadata', async () => {
    const fixture = await renderPreview({
      card: {
        ...gameCard(),
        name: 'Dungeon of the Mad Mage',
        typeLine: null,
        layout: null,
      },
    });

    const pin = fixture.nativeElement.querySelector('app-dungeon-location-pin') as HTMLElement | null;
    expect(pin).not.toBeNull();
  });
});

async function renderPreview(options: {
  card?: GameCardInstance;
  dungeonMarkerOverride?: { x: number; y: number } | null;
  sourceRect?: {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
  } | null;
  avoidRect?: {
    left: number;
    top: number;
    right: number;
    bottom: number;
  } | null;
  attachmentInfo?: {
    attachedTo: { instanceId: string; name: string } | null;
    attachedCards: readonly { instanceId: string; name: string }[];
  } | null;
  cardStateInfo?: {
    powerToughness: { power: number; toughness: number } | null;
    battle: number | null;
    saga: number | null;
    loyalty: number | null;
    counters: readonly { key: string; value: number }[];
  } | null;
  revealLabel?: string | null;
  showFaceDownPill?: boolean;
} = {}): Promise<ComponentFixture<CardPreviewOverlayComponent>> {
  await TestBed.configureTestingModule({
    imports: [CardPreviewOverlayComponent],
    providers: [importProvidersFrom(LucideAngularModule.pick({ Eye, EyeOff, Link }))],
  }).compileComponents();

  const fixture = TestBed.createComponent(CardPreviewOverlayComponent);
  fixture.componentRef.setInput('card', options.card ?? gameCard());
  fixture.componentRef.setInput('image', '/assets/card.jpg');
  fixture.componentRef.setInput('dungeonMarkerOverride', options.dungeonMarkerOverride ?? null);
  fixture.componentRef.setInput('battlefieldRect', {
    left: 0,
    top: 0,
    right: 900,
    bottom: 520,
    width: 900,
    height: 520,
  });
  fixture.componentRef.setInput('sourceRect', options.sourceRect ?? null);
  fixture.componentRef.setInput('avoidRect', options.avoidRect ?? null);
  fixture.componentRef.setInput('attachmentInfo', options.attachmentInfo ?? null);
  fixture.componentRef.setInput('cardStateInfo', options.cardStateInfo ?? null);
  fixture.componentRef.setInput('revealLabel', options.revealLabel ?? null);
  fixture.componentRef.setInput('showFaceDownPill', options.showFaceDownPill ?? false);
  fixture.detectChanges();

  return fixture;
}

function gameCard(): GameCardInstance {
  return {
    instanceId: 'card-1',
    name: 'Arcane Signet',
    tapped: false,
  };
}
