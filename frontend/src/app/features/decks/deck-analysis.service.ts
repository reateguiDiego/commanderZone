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
  count: number;
}

export interface DeckAnalysis {
  totalCards: number;
  landCount: number;
  nonlandCount: number;
  colorPips: Record<string, number>;
  landTypes: LandTypeCount[];
  manaCurve: ManaCurveBucket[];
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
    const cards = deck?.cards ?? [];
    const expanded = this.expand(cards);
    const nonlands = expanded.filter((entry) => !this.isLand(entry));

    return {
      totalCards: expanded.length,
      landCount: expanded.length - nonlands.length,
      nonlandCount: nonlands.length,
      colorPips: this.countPips(nonlands),
      landTypes: this.manaSymbols.landTypeCounts(expanded.map((entry) => entry.card.typeLine)),
      manaCurve: this.curve(nonlands),
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
    const buckets = new Map<number, number>();

    for (const entry of cards) {
      const value = Math.min(this.manaValue(entry.card.manaCost), 7);
      buckets.set(value, (buckets.get(value) ?? 0) + 1);
    }

    return Array.from({ length: 8 }, (_, manaValue) => ({
      manaValue,
      count: buckets.get(manaValue) ?? 0,
    }));
  }

  private countPips(cards: DeckCard[]): Record<string, number> {
    const pips: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 };

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
