import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule } from 'lucide-angular';
import { CardSearchFilters, CardSearchOption, CardSearchOptionsResponse } from '../../../../../core/api/cards.api';
import { RuntimeTranslatePipe } from '../../../../../core/localization/runtime-translate.pipe';
import { ManaIconComponent } from '../../../../../shared/mana/mana-icon/mana-icon.component';
import { ManaSymbolsComponent } from '../../../../../shared/mana/mana-symbols/mana-symbols.component';
import { TabListComponent, TabListItem } from '../../../../../shared/ui/tab-list/tab-list.component';
import { CompactCheckboxComponent } from '../../../../../shared/ui/compact-checkbox/compact-checkbox.component';
import { ToggleComponent } from '../../../../../shared/ui/toggle/toggle.component';
import { PrettyScrollDirective } from '../../../../../shared/ui/pretty-scroll/pretty-scroll.directive';
import { TextFitDirective } from '../../../../../shared/ui/text-fit/text-fit.directive';
import {
  CARD_COLOR_CHOICES,
  CARD_MANA_COST_SYMBOLS,
  CardAdvancedSearchFormValue,
  CardAdvancedSearchSubmit,
  CardColor,
  CardRarity,
  CardSearchFilterKey,
  CardSearchSort,
  createDefaultCardSearchFormValue,
} from '../../card-search.models';

const COLOR_ACCENT_RGB: Record<CardColor, string> = {
  W: '245 238 194',
  U: '68 164 220',
  B: '92 84 88',
  R: '222 86 54',
  G: '74 158 100',
};

const RARITY_ACCENT_RGB: Record<CardRarity, string> = {
  mythic: '237 88 22',
  rare: '218 173 50',
  uncommon: '174 184 195',
  common: '13 15 18',
};

const MANA_TYPE_ICONS = new Set([
  'artifact',
  'battle',
  'creature',
  'enchantment',
  'instant',
  'land',
  'planeswalker',
  'sorcery',
]);

type StatRangeField = 'powerMin' | 'powerMax' | 'toughnessMin' | 'toughnessMax';
const CARD_SEARCH_SORTS: readonly CardSearchSort[] = [
  'colors',
  'name_asc',
  'name_desc',
  'mana_value_asc',
  'mana_value_desc',
];

@Component({
  selector: 'app-card-advanced-search-form',
  imports: [
    FormsModule,
    LucideAngularModule,
    RuntimeTranslatePipe,
    ManaIconComponent,
    ManaSymbolsComponent,
    TabListComponent,
    CompactCheckboxComponent,
    ToggleComponent,
    PrettyScrollDirective,
    TextFitDirective,
  ],
  templateUrl: './card-advanced-search-form.component.html',
  styleUrl: './card-advanced-search-form.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CardAdvancedSearchFormComponent {
  private readonly defaultModel = createDefaultCardSearchFormValue();

  readonly options = input<CardSearchOptionsResponse | null>(null);
  readonly loadingOptions = input(false);
  readonly searchSubmitted = output<CardAdvancedSearchSubmit>();
  readonly cleared = output<void>();

  readonly colorChoices = CARD_COLOR_CHOICES;
  readonly manaCostSymbols = CARD_MANA_COST_SYMBOLS;
  readonly colorModeTabs: readonly TabListItem[] = [
    { id: 'any', label: 'deckBuilder.cards.cardSearch.form.colorModeAny' },
    { id: 'all', label: 'deckBuilder.cards.cardSearch.form.colorModeAll' },
    { id: 'exact', label: 'deckBuilder.cards.cardSearch.form.colorModeExact' },
  ];
  readonly filterOrder: readonly CardSearchFilterKey[] = ['name', 'text', 'types', 'subtypes', 'sets', 'rarities', 'colors', 'costs', 'stats', 'formats'];

  readonly setFilter = signal('');
  readonly subtypeFilter = signal('');
  readonly visibleSetOptions = computed(() => this.filteredOptions(this.options()?.sets ?? [], this.setFilter()));
  readonly visibleSubtypeOptions = computed(() => this.filteredOptions(this.options()?.subtypes ?? [], this.subtypeFilter()));

  model: CardAdvancedSearchFormValue = createDefaultCardSearchFormValue();

  submit(): void {
    if (!this.hasSearchCriteria()) {
      return;
    }

    const filters = this.toFilters();
    filters.sort = this.model.sort;

    this.searchSubmitted.emit({
      query: this.filterEnabled('name') ? this.model.query.trim() : '',
      filters,
      viewMode: this.model.viewMode,
    });
  }

  clear(): void {
    this.model = createDefaultCardSearchFormValue();
    this.setFilter.set('');
    this.subtypeFilter.set('');
    this.cleared.emit();
  }

  selectTextMode(value: string): void {
    if (value === 'and' || value === 'or') {
      this.model.oracleTextMode = value;
    }
  }

  setTextModeFromToggle(anyTextTerm: boolean): void {
    this.model.oracleTextMode = anyTextTerm ? 'or' : 'and';
  }

  textModeToggleLabel(): string {
    return this.model.oracleTextMode === 'or'
      ? 'deckBuilder.cards.cardSearch.form.textModeAny'
      : 'deckBuilder.cards.cardSearch.form.textModeAll';
  }

  textModeToggleDescription(): string {
    return this.model.oracleTextMode === 'or'
      ? 'deckBuilder.cards.cardSearch.form.textModeAnyDescription'
      : 'deckBuilder.cards.cardSearch.form.textModeAllDescription';
  }

  selectColorMode(value: string): void {
    if (value === 'all' || value === 'any' || value === 'exact') {
      this.model.colorMatchMode = value;
    }
  }

  selectViewMode(value: string): void {
    if (value === 'list' || value === 'spoiler') {
      this.model.viewMode = value;
    }
  }

  selectSort(value: string): void {
    if (CARD_SEARCH_SORTS.includes(value as CardSearchSort)) {
      this.model.sort = value as CardSearchSort;
    }
  }

  toggleType(code: string, checked: boolean): void {
    this.model.types = this.toggleString(this.model.types, code, checked);
    if (code === 'land' && !checked) {
      this.model.basic = false;
    }
  }

  toggleSubtype(code: string, checked: boolean): void {
    this.model.subtypes = this.toggleString(this.model.subtypes, code, checked);
  }

  toggleSet(code: string, checked: boolean): void {
    this.model.sets = this.toggleString(this.model.sets, code, checked);
  }

  toggleFormat(code: string, checked: boolean): void {
    this.model.formats = this.toggleString(this.model.formats, code, checked);
  }

  toggleRarity(code: string, checked: boolean): void {
    if (this.isRarity(code)) {
      this.model.rarities = this.toggleString(this.model.rarities, code, checked) as CardRarity[];
    }
  }

  toggleColor(code: string, checked: boolean): void {
    if (this.isColor(code)) {
      this.model.colors = this.toggleString(this.model.colors, code, checked) as CardColor[];
    }
  }

  selected(values: readonly string[], code: string): boolean {
    return values.includes(code);
  }

  landTypeSelected(): boolean {
    return this.selected(this.model.types, 'land');
  }

  colorAccentRgb(code: string): string | null {
    return this.isColor(code) ? COLOR_ACCENT_RGB[code] : null;
  }

  rarityAccentRgb(code: string): string | null {
    return this.isRarity(code) ? RARITY_ACCENT_RGB[code] : null;
  }

  typeIcon(code: string): string {
    const normalized = code.trim().toLowerCase();

    return MANA_TYPE_ICONS.has(normalized) ? normalized : 'multiple';
  }

  iconChoiceNeedsCompactLabel(label: string | null | undefined): boolean {
    return (label?.trim().length ?? 0) >= 10;
  }

  iconChoiceLabelFontSize(label: string | null | undefined): string {
    const baseSize = this.iconChoiceNeedsCompactLabel(label) ? '0.48rem' : '1em';

    return `calc(${baseSize} * var(--cz-text-fit-scale, 1))`;
  }

  manaCostSymbolValue(): string {
    const value = this.model.manaCost.trim();
    if (value === '' || value.includes('{')) {
      return value;
    }

    const compact = value.toUpperCase().replace(/\s+/g, '');
    const tokens = compact.match(/\d+|[WUBRGCXYZ](?:\/[WUBRGCXYZP])?|[WUBRGCXYZ]P/g);

    return tokens?.join('').length === compact.length
      ? tokens.map((token) => `{${token}}`).join('')
      : value;
  }

  addManaCostSymbol(symbol: string): void {
    this.model.manaCost = `${this.model.manaCost}${this.manaCostToken(symbol)}`;
  }

  clearManaCost(): void {
    this.model.manaCost = '';
    this.model.manaValueMin = null;
    this.model.manaValueMax = null;
  }

  hasManaCostState(): boolean {
    return this.model.manaCost.trim() !== ''
      || this.model.manaValueMin !== null
      || this.model.manaValueMax !== null;
  }

  syncTextAreaHeights(event: Event): void {
    const textarea = event.target;
    if (!(textarea instanceof HTMLTextAreaElement)) {
      return;
    }

    const group = textarea.closest('.text-grid');
    if (!group) {
      return;
    }

    const height = `${textarea.offsetHeight}px`;
    group.querySelectorAll('textarea').forEach((field) => {
      field.style.height = height;
    });
  }

  limitStatInput(event: Event, field: StatRangeField): void {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) {
      return;
    }

    const normalized = input.value.replace(/\D+/g, '').slice(0, 2);
    input.value = normalized;
    this.model[field] = normalized === '' ? null : Number(normalized);
  }

  filterEnabled(key: CardSearchFilterKey): boolean {
    return this.model.enabledFilters[key];
  }

  setFilterEnabled(key: CardSearchFilterKey, enabled: boolean): void {
    this.model.enabledFilters = {
      ...this.model.enabledFilters,
      [key]: enabled,
    };
  }

  activeFilterCount(): number {
    return this.filterOrder.filter((key) => this.model.enabledFilters[key]).length;
  }

  hasSearchCriteria(): boolean {
    return (this.filterEnabled('name') && this.model.query.trim() !== '')
      || Object.keys(this.toFilters()).length > 0;
  }

  hasClearableState(): boolean {
    return this.model.query.trim() !== ''
      || this.model.oracleTextA.trim() !== ''
      || this.model.oracleTextB.trim() !== ''
      || this.model.manaCost.trim() !== ''
      || this.setFilter().trim() !== ''
      || this.subtypeFilter().trim() !== ''
      || this.model.viewMode !== this.defaultModel.viewMode
      || this.model.sort !== this.defaultModel.sort
      || this.model.oracleTextMode !== this.defaultModel.oracleTextMode
      || this.model.colorMatchMode !== this.defaultModel.colorMatchMode
      || this.model.manaValueMin !== null
      || this.model.manaValueMax !== null
      || this.model.powerMin !== null
      || this.model.powerMax !== null
      || this.model.toughnessMin !== null
      || this.model.toughnessMax !== null
      || this.model.types.length > 0
      || this.model.subtypes.length > 0
      || this.model.sets.length > 0
      || this.model.rarities.length > 0
      || this.model.colors.length > 0
      || this.model.formats.length > 0
      || this.model.artifact
      || this.model.multicolor
      || this.model.land
      || this.model.basic
      || this.model.legendary
      || this.model.includeVariablePower !== this.defaultModel.includeVariablePower
      || this.model.includeVariableToughness !== this.defaultModel.includeVariableToughness
      || this.filterOrder.some((key) => this.model.enabledFilters[key] !== this.defaultModel.enabledFilters[key]);
  }

  toFilters(): CardSearchFilters {
    const filters: CardSearchFilters = {};
    if (this.filterEnabled('text')) {
      this.assignString(filters, 'oracleTextA', this.model.oracleTextA);
      this.assignString(filters, 'oracleTextB', this.model.oracleTextB);
    }
    if (this.filterEnabled('text') && (filters.oracleTextA || filters.oracleTextB)) {
      filters.oracleTextMode = this.model.oracleTextMode;
    }

    if (this.filterEnabled('types')) {
      this.assignList(filters, 'types', this.model.types);
      this.assignBoolean(filters, 'basic', this.model.basic && this.landTypeSelected());
      this.assignBoolean(filters, 'legendary', this.model.legendary);
    }
    if (this.filterEnabled('subtypes')) {
      this.assignList(filters, 'subtypes', this.model.subtypes);
    }
    if (this.filterEnabled('sets')) {
      this.assignList(filters, 'sets', this.model.sets);
    }
    if (this.filterEnabled('rarities')) {
      this.assignList(filters, 'rarities', this.model.rarities);
    }
    if (this.filterEnabled('colors')) {
      this.assignList(filters, 'colors', this.model.colors);
      if (this.model.colors.length > 0) {
        filters.colorMatchMode = this.model.colorMatchMode;
      }
      this.assignBoolean(filters, 'artifact', this.model.artifact);
      this.assignBoolean(filters, 'multicolor', this.model.multicolor);
      this.assignBoolean(filters, 'land', this.model.land);
    }
    if (this.filterEnabled('costs')) {
      this.assignNumber(filters, 'manaValueMin', this.model.manaValueMin);
      this.assignNumber(filters, 'manaValueMax', this.model.manaValueMax);
      this.assignString(filters, 'manaCost', this.model.manaCost);
    }
    if (this.filterEnabled('stats')) {
      const hasPowerRange = this.hasNumber(this.model.powerMin) || this.hasNumber(this.model.powerMax);
      const hasToughnessRange = this.hasNumber(this.model.toughnessMin) || this.hasNumber(this.model.toughnessMax);
      this.assignNumber(filters, 'powerMin', this.model.powerMin);
      this.assignNumber(filters, 'powerMax', this.model.powerMax);
      this.assignNumber(filters, 'toughnessMin', this.model.toughnessMin);
      this.assignNumber(filters, 'toughnessMax', this.model.toughnessMax);
      if (hasPowerRange) {
        this.assignBoolean(filters, 'includeVariablePower', this.model.includeVariablePower);
      }
      if (hasToughnessRange) {
        this.assignBoolean(filters, 'includeVariableToughness', this.model.includeVariableToughness);
      }
    }
    if (this.filterEnabled('formats')) {
      this.assignList(filters, 'formats', this.model.formats);
    }

    return filters;
  }

  private filteredOptions(options: readonly CardSearchOption[], filter: string): readonly CardSearchOption[] {
    const normalizedFilter = this.normalizeSearchText(filter);
    const filtered = normalizedFilter
      ? options.filter((option) => this.optionMatchesFilter(option, normalizedFilter))
      : options;

    return filtered;
  }

  private optionMatchesFilter(option: CardSearchOption, normalizedFilter: string): boolean {
    return this.normalizeSearchText(option.code).includes(normalizedFilter)
      || this.normalizeSearchText(option.name).includes(normalizedFilter)
      || (option.aliases ?? []).some((alias) => this.normalizeSearchText(alias).includes(normalizedFilter));
  }

  private normalizeSearchText(value: string): string {
    return value
      .trim()
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase();
  }

  private toggleString(values: readonly string[], code: string, checked: boolean): string[] {
    if (checked) {
      return values.includes(code) ? [...values] : [...values, code];
    }

    return values.filter((value) => value !== code);
  }

  private isColor(code: string): code is CardColor {
    return ['W', 'U', 'B', 'R', 'G'].includes(code);
  }

  private isRarity(code: string): code is CardRarity {
    return ['mythic', 'rare', 'uncommon', 'common'].includes(code);
  }

  private manaCostToken(symbol: string): string {
    return `{${symbol.trim().toUpperCase()}}`;
  }

  private assignString<K extends keyof CardSearchFilters>(filters: CardSearchFilters, key: K, value: string): void {
    const trimmed = value.trim();
    if (trimmed) {
      (filters[key] as string | undefined) = trimmed;
    }
  }

  private assignNumber<K extends keyof CardSearchFilters>(filters: CardSearchFilters, key: K, value: number | null): void {
    if (this.hasNumber(value)) {
      (filters[key] as number | undefined) = Math.min(value, 99);
    }
  }

  private hasNumber(value: number | null): value is number {
    return typeof value === 'number' && Number.isFinite(value);
  }

  private assignBoolean<K extends keyof CardSearchFilters>(filters: CardSearchFilters, key: K, value: boolean): void {
    if (value) {
      (filters[key] as boolean | undefined) = true;
    }
  }

  private assignList<K extends keyof CardSearchFilters>(filters: CardSearchFilters, key: K, values: readonly string[]): void {
    if (values.length > 0) {
      (filters[key] as string[] | undefined) = [...values];
    }
  }
}
