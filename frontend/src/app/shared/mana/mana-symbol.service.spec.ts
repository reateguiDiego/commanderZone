import { TestBed } from '@angular/core/testing';
import { ManaSymbolService } from './mana-symbol.service';

describe('ManaSymbolService', () => {
  let service: ManaSymbolService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ManaSymbolService);
  });

  it('parses simple, generic, tap, energy and snow symbols', () => {
    const tokens = service.parseCost('{2}{W}{U}{T}{E}{S}');

    expect(tokens.map((token) => token.className)).toEqual([
      'ms ms-cost ms-2',
      'ms ms-cost ms-w',
      'ms ms-cost ms-u',
      'ms ms-cost ms-tap',
      'ms ms-cost ms-e',
      'ms ms-cost ms-s',
    ]);
  });

  it('parses hybrid and phyrexian symbols', () => {
    const tokens = service.parseCost('{W/U}{2/W}{W/P}{C/W}');

    expect(tokens.map((token) => token.className)).toEqual([
      'ms ms-cost ms-wu',
      'ms ms-cost ms-2w',
      'ms ms-cost ms-wp',
      'ms ms-cost ms-cw',
    ]);
  });

  it('keeps unknown symbols as fallback tokens', () => {
    const token = service.parseCost('{UNKNOWN}')[0];

    expect(token.known).toBe(false);
    expect(token.raw).toBe('{UNKNOWN}');
  });

  it('parses oracle text into text and symbol parts', () => {
    const parts = service.parseText('Add {G}.\n{T}: Draw a card.');

    expect(parts.some((part) => part.kind === 'symbol' && part.token.className === 'ms ms-cost ms-g')).toBe(true);
    expect(parts.some((part) => part.kind === 'symbol' && part.token.className === 'ms ms-cost ms-tap')).toBe(true);
    expect(parts.some((part) => part.kind === 'text' && part.value.includes('\n'))).toBe(true);
  });

  it('counts land types from type lines', () => {
    const counts = service.landTypeCounts(['Basic Land - Mountain', 'Land - Island Swamp', 'Artifact']);

    expect(counts.find((land) => land.label === 'Mountain')?.count).toBe(1);
    expect(counts.find((land) => land.label === 'Island')?.count).toBe(1);
    expect(counts.find((land) => land.label === 'Swamp')?.count).toBe(1);
    expect(counts.find((land) => land.label === 'Forest')?.count).toBe(0);
  });
});
