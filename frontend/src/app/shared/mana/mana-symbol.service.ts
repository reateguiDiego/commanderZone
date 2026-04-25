import { Injectable } from '@angular/core';

export type ManaColor = 'W' | 'U' | 'B' | 'R' | 'G';
export type ManaTextPart =
  | { kind: 'text'; value: string }
  | { kind: 'symbol'; token: ManaSymbolToken };

export interface ManaSymbolToken {
  raw: string;
  code: string;
  className: string;
  label: string;
  known: boolean;
}

export interface LandTypeCount {
  label: string;
  symbol: ManaColor;
  count: number;
}

const SYMBOL_RE = /\{([^}]+)\}/g;
const COLOR_ORDER: ManaColor[] = ['W', 'U', 'B', 'R', 'G'];
const LAND_TYPES: Array<{ label: string; symbol: ManaColor; pattern: RegExp }> = [
  { label: 'Plains', symbol: 'W', pattern: /(^|\s)plains(\s|$)/i },
  { label: 'Island', symbol: 'U', pattern: /(^|\s)island(\s|$)/i },
  { label: 'Swamp', symbol: 'B', pattern: /(^|\s)swamp(\s|$)/i },
  { label: 'Mountain', symbol: 'R', pattern: /(^|\s)mountain(\s|$)/i },
  { label: 'Forest', symbol: 'G', pattern: /(^|\s)forest(\s|$)/i },
];
const SIMPLE_SYMBOLS = new Set([
  'w', 'u', 'b', 'r', 'g', 'c', 'x', 'y', 'z', 'e', 's', 'p', 'chaos', 'tap', 'untap',
  ...Array.from({ length: 21 }, (_, index) => String(index)),
]);

@Injectable({ providedIn: 'root' })
export class ManaSymbolService {
  parseCost(value: string | null | undefined): ManaSymbolToken[] {
    return this.symbolsFromText(value ?? '');
  }

  parseSymbols(symbols: readonly string[] | null | undefined): ManaSymbolToken[] {
    return (symbols ?? []).map((symbol) => this.toToken(symbol));
  }

  parseText(value: string | null | undefined): ManaTextPart[] {
    const text = value ?? '';
    const parts: ManaTextPart[] = [];
    let cursor = 0;

    for (const match of text.matchAll(SYMBOL_RE)) {
      const start = match.index ?? 0;
      if (start > cursor) {
        parts.push({ kind: 'text', value: text.slice(cursor, start) });
      }
      parts.push({ kind: 'symbol', token: this.toToken(match[1] ?? '') });
      cursor = start + match[0].length;
    }

    if (cursor < text.length) {
      parts.push({ kind: 'text', value: text.slice(cursor) });
    }

    return parts.length > 0 ? parts : [{ kind: 'text', value: text }];
  }

  landTypeCounts(typeLines: Array<string | null | undefined>): LandTypeCount[] {
    return LAND_TYPES.map((landType) => ({
      label: landType.label,
      symbol: landType.symbol,
      count: typeLines.filter((typeLine) => landType.pattern.test(typeLine ?? '')).length,
    }));
  }

  private symbolsFromText(value: string): ManaSymbolToken[] {
    const tokens = Array.from(value.matchAll(SYMBOL_RE), (match) => this.toToken(match[1] ?? ''));

    return tokens.length > 0 ? tokens : [];
  }

  private toToken(rawValue: string): ManaSymbolToken {
    const raw = rawValue.trim();
    const code = this.normalizeCode(raw);
    const known = this.isKnown(code);

    return {
      raw: `{${raw}}`,
      code,
      className: known ? `ms ms-cost ms-${code}` : '',
      label: raw,
      known,
    };
  }

  private normalizeCode(raw: string): string {
    const value = raw.toLowerCase().replace(/\s+/g, '');
    if (value === 't') {
      return 'tap';
    }
    if (value === 'q') {
      return 'untap';
    }

    return value.replace(/\//g, '');
  }

  private isKnown(code: string): boolean {
    if (SIMPLE_SYMBOLS.has(code)) {
      return true;
    }

    if (/^[wubrg][wubrg]$/.test(code)) {
      return code[0] !== code[1];
    }
    if (/^[2c][wubrg]$/.test(code)) {
      return true;
    }
    if (/^[wubrg]p$/.test(code)) {
      return true;
    }
    if (/^[wubrg]{2}p$/.test(code)) {
      return code[0] !== code[1];
    }

    return false;
  }
}
