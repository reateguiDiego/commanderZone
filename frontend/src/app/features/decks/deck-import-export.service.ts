import { Injectable } from '@angular/core';
import { Deck, DeckSection } from '../../core/models/deck.model';

export type DeckImportFormat = 'plain';

export interface DecklistEntry {
  quantity: number;
  name: string;
  section: DeckSection;
}

@Injectable({ providedIn: 'root' })
export class DeckImportExportService {
  parse(text: string, format: DeckImportFormat): DecklistEntry[] {
    return this.parseTextList(text);
  }

  normalizeForBackend(text: string, format: DeckImportFormat): string {
    return this.toBackendDecklist(this.parse(text, format));
  }

  toBackendDecklist(entries: DecklistEntry[]): string {
    const commanders = entries.filter((entry) => entry.section === 'commander');
    const main = entries.filter((entry) => entry.section === 'main');
    const lines: string[] = [];

    if (commanders.length > 0) {
      lines.push('Commander');
      lines.push(...commanders.map((entry) => `${entry.quantity} ${entry.name}`));
      lines.push('');
    }

    lines.push('Deck');
    lines.push(...main.map((entry) => `${entry.quantity} ${entry.name}`));

    return lines.join('\n').trim();
  }

  entriesFromDeck(deck: Deck): DecklistEntry[] {
    return (deck.cards ?? []).map((entry) => ({
      quantity: entry.quantity,
      name: entry.card.name,
      section: entry.section,
    }));
  }

  private parseTextList(text: string): DecklistEntry[] {
    let section: DeckSection = 'main';
    const entries: DecklistEntry[] = [];

    for (const rawLine of text.split(/\r?\n/)) {
      const line = this.cleanLine(rawLine);
      if (!line) {
        continue;
      }

      const header = line.toLowerCase().replace(/:$/, '');
      if (['commander', 'commanders', 'command zone'].includes(header)) {
        section = 'commander';
        continue;
      }
      if (['deck', 'main', 'maindeck', 'mainboard'].includes(header)) {
        section = 'main';
        continue;
      }
      const parsed = this.parseDeckLine(line, section);
      if (parsed) {
        entries.push(parsed);
      }
    }

    return entries;
  }

  private parseDeckLine(line: string, section: DeckSection): DecklistEntry | null {
    const match = line.match(/^(?:(\d+)x?\s+)?(.+)$/i);
    if (!match) {
      return null;
    }

    const quantity = match[1] ? Number.parseInt(match[1], 10) : 1;
    const name = this.cleanName(match[2] ?? '');

    return Number.isFinite(quantity) && quantity > 0 && name ? { quantity, name, section } : null;
  }

  private cleanLine(line: string): string {
    const trimmed = line.trim();

    return trimmed.startsWith('//') ? '' : trimmed;
  }

  private cleanName(name: string): string {
    return name
      .replace(/\s+\*[A-Z]\*\s*$/i, '')
      .replace(/\s*[★☆]\s*$/, '')
      .replace(/\s+\([A-Z0-9]{2,8}\)\s+.+$/i, '')
      .replace(/\s+\/\s+/g, ' // ')
      .replace(/\s*\[[^\]]+\]\s*$/, '')
      .replace(/\s+#\d+\s*$/, '')
      .trim();
  }

}
