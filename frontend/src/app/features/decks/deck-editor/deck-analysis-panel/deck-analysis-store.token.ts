import { InjectionToken, Signal } from '@angular/core';
import { Card } from '../../../../core/models/card.model';
import { HoverListState, OpeningHandCard, CardPreviewState } from '../../models/deck-editor.models';
import { DeckAnalysis } from '../../services/deck-analysis.service';

export interface DeckAnalysisMetric {
  readonly label: string;
  readonly count: number;
  readonly cards: readonly string[];
}

export interface DeckAnalysisManaSourceProfile {
  readonly color: 'W' | 'U' | 'B' | 'R' | 'G' | 'C';
  readonly label: string;
  readonly demandCount: number;
  readonly demandPercent: number;
  readonly sourceCount: number;
  readonly sourcePercent: number;
}

export interface DeckAnalysisStore {
  readonly analysis: Signal<DeckAnalysis>;
  readonly visibleTypeMetrics: Signal<readonly DeckAnalysisMetric[]>;
  readonly visibleUtilityMetrics: Signal<readonly DeckAnalysisMetric[]>;
  readonly manaSourceProfiles: Signal<readonly DeckAnalysisManaSourceProfile[]>;
  readonly manaSourceTotal: Signal<number>;
  readonly manaSourceDonutBackground: Signal<string>;
  readonly openingHand: Signal<OpeningHandCard[]>;
  readonly hoverList: Signal<HoverListState | null>;
  readonly cardPreview: Signal<CardPreviewState | null>;
  curveTotalHeight(total: number): number;
  curvePermanentShare(permanents: number, total: number): string;
  curveManaValueLabel(manaValue: number): string;
  showHoverList(event: MouseEvent, title: string, items: readonly string[]): void;
  showCurveHoverList(event: MouseEvent, manaValue: number): void;
  moveHoverList(event: MouseEvent): void;
  hideHoverList(): void;
  drawOpeningHand(): void;
  showCardPreview(event: MouseEvent, card: Card): void;
  moveCardPreview(event: MouseEvent): void;
  hideCardPreview(): void;
  displayCardName(card: Card): string;
  imageUrl(card: Card): string | null;
}

export const DECK_ANALYSIS_STORE = new InjectionToken<DeckAnalysisStore>('DECK_ANALYSIS_STORE');
