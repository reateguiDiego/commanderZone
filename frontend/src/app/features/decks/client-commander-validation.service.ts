import { Injectable } from '@angular/core';
import { Deck, DeckCard } from '../../core/models/deck.model';

export type ClientCommanderIssueSeverity = 'error' | 'warning';

export interface ClientCommanderIssue {
  severity: ClientCommanderIssueSeverity;
  title: string;
  detail: string;
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
      ...this.layoutWarnings(deck),
    ];
  }

  private commanderIssues(deck: Deck): ClientCommanderIssue[] {
    const commanders = this.commanders(deck);
    const issues: ClientCommanderIssue[] = [];

    if (commanders.length > 2) {
      issues.push({
        severity: 'error',
        title: 'Too many commanders',
        detail: 'Commander decks can use one commander, or a legal two-card pairing.',
        cards: commanders.map((entry) => entry.card.name),
      });
    }

    if (commanders.length === 2 && !this.looksLikeLegalPair(commanders)) {
      issues.push({
        severity: 'warning',
        title: 'Commander pair needs review',
        detail: 'The pair does not expose obvious partner/background wording in the available oracle text.',
        cards: commanders.map((entry) => entry.card.name),
      });
    }

    return issues;
  }

  private legalityIssues(deck: Deck): ClientCommanderIssue[] {
    return (deck.cards ?? [])
      .filter((entry) => !entry.card.commanderLegal || ['banned', 'not_legal'].includes(entry.card.legalities['commander'] ?? ''))
      .map((entry) => ({
        severity: 'error' as const,
        title: 'Commander legality issue',
        detail: `${entry.card.name} is marked as ${entry.card.legalities['commander'] ?? 'not legal'} in Commander.`,
        cards: [entry.card.name],
      }));
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
          title: 'Singleton violation',
          detail: `${entry.card.name} appears ${entry.quantity} times in the main deck.`,
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
        title: 'Color identity issue',
        detail: `${entry.card.name} includes colors outside the command zone identity.`,
        cards: [entry.card.name],
      }));
  }

  private layoutWarnings(deck: Deck): ClientCommanderIssue[] {
    return (deck.cards ?? [])
      .filter((entry) => /modal_dfc|transform|meld/i.test(entry.card.layout) || entry.card.name.includes('//'))
      .map((entry) => ({
        severity: 'warning' as const,
        title: 'MDFC/layout review',
        detail: `${entry.card.name} uses ${entry.card.layout}; verify the face and color identity behavior.`,
        cards: [entry.card.name],
      }));
  }

  private commanders(deck: Deck): DeckCard[] {
    return (deck.cards ?? []).filter((entry) => entry.section === 'commander');
  }

  private looksLikeLegalPair(commanders: DeckCard[]): boolean {
    const texts = commanders.map((entry) => `${entry.card.typeLine ?? ''}\n${entry.card.oracleText ?? ''}`.toLowerCase());
    const partnerCount = texts.filter((text) => text.includes('partner')).length;
    const hasChooseBackground = texts.some((text) => text.includes('choose a background'));
    const hasBackground = texts.some((text) => text.includes('background'));

    return partnerCount === 2 || (hasChooseBackground && hasBackground);
  }

  private isBasicLand(entry: DeckCard): boolean {
    return /basic/i.test(entry.card.typeLine ?? '') && /land/i.test(entry.card.typeLine ?? '');
  }
}
