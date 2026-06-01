import { TestBed } from '@angular/core/testing';
import { GameTableManaCometService } from './game-table-mana-comet.service';

describe('GameTableManaCometService', () => {
  let service: GameTableManaCometService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [GameTableManaCometService],
    });
    service = TestBed.inject(GameTableManaCometService);
  });

  it('creates comet effects from a source point to the matching mana pool target', () => {
    const target = document.createElement('button');
    target.dataset['manaPoolColor'] = 'G';
    document.body.appendChild(target);
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue(rect(90, 110, 20, 20));

    service.animateFromSource({ x: 10, y: 20 }, [{ color: 'G', amount: 1 }]);

    const [effect] = service.effects();
    expect(effect).toEqual(expect.objectContaining({
      color: 'G',
      startX: 10,
      startY: 20,
      endX: 100,
      endY: 120,
    }));

    target.remove();
  });

  it('caps repeated comets for large mana amounts', () => {
    const target = document.createElement('button');
    target.dataset['manaPoolColor'] = 'C';
    document.body.appendChild(target);
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue(rect(40, 40, 20, 20));

    service.animateFromSource({ x: 10, y: 10 }, [{ color: 'C', amount: 12 }]);

    expect(service.effects().length).toBe(3);

    target.remove();
  });

  it('runs the completion callback after the last comet reaches the target', () => {
    vi.useFakeTimers();
    const target = document.createElement('button');
    target.dataset['manaPoolColor'] = 'G';
    document.body.appendChild(target);
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue(rect(90, 110, 20, 20));
    const completed = vi.fn();

    service.animateFromSource({ x: 10, y: 20 }, [{ color: 'G', amount: 2 }], completed);

    vi.advanceTimersByTime(971);
    expect(completed).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(completed).toHaveBeenCalledOnce();

    target.remove();
    vi.useRealTimers();
  });
});

function rect(x: number, y: number, width: number, height: number): DOMRect {
  return {
    x,
    y,
    width,
    height,
    top: y,
    right: x + width,
    bottom: y + height,
    left: x,
    toJSON: () => ({}),
  };
}
