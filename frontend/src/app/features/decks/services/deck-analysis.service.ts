import { Injectable, inject } from '@angular/core';
import { Deck, DeckCard } from '../../../core/models/deck.model';
import { LandTypeCount, ManaSymbolService } from '../../../shared/mana/mana-symbol.service';

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
  readonly colors: ManaColor[] = ['W', 'U', 'B', 'R', 'G', 'C'];

  empty(): DeckAnalysis {
    const symbolsByColor = Object.fromEntries(this.colors.map((color) => [color, {
      color,
      symbolCount: 0,
      percentageOfColoredSymbols: 0,
      percentageOfAllSymbols: 0,
      cardsRequiringColor: 0,
    }])) as DeckAnalysis['colorRequirement']['symbolsByColor'];
    const productionByColor = Object.fromEntries(this.colors.map((color) => [color, {
      color,
      sourceCount: 0,
      symbolCount: 0,
      percentageOfAllProduction: 0,
      percentageFromLands: 0,
      landSourceCount: 0,
      nonLandSourceCount: 0,
    }])) as DeckAnalysis['manaProduction']['productionByColor'];

    return {
      summary: {
        totalCards: 0,
        mainboardCards: 0,
        commanderCards: 0,
        landCount: 0,
        nonLandCount: 0,
        creatureCount: 0,
        instantCount: 0,
        sorceryCount: 0,
        artifactCount: 0,
        enchantmentCount: 0,
        planeswalkerCount: 0,
        battleCount: 0,
        averageManaValueWithLands: 0,
        averageManaValueWithoutLands: 0,
        medianManaValueWithLands: 0,
        medianManaValueWithoutLands: 0,
        totalManaValue: 0,
        colorIdentity: [],
      },
      manaCurve: {
        buckets: Array.from({ length: 8 }, (_, manaValue) => ({ manaValue, totalCards: 0, permanents: 0, spells: 0, lands: 0, cards: [] })),
      },
      typeBreakdown: { sections: [] },
      colorRequirement: { totalColoredSymbols: 0, totalAllSymbols: 0, estimated: false, symbolsByColor },
      manaProduction: { totalManaSources: 0, totalProducedSymbols: 0, estimated: false, productionByColor },
      colorBalance: { colors: [] },
      curvePlayability: {
        disclaimer: 'This is an approximate probability based on hypergeometric distribution and simplified mana source assumptions.',
        buckets: [],
      },
      sections: [],
      options: {
        includeCommanderInAnalysis: true,
        includeSideboard: false,
        includeMaybeboard: false,
        curvePlayabilityMode: 'play',
        manaSourcesMode: 'landsOnly',
      },
    };
  }
}
