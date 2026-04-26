import { TestBed } from '@angular/core/testing';
import { DeckAnalysisService } from './deck-analysis.service';

describe('DeckAnalysisService', () => {
  let service: DeckAnalysisService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(DeckAnalysisService);
  });

  it('provides an empty backend analysis DTO fallback without calculating MTG rules', () => {
    const analysis = service.empty();

    expect(analysis.summary.totalCards).toBe(0);
    expect(analysis.manaCurve.buckets).toHaveLength(8);
    expect(analysis.colorRequirement.symbolsByColor['W'].symbolCount).toBe(0);
    expect(analysis.manaProduction.productionByColor['G'].sourceCount).toBe(0);
  });
});
