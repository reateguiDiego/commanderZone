import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DungeonLocationPinComponent } from './dungeon-location-pin.component';

describe('DungeonLocationPinComponent', () => {
  it('places the pin from normalized marker coordinates', async () => {
    const fixture = await renderPin();

    fixture.componentRef.setInput('marker', { x: 0.35, y: 0.7 });
    fixture.detectChanges();

    expect(host(fixture).style.left).toBe('35%');
    expect(host(fixture).style.top).toBe('70%');
    expect(host(fixture).querySelector('svg.dungeon-location-pin__mark')).not.toBeNull();
    expect(host(fixture).querySelector('.dungeon-location-pin__drop')).not.toBeNull();
    expect(host(fixture).querySelector('.dungeon-location-pin__reticle')).not.toBeNull();
    expect(host(fixture).querySelector('.dungeon-location-pin__aim-point')).not.toBeNull();
  });

  it('applies the requested visual size through the host custom property', async () => {
    const fixture = await renderPin();

    fixture.componentRef.setInput('marker', { x: 0.5, y: 0.5 });
    fixture.componentRef.setInput('size', '44px');
    fixture.detectChanges();

    expect(host(fixture).style.getPropertyValue('--cz-dungeon-pin-size')).toBe('44px');
  });

  it('exposes button semantics only when the pin is interactive', async () => {
    const fixture = await renderPin();

    fixture.componentRef.setInput('marker', { x: 0.5, y: 0.5 });
    fixture.detectChanges();

    expect(host(fixture).getAttribute('aria-hidden')).toBe('true');
    expect(host(fixture).getAttribute('role')).toBeNull();

    fixture.componentRef.setInput('interactive', true);
    fixture.detectChanges();

    expect(host(fixture).getAttribute('role')).toBe('button');
    expect(host(fixture).getAttribute('aria-label')).toBe('Dungeon marker');
    expect(host(fixture).getAttribute('aria-hidden')).toBeNull();
  });
});

async function renderPin(): Promise<ComponentFixture<DungeonLocationPinComponent>> {
  await TestBed.configureTestingModule({
    imports: [DungeonLocationPinComponent],
  }).compileComponents();

  return TestBed.createComponent(DungeonLocationPinComponent);
}

function host(fixture: ComponentFixture<DungeonLocationPinComponent>): HTMLElement {
  return fixture.nativeElement as HTMLElement;
}
