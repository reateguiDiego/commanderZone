import { importProvidersFrom } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { LucideAngularModule, X } from 'lucide-angular';
import { CardAdvancedSearchFormComponent } from './card-advanced-search-form.component';

describe('CardAdvancedSearchFormComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CardAdvancedSearchFormComponent],
      providers: [
        importProvidersFrom(LucideAngularModule.pick({ X })),
      ],
    }).compileComponents();
  });

  it('emits typed filters for advanced search controls', () => {
    const fixture = TestBed.createComponent(CardAdvancedSearchFormComponent);
    const component = fixture.componentInstance;
    const submitted = vi.fn();
    component.searchSubmitted.subscribe(submitted);

    component.model.query = 'Atraxa';
    component.model.oracleTextA = 'proliferate';
    component.model.oracleTextB = 'draw';
    component.model.oracleTextMode = 'or';
    component.model.types = ['creature'];
    component.model.subtypes = ['phyrexian'];
    component.model.sets = ['one'];
    component.model.rarities = ['mythic'];
    component.model.colors = ['W', 'U', 'B', 'G'];
    component.model.colorMatchMode = 'exact';
    component.model.manaValueMin = 4;
    component.model.manaCost = 'WUBG';
    component.model.powerMin = 4;
    component.model.includeVariablePower = true;
    component.model.formats = ['commander'];
    component.model.viewMode = 'spoiler';
    component.model.enabledFilters = {
      name: true,
      text: true,
      types: true,
      subtypes: true,
      sets: true,
      rarities: true,
      colors: true,
      costs: true,
      stats: true,
      formats: true,
    };

    component.submit();

    expect(submitted).toHaveBeenCalledWith({
      query: 'Atraxa',
      viewMode: 'spoiler',
      filters: expect.objectContaining({
        oracleTextA: 'proliferate',
        oracleTextB: 'draw',
        oracleTextMode: 'or',
        types: ['creature'],
        subtypes: ['phyrexian'],
        sets: ['one'],
        rarities: ['mythic'],
        colors: ['W', 'U', 'B', 'G'],
        colorMatchMode: 'exact',
        manaValueMin: 4,
        manaCost: 'WUBG',
        powerMin: 4,
        includeVariablePower: true,
        formats: ['commander'],
      }),
    });
  });

  it('does not emit search when no enabled section has criteria', () => {
    const fixture = TestBed.createComponent(CardAdvancedSearchFormComponent);
    const component = fixture.componentInstance;
    const submitted = vi.fn();
    component.searchSubmitted.subscribe(submitted);

    component.model.query = 'Atraxa';
    component.model.oracleTextA = 'proliferate';
    component.model.types = ['creature'];
    component.model.formats = ['commander'];
    component.model.enabledFilters = {
      ...component.model.enabledFilters,
      name: false,
      text: false,
      types: false,
      formats: false,
    };

    component.submit();

    expect(submitted).not.toHaveBeenCalled();
  });

  it('clears all values without re-enabling the name section', () => {
    const fixture = TestBed.createComponent(CardAdvancedSearchFormComponent);
    const component = fixture.componentInstance;
    const cleared = vi.fn();
    component.cleared.subscribe(cleared);

    component.model.query = 'Sol Ring';
    component.model.types = ['artifact'];
    component.model.colors = ['W'];
    component.model.enabledFilters = {
      ...component.model.enabledFilters,
      name: true,
      types: true,
      colors: true,
    };

    component.clear();

    expect(cleared).toHaveBeenCalledOnce();
    expect(component.model.query).toBe('');
    expect(component.model.types).toEqual([]);
    expect(component.model.colors).toEqual([]);
    expect(Object.values(component.model.enabledFilters).every((enabled) => !enabled)).toBe(true);
    expect(component.hasSearchCriteria()).toBe(false);
    expect(component.hasClearableState()).toBe(false);
  });

  it('reports clearable state when a filter section is enabled without criteria', () => {
    const fixture = TestBed.createComponent(CardAdvancedSearchFormComponent);
    const component = fixture.componentInstance;

    expect(component.hasClearableState()).toBe(false);

    component.model.enabledFilters = {
      ...component.model.enabledFilters,
      colors: true,
    };

    expect(component.hasSearchCriteria()).toBe(false);
    expect(component.hasClearableState()).toBe(true);
  });

  it('caps numeric search values to 99 before emitting filters', () => {
    const fixture = TestBed.createComponent(CardAdvancedSearchFormComponent);
    const component = fixture.componentInstance;
    const submitted = vi.fn();
    component.searchSubmitted.subscribe(submitted);

    component.model.enabledFilters = {
      ...component.model.enabledFilters,
      costs: true,
      stats: true,
    };
    component.model.manaValueMin = 120;
    component.model.manaValueMax = 101;
    component.model.powerMin = 100;
    component.model.powerMax = 102;
    component.model.toughnessMin = 103;
    component.model.toughnessMax = 104;

    component.submit();

    expect(submitted).toHaveBeenCalledWith(expect.objectContaining({
      filters: expect.objectContaining({
        manaValueMin: 99,
        manaValueMax: 99,
        powerMin: 99,
        powerMax: 99,
        toughnessMin: 99,
        toughnessMax: 99,
      }),
    }));
  });
});
