import { Injectable, inject } from '@angular/core';
import { Deck } from '../../core/models/deck.model';
import { DeckImportExportService, DecklistEntry } from './deck-import-export.service';

const MAX_HISTORY = 25;
const STORAGE_PREFIX = 'commanderzone.deck-history.';

export interface DeckDiffSummary {
  added: string[];
  removed: string[];
  changed: string[];
}

export interface DeckHistoryEntry {
  id: string;
  deckId: string;
  deckName: string;
  createdAt: string;
  source: string;
  totalCards: number;
  commanders: string[];
  decklist: string;
  diff: DeckDiffSummary;
}

@Injectable({ providedIn: 'root' })
export class DeckHistoryStore {
  private readonly importExport = inject(DeckImportExportService);

  list(deckId: string): DeckHistoryEntry[] {
    return this.read(deckId);
  }

  record(deck: Deck, source: string): DeckHistoryEntry {
    const existing = this.read(deck.id);
    const entries = this.importExport.entriesFromDeck(deck);
    const entry: DeckHistoryEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      deckId: deck.id,
      deckName: deck.name,
      createdAt: new Date().toISOString(),
      source,
      totalCards: entries.reduce((total, card) => total + card.quantity, 0),
      commanders: entries.filter((card) => card.section === 'commander').map((card) => card.name),
      decklist: this.importExport.toBackendDecklist(entries),
      diff: this.diff(existing[0]?.decklist ?? '', entries),
    };
    const next = [entry, ...existing].slice(0, MAX_HISTORY);

    localStorage.setItem(this.key(deck.id), JSON.stringify(next));

    return entry;
  }

  clear(deckId: string): void {
    localStorage.removeItem(this.key(deckId));
  }

  private read(deckId: string): DeckHistoryEntry[] {
    const raw = localStorage.getItem(this.key(deckId));
    if (!raw) {
      return [];
    }

    try {
      const parsed: unknown = JSON.parse(raw);

      return Array.isArray(parsed) ? parsed.filter((entry): entry is DeckHistoryEntry => this.isEntry(entry)) : [];
    } catch {
      localStorage.removeItem(this.key(deckId));

      return [];
    }
  }

  private diff(previousDecklist: string, current: DecklistEntry[]): DeckDiffSummary {
    const previous = this.mapEntries(this.importExport.parse(previousDecklist, 'plain'));
    const next = this.mapEntries(current);
    const added: string[] = [];
    const removed: string[] = [];
    const changed: string[] = [];

    for (const [name, quantity] of next) {
      if (!previous.has(name)) {
        added.push(name);
      } else if (previous.get(name) !== quantity) {
        changed.push(name);
      }
    }

    for (const name of previous.keys()) {
      if (!next.has(name)) {
        removed.push(name);
      }
    }

    return { added, removed, changed };
  }

  private mapEntries(entries: DecklistEntry[]): Map<string, number> {
    const map = new Map<string, number>();

    for (const entry of entries) {
      const key = `${entry.section}:${entry.name.toLowerCase()}`;
      map.set(key, (map.get(key) ?? 0) + entry.quantity);
    }

    return map;
  }

  private isEntry(entry: unknown): entry is DeckHistoryEntry {
    return typeof entry === 'object'
      && entry !== null
      && typeof (entry as DeckHistoryEntry).id === 'string'
      && typeof (entry as DeckHistoryEntry).decklist === 'string';
  }

  private key(deckId: string): string {
    return `${STORAGE_PREFIX}${deckId}`;
  }
}
