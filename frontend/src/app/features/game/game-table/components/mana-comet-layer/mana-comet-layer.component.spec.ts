import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ManaCometLayerComponent, ManaCometEffect } from './mana-comet-layer.component';

describe('ManaCometLayerComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ManaCometLayerComponent],
    }).compileComponents();
  });

  it('renders one comet per mana effect with trajectory styles', () => {
    const fixture = createFixture([{
      id: 'effect-1',
      color: 'G',
      startX: 10,
      startY: 20,
      endX: 100,
      endY: 140,
      angleDeg: 53,
      trailLength: 80,
      delayMs: 90,
    }]);

    const comet = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.mana-comet');

    expect(comet).not.toBeNull();
    expect(comet?.style.getPropertyValue('--mana-comet-start-x')).toBe('10px');
    expect(comet?.style.getPropertyValue('--mana-comet-end-y')).toBe('140px');
    expect(comet?.style.getPropertyValue('--mana-comet-angle')).toBe('53deg');
    expect(comet?.querySelector('app-mana-symbols')).not.toBeNull();
  });
});

function createFixture(effects: readonly ManaCometEffect[]): ComponentFixture<ManaCometLayerComponent> {
  const fixture = TestBed.createComponent(ManaCometLayerComponent);
  fixture.componentRef.setInput('effects', effects);
  fixture.detectChanges();

  return fixture;
}
