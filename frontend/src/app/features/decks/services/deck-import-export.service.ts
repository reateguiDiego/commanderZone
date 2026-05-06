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

      const nextSection = this.parseSectionHeader(line);
      if (nextSection) {
        section = nextSection;
        continue;
      }

      const scoped = this.parseInlineSectionPrefix(line);
      const parsed = scoped
        ? this.parseDeckLine(scoped.line, scoped.section)
        : this.parseDeckLine(line, section);

      if (parsed) {
        entries.push(parsed);
      }
    }

    return entries;
  }

  private parseDeckLine(line: string, section: DeckSection): DecklistEntry | null {
    const quantified = line.match(/^(?:(\d+)\s*x?|x\s*(\d+))\s+(.+)$/i);
    const quantityToken = quantified?.[1] ?? quantified?.[2];
    const quantity = quantityToken ? Number.parseInt(quantityToken, 10) : 1;
    const rawName = quantified?.[3] ?? line;
    if (!rawName) {
      return null;
    }

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
      .replace(/\s+[\u2605\u2606\u2736\u2737\u2726\u2727]+\s*$/u, '')
      .replace(/\s*[★☆]\s*$/, '')
      .replace(/\s+\([A-Z0-9]{2,8}\)\s+.+$/i, '')
      .replace(/\s+\/\s+/g, ' // ')
      .replace(/\s*\[[^\]]+\]\s*$/, '')
      .replace(/\s+#\d+\s*$/, '')
      .trim();
  }

  private parseSectionHeader(line: string): DeckSection | null {
    const header = line
      .toLowerCase()
      .replace(/:$/, '')
      .replace(/\s*\(\d+\)\s*$/, '')
      .trim();

    if (['commander', 'commanders', 'command zone', 'commandzone', 'cmdr'].includes(header)) {
      return 'commander';
    }

    if (['sideboard', 'side', 'sb'].includes(header)) {
      return 'sideboard';
    }

    if (['maybeboard', 'maybe', 'considering', 'mb'].includes(header)) {
      return 'maybeboard';
    }

    if (['deck', 'main', 'maindeck', 'mainboard'].includes(header)) {
      return 'main';
    }

    return null;
  }

  private parseInlineSectionPrefix(line: string): { section: DeckSection; line: string } | null {
    const match = line.match(/^(sb|sideboard|side|mb|maybeboard|maybe|considering|cmdr|commander|commanders|command zone|deck|main|maindeck|mainboard)\s*:\s*(.+)$/i);
    if (!match) {
      return null;
    }

    const prefix = match[1]?.toLowerCase().trim();
    const scopedLine = match[2]?.trim();
    if (!prefix || !scopedLine) {
      return null;
    }

    const section = this.parseSectionHeader(prefix);
    if (!section) {
      return null;
    }

    return { section, line: scopedLine };
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
