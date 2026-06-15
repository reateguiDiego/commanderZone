import { ComponentFixture, TestBed } from '@angular/core/testing';
import { importProvidersFrom } from '@angular/core';
import { Link, LucideAngularModule } from 'lucide-angular';
import { GameCardInstance } from '../../../../../core/models/game.model';
import { CardPreviewOverlayComponent } from './card-preview-overlay.component';

describe('CardPreviewOverlayComponent', () => {
  it('anchors the preview near the right side of the battlefield and vertically centered', async () => {
    const fixture = await renderPreview();
    const style = fixture.componentInstance.previewStyle();

    expect(style.left).toBe(600);
    expect(style.top).toBeCloseTo(58.8, 1);
    expect(style.width).toBe(288);
  });

  it('moves below the hovered source when the default position would cover it', async () => {
    const fixture = await renderPreview({
      sourceRect: {
        left: 650,
        top: 30,
        right: 760,
        bottom: 80,
        width: 110,
        height: 50,
      },
    });

    expect(fixture.componentInstance.previewStyle().top).toBe(94);
  });

  it('moves away from an open context menu when the default position would cover it', async () => {
    const fixture = await renderPreview({
      avoidRect: {
        left: 590,
        top: 40,
        right: 880,
        bottom: 80,
      },
    });

    expect(fixture.componentInstance.previewStyle().top).toBe(94);
  });

  it('moves above the hovered source when there is no room below it', async () => {
    const fixture = await renderPreview({
      sourceRect: {
        left: 650,
        top: 395,
        right: 760,
        bottom: 515,
        width: 110,
        height: 120,
      },
    });

    expect(fixture.componentInstance.previewStyle().top).toBeLessThan(395);
  });

  it('prefers a clamped above position when below would not fit', async () => {
    const fixture = await renderPreview({
      sourceRect: {
        left: 650,
        top: 210,
        right: 760,
        bottom: 470,
        width: 110,
        height: 260,
      },
    });

    expect(fixture.componentInstance.previewStyle().top).toBeLessThan(210);
  });

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

    expect(fixture.componentInstance.previewStyle().width).toBe(270);
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

  it('plays the face flip animation when the hover preview changes card face', async () => {
    const fixture = await renderPreview();

    vi.useFakeTimers();
    try {
      const visual = fixture.nativeElement.querySelector('.card-preview-visual') as HTMLElement;

      expect(visual.classList).not.toContain('face-flipping');

      fixture.componentRef.setInput('card', { ...gameCard(), activeFaceIndex: 1 });
      fixture.detectChanges();

      expect(visual.classList).toContain('face-flipping');

      vi.advanceTimersByTime(620);
      fixture.detectChanges();

      expect(visual.classList).not.toContain('face-flipping');
    } finally {
      vi.useRealTimers();
    }
  });

  it('renders modified power toughness and counters in the same premium detail box', async () => {
    const fixture = await renderPreview({
      attachmentInfo: {
        attachedTo: null,
        attachedCards: [{ instanceId: 'aura', name: 'Ethereal Armor' }],
      },
      cardStateInfo: {
        powerToughness: { power: 4, toughness: 5 },
        loyalty: 6,
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
    expect(detailBox.textContent).toContain('6');
    expect(detailBox.textContent).toContain('+1/+1');
    expect(detailBox.textContent).toContain('charge');
    expect(detailBox.querySelector('app-loyalty-counter')).not.toBeNull();
    expect(detailBox.querySelector('app-card-marker-rail')).not.toBeNull();
  });

  it('does not show the column separator when only card state details are shown', async () => {
    const fixture = await renderPreview({
      cardStateInfo: {
        powerToughness: { power: 4, toughness: 5 },
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
    expect(pin?.style.left).toBe('25%');
    expect(pin?.style.top).toBe('75%');
    expect(pin?.style.getPropertyValue('--cz-dungeon-pin-size')).toBe('55px');
  });

  it('uses the live dungeon marker override over the card marker', async () => {
    const fixture = await renderPreview({
      card: {
        ...gameCard(),
        typeLine: 'Dungeon',
        dungeonMarker: { x: 0.25, y: 0.75 },
      },
      dungeonMarkerOverride: { x: 0.6, y: 0.35 },
    });

    const pin = fixture.nativeElement.querySelector('app-dungeon-location-pin') as HTMLElement | null;
    expect(pin?.style.left).toBe('60%');
    expect(pin?.style.top).toBe('35%');
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
    expect(pin?.style.left).toBe('50%');
    expect(pin?.style.top).toBe('50%');
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
    loyalty: number | null;
    counters: readonly { key: string; value: number }[];
  } | null;
} = {}): Promise<ComponentFixture<CardPreviewOverlayComponent>> {
  await TestBed.configureTestingModule({
    imports: [CardPreviewOverlayComponent],
    providers: [importProvidersFrom(LucideAngularModule.pick({ Link }))],
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
