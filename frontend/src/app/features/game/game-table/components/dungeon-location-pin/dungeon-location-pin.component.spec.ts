import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DungeonLocationPinComponent } from './dungeon-location-pin.component';

describe('DungeonLocationPinComponent', () => {
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
