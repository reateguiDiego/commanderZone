import { Injectable, inject } from '@angular/core';
import { Deck, DeckCard } from '../../core/models/deck.model';
import { LandTypeCount, ManaSymbolService } from '../../shared/mana/mana-symbol.service';

export interface DeckMetric {
  label: string;
  count: number;
  cards: string[];
}

export interface ManaCurveBucket {
  manaValue: number;
  permanents: number;
  spells: number;
  total: number;
}

export interface ColorProfileEntry {
  color: 'W' | 'U' | 'B' | 'R' | 'G' | 'C';
  count: number;
  percent: number;
}

export interface DeckAnalysis {
  mainDeckCards: number;
  landCount: number;
  averageManaValue: number;
  averageManaValueWithLands: number;
  medianManaValue: number;
  medianManaValueWithLands: number;
  totalManaValue: number;
  colorPips: Record<string, number>;
  colorProfiles: ColorProfileEntry[];
  landTypes: LandTypeCount[];
  manaCurve: ManaCurveBucket[];
  lands: DeckMetric;
  creatures: DeckMetric;
  artifacts: DeckMetric;
  enchantments: DeckMetric;
  instants: DeckMetric;
  sorceries: DeckMetric;
  planeswalkers: DeckMetric;
  ramp: DeckMetric;
  draw: DeckMetric;
  removal: DeckMetric;
  wipes: DeckMetric;
}

@Injectable({ providedIn: 'root' })
export class DeckAnalysisService {
  private readonly manaSymbols = inject(ManaSymbolService);

  analyze(deck: Deck | null): DeckAnalysis {
    const cards = (deck?.cards ?? []).filter((entry) => entry.section === 'commander' || entry.section === 'main');
    const expanded = this.expand(cards);
    const nonlands = expanded.filter((entry) => !this.isLand(entry));
    const allManaValues = expanded.map((entry) => this.manaValue(entry.card.manaCost));
    const nonlandManaValues = nonlands.map((entry) => this.manaValue(entry.card.manaCost));
    const colorPips = this.countPips(nonlands);

    return {
      mainDeckCards: expanded.length,
      landCount: expanded.length - nonlands.length,
      averageManaValue: this.averageFromValues(nonlandManaValues),
      averageManaValueWithLands: this.averageFromValues(allManaValues),
      medianManaValue: this.medianManaValue(nonlandManaValues),
      medianManaValueWithLands: this.medianManaValue(allManaValues),
      totalManaValue: nonlandManaValues.reduce((total, value) => total + value, 0),
      colorPips,
      colorProfiles: this.colorProfiles(colorPips),
      landTypes: this.manaSymbols.landTypeCounts(expanded.map((entry) => entry.card.typeLine)),
      manaCurve: this.curve(nonlands),
      lands: this.metric('Lands', expanded, (entry) => this.isLand(entry)),
      creatures: this.metric('Creatures', expanded, (entry) => this.hasType(entry, 'creature')),
      artifacts: this.metric('Artifacts', expanded, (entry) => this.hasType(entry, 'artifact')),
      enchantments: this.metric('Enchantments', expanded, (entry) => this.hasType(entry, 'enchantment')),
      instants: this.metric('Instants', expanded, (entry) => this.hasType(entry, 'instant')),
      sorceries: this.metric('Sorceries', expanded, (entry) => this.hasType(entry, 'sorcery')),
      planeswalkers: this.metric('Planeswalkers', expanded, (entry) => this.hasType(entry, 'planeswalker')),
      ramp: this.metric('Ramp', nonlands, (entry) => this.isRamp(entry)),
      draw: this.metric('Card draw', nonlands, (entry) => this.isDraw(entry)),
      removal: this.metric('Spot removal', nonlands, (entry) => this.isRemoval(entry)),
      wipes: this.metric('Board wipes', nonlands, (entry) => this.isWipe(entry)),
    };
  }

  private expand(cards: DeckCard[]): DeckCard[] {
    return cards.flatMap((entry) => Array.from({ length: entry.quantity }, () => entry));
  }

  private curve(cards: DeckCard[]): ManaCurveBucket[] {
    const buckets = new Map<number, { permanents: number; spells: number }>();

    for (const entry of cards) {
      const value = Math.min(this.manaValue(entry.card.manaCost), 7);
      const current = buckets.get(value) ?? { permanents: 0, spells: 0 };
      if (this.isSpell(entry)) {
        current.spells += 1;
      } else {
        current.permanents += 1;
      }
      buckets.set(value, current);
    }

    return Array.from({ length: 8 }, (_, manaValue) => ({
      manaValue,
      permanents: buckets.get(manaValue)?.permanents ?? 0,
      spells: buckets.get(manaValue)?.spells ?? 0,
      total: (buckets.get(manaValue)?.permanents ?? 0) + (buckets.get(manaValue)?.spells ?? 0),
    }));
  }

  private countPips(cards: DeckCard[]): Record<string, number> {
    const pips: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };

    for (const entry of cards) {
      for (const symbol of entry.card.manaCost?.match(/\{[^}]+\}/g) ?? []) {
        for (const color of Object.keys(pips)) {
          if (symbol.includes(color)) {
            pips[color] += 1;
          }
        }
      }
    }

    return pips;
  }

  private manaValue(cost: string | null): number {
    if (!cost) {
      return 0;
    }

    return (cost.match(/\{[^}]+\}/g) ?? []).reduce((total, symbol) => {
      const value = symbol.slice(1, -1);
      const numeric = Number.parseInt(value, 10);

      if (Number.isFinite(numeric)) {
        return total + numeric;
      }

      return value === 'X' ? total : total + 1;
    }, 0);
  }

  private averageFromValues(values: number[]): number {
    if (values.length === 0) {
      return 0;
    }

    const total = values.reduce((sum, value) => sum + value, 0);

    return Math.round((total / values.length) * 100) / 100;
  }

  private medianManaValue(values: number[]): number {
    if (values.length === 0) {
      return 0;
    }

    const sorted = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) {
      return Math.round(((sorted[middle - 1] + sorted[middle]) / 2) * 100) / 100;
    }

    return sorted[middle];
  }

  private colorProfiles(colorPips: Record<string, number>): ColorProfileEntry[] {
    const entries = (['W', 'U', 'B', 'R', 'G', 'C'] as const).map((color) => ({
      color,
      count: colorPips[color] ?? 0,
    }));
    const total = entries.reduce((sum, entry) => sum + entry.count, 0);

    return entries.map((entry) => ({
      ...entry,
      percent: total > 0 ? Math.round((entry.count / total) * 100) : 0,
    }));
  }

  private metric(label: string, cards: DeckCard[], predicate: (entry: DeckCard) => boolean): DeckMetric {
    const names = new Set<string>();
    let count = 0;

    for (const entry of cards) {
      if (predicate(entry)) {
        count += 1;
        names.add(entry.card.name);
      }
    }

    return { label, count, cards: Array.from(names).sort((a, b) => a.localeCompare(b)) };
  }

  private isLand(entry: DeckCard): boolean {
    return /(^|\s)land(\s|$)/i.test(entry.card.typeLine ?? '');
  }

  private hasType(entry: DeckCard, type: string): boolean {
    return new RegExp(`(^|\\s)${type}(\\s|$)`, 'i').test(entry.card.typeLine ?? '');
  }

  private isSpell(entry: DeckCard): boolean {
    return this.hasType(entry, 'instant') || this.hasType(entry, 'sorcery');
  }

  private text(entry: DeckCard): string {
    return `${entry.card.typeLine ?? ''}\n${entry.card.oracleText ?? ''}`.toLowerCase();
  }

  private isRamp(entry: DeckCard): boolean {
    const text = this.text(entry);

    return /add (one|two|three|[wubrgc]|\{[wubrgc]\})/.test(text)
      || /search your library for (a |up to .* )?basic land/.test(text)
      || /put .* land .* onto the battlefield/.test(text)
      || /treasure token/.test(text);
  }

  private isDraw(entry: DeckCard): boolean {
    return /draw (a|one|two|three|\d+) cards?/.test(this.text(entry));
  }

  private isRemoval(entry: DeckCard): boolean {
    const text = this.text(entry);

    return /(destroy|exile|return target|counter target|deals? .* damage to target)/.test(text)
      && /target/.test(text);
  }

  private isWipe(entry: DeckCard): boolean {
    return /(destroy|exile|return) all /.test(this.text(entry))
      || /each creature/.test(this.text(entry));
  }
}
