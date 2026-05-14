import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ZoneCardStackComponent } from './zone-card-stack.component';

describe('ZoneCardStackComponent', () => {
  it('renders only the top card image when the stack has one card', async () => {
    const fixture = await renderZoneCardStack(1);

    expect(stackLayers(fixture).length).toBe(0);
    expect(topImage(fixture)?.getAttribute('src')).toBe('/assets/card.jpg');
  });

  it('renders one visual image per card using the configured image', async () => {
    const fixture = await renderZoneCardStack(4);

    const layers = stackLayers(fixture);
    expect(layers.length).toBe(3);
    expect(layers.every((layer) => layer.getAttribute('src') === '/assets/card.jpg')).toBe(true);
    expect(topImage(fixture)?.getAttribute('src')).toBe('/assets/card.jpg');
  });

  it('caps deep piles to a stable visual stack while keeping the real count outside', async () => {
    const fixture = await renderZoneCardStack(78);

    const layers = stackLayers(fixture);
    expect(layers.length).toBe(9);
    expect(layers.at(-1)?.style.getPropertyValue('--stack-offset')).toBe('7px');
  });
});

async function renderZoneCardStack(count: number): Promise<ComponentFixture<ZoneCardStackComponent>> {
  await TestBed.configureTestingModule({
    imports: [ZoneCardStackComponent],
  }).compileComponents();

  const fixture = TestBed.createComponent(ZoneCardStackComponent);
  fixture.componentRef.setInput('image', '/assets/card.jpg');
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
