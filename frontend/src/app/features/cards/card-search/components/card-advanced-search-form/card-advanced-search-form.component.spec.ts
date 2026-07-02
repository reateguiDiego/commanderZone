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
    component.model.oracleTextExact = true;
    component.model.types = ['creature'];
    component.model.legendary = true;
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
    component.model.sort = 'mana_value_desc';
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
        oracleTextExact: true,
        types: ['creature'],
        legendary: true,
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
        sort: 'mana_value_desc',
      }),
    });
  });

  it('does not emit exact text matching while the exact toggle is disabled', () => {
    const fixture = TestBed.createComponent(CardAdvancedSearchFormComponent);
    const component = fixture.componentInstance;
    const submitted = vi.fn();
    component.searchSubmitted.subscribe(submitted);

    component.model.enabledFilters = {
      ...component.model.enabledFilters,
      text: true,
    };
    component.model.oracleTextA = 'rat';

    component.submit();

    expect(submitted).toHaveBeenCalledWith(expect.objectContaining({
      filters: expect.objectContaining({
        oracleTextA: 'rat',
        oracleTextMode: 'and',
      }),
    }));
    expect(submitted.mock.calls[0][0].filters.oracleTextExact).toBeUndefined();
  });

  it('accepts colors as a valid sort mode', () => {
    const fixture = TestBed.createComponent(CardAdvancedSearchFormComponent);
    const component = fixture.componentInstance;
    const submitted = vi.fn();
    component.searchSubmitted.subscribe(submitted);

    component.model.query = 'Atraxa';
    component.model.sort = 'colors';
    component.model.enabledFilters = {
      ...component.model.enabledFilters,
      name: true,
    };

    component.submit();

    expect(submitted).toHaveBeenCalledWith(expect.objectContaining({
      filters: expect.objectContaining({
        sort: 'colors',
      }),
    }));
  });

  it('emits the basic type modifier only while land is selected', () => {
    const fixture = TestBed.createComponent(CardAdvancedSearchFormComponent);
    const component = fixture.componentInstance;
    const submitted = vi.fn();
    component.searchSubmitted.subscribe(submitted);

    component.model.enabledFilters = {
      ...component.model.enabledFilters,
      types: true,
    };
    component.model.types = ['land'];
    component.model.basic = true;

    component.submit();

    expect(submitted).toHaveBeenCalledWith(expect.objectContaining({
      filters: expect.objectContaining({
        types: ['land'],
        basic: true,
      }),
    }));

    submitted.mockClear();
    component.toggleType('land', false);
    component.model.legendary = true;
    component.submit();

    expect(component.model.basic).toBe(false);
    expect(submitted).toHaveBeenCalledWith(expect.objectContaining({
      filters: expect.objectContaining({
        legendary: true,
      }),
    }));
    expect(submitted.mock.calls[0][0].filters.basic).toBeUndefined();
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

  it('clears mana cost and mana value range together', () => {
    const fixture = TestBed.createComponent(CardAdvancedSearchFormComponent);
    const component = fixture.componentInstance;

    component.model.manaCost = '2GG';
    component.model.manaValueMin = 2;
    component.model.manaValueMax = 6;

    expect(component.hasManaCostState()).toBe(true);

    component.clearManaCost();

    expect(component.model.manaCost).toBe('');
    expect(component.model.manaValueMin).toBeNull();
    expect(component.model.manaValueMax).toBeNull();
    expect(component.hasManaCostState()).toBe(false);
  });

  it('matches subtype and set filters without diacritics', () => {
    const fixture = TestBed.createComponent(CardAdvancedSearchFormComponent);
    const component = fixture.componentInstance;
    fixture.componentRef.setInput('options', {
      types: [],
      subtypes: [
        { code: 'angel', name: 'Ángel' },
        { code: 'beast', name: 'Bestia' },
      ],
      sets: [
        { code: 'alb', name: 'Álbum Promocional' },
        { code: 'bro', name: 'Brothers War' },
      ],
      rarities: [],
      formats: [],
    });
    fixture.detectChanges();

    component.subtypeFilter.set('angel');
    component.setFilter.set('album');

    expect(component.visibleSubtypeOptions().map((option) => option.code)).toEqual(['angel']);
    expect(component.visibleSetOptions().map((option) => option.code)).toEqual(['alb']);
  });

  it('limits power and toughness inputs to two numeric characters while typing', () => {
    const fixture = TestBed.createComponent(CardAdvancedSearchFormComponent);
    const component = fixture.componentInstance;
    const input = document.createElement('input');
    input.value = '123';

    component.limitStatInput(new Event('input', { bubbles: true }), 'powerMin');
    expect(component.model.powerMin).toBeNull();

    input.dispatchEvent(new Event('input'));
    component.limitStatInput({ target: input } as unknown as Event, 'powerMin');

    expect(input.value).toBe('12');
    expect(component.model.powerMin).toBe(12);

    input.value = '9x8';
    component.limitStatInput({ target: input } as unknown as Event, 'toughnessMax');

    expect(input.value).toBe('98');
    expect(component.model.toughnessMax).toBe(98);
  });
});
