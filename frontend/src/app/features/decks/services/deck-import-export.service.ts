import { Injectable } from '@angular/core';
import { Deck, DeckSection } from '../../../core/models/deck.model';

export type DeckImportFormat = 'plain';

export interface DecklistEntry {
  quantity: number;
  name: string;
  section: DeckSection;
  setCode?: string;
  collectorNumber?: string;
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
    const sideboard = entries.filter((entry) => entry.section === 'sideboard');
    const maybeboard = entries.filter((entry) => entry.section === 'maybeboard');
    const lines: string[] = [];

    if (commanders.length > 0) {
      lines.push('Commander');
      lines.push(...commanders.map((entry) => this.backendLine(entry)));
      lines.push('');
    }

    lines.push('Deck');
    lines.push(...main.map((entry) => this.backendLine(entry)));

    if (sideboard.length > 0) {
      lines.push('');
      lines.push('Sideboard');
      lines.push(...sideboard.map((entry) => this.backendLine(entry)));
    }

    if (maybeboard.length > 0) {
      lines.push('');
      lines.push('Maybeboard');
      lines.push(...maybeboard.map((entry) => this.backendLine(entry)));
    }

    return lines.join('\n').trim();
  }

  async resolveMissingFlavorNames(entries: DecklistEntry[], missingNames: string[]): Promise<DecklistEntry[]> {
    void missingNames;

    return entries;
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
      if (['sideboard', 'side'].includes(header)) {
        section = 'sideboard';
        continue;
      }
      if (['maybeboard', 'maybe', 'considering'].includes(header)) {
        section = 'maybeboard';
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
    const rawName = match[2] ?? '';
    const metadata = this.extractPrintMetadata(rawName);
    const name = this.cleanName(rawName);

    return Number.isFinite(quantity) && quantity > 0 && name ? { quantity, name, section, ...metadata } : null;
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

  private extractPrintMetadata(name: string): Pick<DecklistEntry, 'setCode' | 'collectorNumber'> {
    const match = name.match(/\(([A-Z0-9]{2,8})\)\s+([^\s]+)/i);
    if (!match) {
      return {};
    }

    return {
      setCode: match[1]?.toLowerCase(),
      collectorNumber: match[2]?.replace(/[^\w.-]+$/u, ''),
    };
  }

  private backendLine(entry: DecklistEntry): string {
    const print = entry.setCode && entry.collectorNumber
      ? ` (${entry.setCode.toUpperCase()}) ${entry.collectorNumber}`
      : '';

    return `${entry.quantity} ${entry.name}${print}`;
  }
}
