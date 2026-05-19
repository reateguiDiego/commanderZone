import { ComponentFixture, TestBed } from '@angular/core/testing';
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
});

async function renderPreview(options: {
  sourceRect?: {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
  } | null;
} = {}): Promise<ComponentFixture<CardPreviewOverlayComponent>> {
  await TestBed.configureTestingModule({
    imports: [CardPreviewOverlayComponent],
  }).compileComponents();

  const fixture = TestBed.createComponent(CardPreviewOverlayComponent);
  fixture.componentRef.setInput('card', gameCard());
  fixture.componentRef.setInput('image', '/assets/card.jpg');
  fixture.componentRef.setInput('battlefieldRect', {
    left: 0,
    top: 0,
    right: 900,
    bottom: 520,
    width: 900,
    height: 520,
  });
  fixture.componentRef.setInput('sourceRect', options.sourceRect ?? null);
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
