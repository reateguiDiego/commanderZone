import { Injectable } from '@angular/core';
import { Deck, DeckCard } from '../../../core/models/deck.model';
import { resolvedDeckCardTypeLine } from '../utils/deck-card-type-line';

export type ClientCommanderIssueSeverity = 'error' | 'warning';

export interface ClientCommanderIssue {
  severity: ClientCommanderIssueSeverity;
  titleKey: string;
  detailKey: string;
  detailParams?: Readonly<Record<string, string | number>>;
  cards: string[];
}

@Injectable({ providedIn: 'root' })
export class ClientCommanderValidationService {
  validate(deck: Deck | null): ClientCommanderIssue[] {
    if (!deck) {
      return [];
    }

    return [
      ...this.commanderIssues(deck),
      ...this.legalityIssues(deck),
      ...this.singletonIssues(deck),
      ...this.colorIdentityIssues(deck),
    ];
  }

  private commanderIssues(deck: Deck): ClientCommanderIssue[] {
    const commanders = this.commanders(deck);
    const issues: ClientCommanderIssue[] = [];

    if (commanders.length > 2) {
      issues.push({
        severity: 'error',
        titleKey: 'deckBuilder.clientCommanderValidation.tooManyCommanders.title',
        detailKey: 'deckBuilder.clientCommanderValidation.tooManyCommanders.detail',
        cards: commanders.map((entry) => entry.card.name),
      });
    }

    if (commanders.length === 2 && !this.looksLikeLegalPair(commanders)) {
      issues.push({
        severity: 'warning',
        titleKey: 'deckBuilder.clientCommanderValidation.commanderPairNeedsReview.title',
        detailKey: 'deckBuilder.clientCommanderValidation.commanderPairNeedsReview.detail',
        cards: commanders.map((entry) => entry.card.name),
      });
    }

    return issues;
  }

  private legalityIssues(deck: Deck): ClientCommanderIssue[] {
    return (deck.cards ?? [])
      .filter((entry) => this.isPlayable(entry))
      .filter((entry) => !entry.card.commanderLegal || ['banned', 'not_legal'].includes(entry.card.legalities['commander'] ?? ''))
      .map((entry) => {
        const status = entry.card.legalities['commander'];
        const isBanned = status === 'banned';

        return {
          severity: 'error' as const,
          titleKey: 'deckBuilder.clientCommanderValidation.commanderLegalityIssue.title',
          detailKey: isBanned
            ? 'deckBuilder.clientCommanderValidation.commanderLegalityIssue.bannedDetail'
            : 'deckBuilder.clientCommanderValidation.commanderLegalityIssue.notLegalDetail',
          detailParams: { card: entry.card.name },
          cards: [entry.card.name],
        };
      });
  }

  private singletonIssues(deck: Deck): ClientCommanderIssue[] {
    const byName = new Map<string, DeckCard>();
    const issues: ClientCommanderIssue[] = [];

    for (const entry of deck.cards ?? []) {
      if (entry.section !== 'main' || this.isBasicLand(entry)) {
        continue;
      }

      const key = entry.card.name.toLowerCase();
      const current = byName.get(key);
      const quantity = (current?.quantity ?? 0) + entry.quantity;
      byName.set(key, { ...entry, quantity });
    }

    for (const entry of byName.values()) {
      if (entry.quantity > 1) {
        issues.push({
          severity: 'error',
          titleKey: 'deckBuilder.clientCommanderValidation.singletonViolation.title',
          detailKey: 'deckBuilder.clientCommanderValidation.singletonViolation.detail',
          detailParams: { card: entry.card.name, quantity: entry.quantity },
          cards: [entry.card.name],
        });
      }
    }

    return issues;
  }

  private colorIdentityIssues(deck: Deck): ClientCommanderIssue[] {
    const commanders = this.commanders(deck);
    if (commanders.length === 0) {
      return [];
    }

    const allowed = new Set(commanders.flatMap((entry) => entry.card.colorIdentity));

    return (deck.cards ?? [])
      .filter((entry) => entry.section === 'main' && entry.card.colorIdentity.some((color) => !allowed.has(color)))
      .map((entry) => ({
        severity: 'error' as const,
        titleKey: 'deckBuilder.clientCommanderValidation.colorIdentityIssue.title',
        detailKey: 'deckBuilder.clientCommanderValidation.colorIdentityIssue.detail',
        detailParams: { card: entry.card.name },
        cards: [entry.card.name],
      }));
  }

  private commanders(deck: Deck): DeckCard[] {
    return (deck.cards ?? []).filter((entry) => entry.section === 'commander');
  }

  private isPlayable(entry: DeckCard): boolean {
    return entry.section === 'commander' || entry.section === 'main';
  }

  private looksLikeLegalPair(commanders: DeckCard[]): boolean {
    const texts = commanders.map((entry) => `${resolvedDeckCardTypeLine(entry)}\n${entry.card.oracleText ?? ''}`.toLowerCase());
    const partnerCount = texts.filter((text) => text.includes('partner')).length;
    const hasChooseBackground = texts.some((text) => text.includes('choose a background'));
    const hasBackground = texts.some((text) => text.includes('background'));

    return partnerCount === 2 || (hasChooseBackground && hasBackground);
  }

  private isBasicLand(entry: DeckCard): boolean {
    const typeLine = resolvedDeckCardTypeLine(entry);

    return /basic/i.test(typeLine) && /land/i.test(typeLine);
  }
}
