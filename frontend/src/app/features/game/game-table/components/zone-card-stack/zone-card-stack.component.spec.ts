import { ComponentFixture, TestBed } from '@angular/core/testing';
import { gsap } from 'gsap';
import { ZoneCardStackComponent } from './zone-card-stack.component';

describe('ZoneCardStackComponent', () => {
  it.each([
    { count: 1, layerImage: null, expectedLayers: 0 },
    { count: 4, layerImage: null, expectedLayers: 0 },
    { count: 4, layerImage: '/assets/second-card.jpg', expectedLayers: 3 },
  ])('renders the top card and optional visual layers for count $count', async ({ count, layerImage, expectedLayers }) => {
    const fixture = await renderZoneCardStack(count, layerImage);
    const layers = stackLayers(fixture);

    expect(topImage(fixture)?.getAttribute('src')).toBe('/assets/card.jpg');
    expect(layers.length).toBe(expectedLayers);
    expect(layers.every((layer) => layer.getAttribute('src') === layerImage)).toBe(true);
  });

  it('caps deep piles to a stable visual stack while keeping the real count outside', async () => {
    const fixture = await renderZoneCardStack(78, '/assets/second-card.jpg');

    const layers = stackLayers(fixture);
    expect(layers.length).toBe(9);
    expect(layers.at(-1)?.style.getPropertyValue('--stack-offset')).toBe('7px');
  });

  it('renders the Lucide eye SVG only while the top card is revealed', async () => {
    const fixture = await renderZoneCardStack(4, '/assets/second-card.jpg');

    expect(fixture.nativeElement.querySelector('.zone-card-stack-reveal-indicator')).toBeNull();

    fixture.componentRef.setInput('showRevealIndicator', true);
    fixture.detectChanges();

    const eye = fixture.nativeElement.querySelector('.zone-card-stack-reveal-indicator svg.lucide-eye') as SVGElement | null;
    expect(eye?.getAttribute('viewBox')).toBe('0 0 24 24');
  });

  it('does not replay a previous shuffle when the viewed player changes', async () => {
    const fixture = await renderZoneCardStack(4, '/assets/second-card.jpg', 'player-1', 10);
    const timeline = vi.spyOn(gsap, 'timeline');

    fixture.componentRef.setInput('shufflePlayerId', 'player-2');
    fixture.componentRef.setInput('shuffleRevision', 11);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(timeline).not.toHaveBeenCalled();
  });

  it('keeps a newly revealed top card face down until the shuffle has finished', async () => {
    const fixture = await renderZoneCardStack(4, '/assets/second-card.jpg', 'player-1', 10);
    await fixture.whenStable();
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: () => ({ matches: false }),
    });
    const cards = Array.from(fixture.nativeElement.querySelectorAll('.zone-card-stack-layer, .zone-card-stack-top')) as HTMLElement[];
    cards.forEach((card) => Object.defineProperty(card, 'getClientRects', { value: () => [new DOMRect()] }));
    const topCard = topImage(fixture)!;
    topCard.style.opacity = '0';
    topCard.style.visibility = 'hidden';
    let completeShuffle: (() => void) | undefined;
    const timeline = {
      set: vi.fn().mockReturnThis(),
      to: vi.fn().mockReturnThis(),
      kill: vi.fn(),
    };
    vi.spyOn(gsap, 'timeline').mockImplementation((config) => {
      completeShuffle = config?.onComplete;
      return timeline as unknown as gsap.core.Timeline;
    });

    fixture.componentRef.setInput('showRevealIndicator', true);
    fixture.componentRef.setInput('image', '/assets/new-revealed-top.jpg');
    fixture.componentRef.setInput('shuffleRevision', 11);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(topCard.getAttribute('src')).toBe('/assets/second-card.jpg');

    completeShuffle?.();
    fixture.detectChanges();

    expect(topCard.style.visibility).not.toBe('hidden');
    expect(topCard.style.opacity).not.toBe('0');
    expect(topCard.getAttribute('src')).toBe('/assets/new-revealed-top.jpg');
  });
});

async function renderZoneCardStack(
  count: number,
  layerImage: string | null = null,
  shufflePlayerId: string | null = null,
  shuffleRevision: number | null = null,
): Promise<ComponentFixture<ZoneCardStackComponent>> {
  await TestBed.configureTestingModule({
    imports: [ZoneCardStackComponent],
  }).compileComponents();

  const fixture = TestBed.createComponent(ZoneCardStackComponent);
  fixture.componentRef.setInput('image', '/assets/card.jpg');
  fixture.componentRef.setInput('layerImage', layerImage);
  fixture.componentRef.setInput('label', 'Library');
  fixture.componentRef.setInput('count', count);
  fixture.componentRef.setInput('shufflePlayerId', shufflePlayerId);
  fixture.componentRef.setInput('shuffleRevision', shuffleRevision);
  fixture.detectChanges();

  return fixture;
}

function stackLayers(fixture: ComponentFixture<ZoneCardStackComponent>): HTMLImageElement[] {
  return Array.from(fixture.nativeElement.querySelectorAll('.zone-card-stack-layer'));
}

function topImage(fixture: ComponentFixture<ZoneCardStackComponent>): HTMLImageElement | null {
  return fixture.nativeElement.querySelector('.zone-card-stack-top');
}
