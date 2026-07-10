import { ComponentFixture, TestBed } from '@angular/core/testing';
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
});

async function renderZoneCardStack(count: number, layerImage: string | null = null): Promise<ComponentFixture<ZoneCardStackComponent>> {
  await TestBed.configureTestingModule({
    imports: [ZoneCardStackComponent],
  }).compileComponents();

  const fixture = TestBed.createComponent(ZoneCardStackComponent);
  fixture.componentRef.setInput('image', '/assets/card.jpg');
  fixture.componentRef.setInput('layerImage', layerImage);
  fixture.componentRef.setInput('label', 'Library');
  fixture.componentRef.setInput('count', count);
  fixture.detectChanges();

  return fixture;
}

function stackLayers(fixture: ComponentFixture<ZoneCardStackComponent>): HTMLImageElement[] {
  return Array.from(fixture.nativeElement.querySelectorAll('.zone-card-stack-layer'));
}

function topImage(fixture: ComponentFixture<ZoneCardStackComponent>): HTMLImageElement | null {
  return fixture.nativeElement.querySelector('.zone-card-stack-top');
}
