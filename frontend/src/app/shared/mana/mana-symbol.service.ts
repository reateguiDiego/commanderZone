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
const SIMPLE_SYMBOL_LABELS: Readonly<Record<string, string>> = {
  w: 'White mana',
  u: 'Blue mana',
  b: 'Black mana',
  r: 'Red mana',
  g: 'Green mana',
  c: 'Colorless mana',
  x: 'Variable mana',
  y: 'Variable mana',
  z: 'Variable mana',
  e: 'Energy counter',
  s: 'Snow mana',
  p: 'Phyrexian mana',
  chaos: 'Chaos',
  tap: 'Tap',
  untap: 'Untap',
};
const COLOR_SYMBOL_LABELS: Readonly<Record<ManaColor, string>> = {
  W: 'White mana',
  U: 'Blue mana',
  B: 'Black mana',
  R: 'Red mana',
  G: 'Green mana',
};
const GENERIC_MANA_LABELS: Readonly<Record<string, string>> = {
  '0': 'Zero generic mana',
  '1': 'One generic mana',
  '2': 'Two generic mana',
  '3': 'Three generic mana',
  '4': 'Four generic mana',
  '5': 'Five generic mana',
  '6': 'Six generic mana',
  '7': 'Seven generic mana',
  '8': 'Eight generic mana',
  '9': 'Nine generic mana',
  '10': 'Ten generic mana',
  '11': 'Eleven generic mana',
  '12': 'Twelve generic mana',
  '13': 'Thirteen generic mana',
  '14': 'Fourteen generic mana',
  '15': 'Fifteen generic mana',
  '16': 'Sixteen generic mana',
  '17': 'Seventeen generic mana',
  '18': 'Eighteen generic mana',
  '19': 'Nineteen generic mana',
  '20': 'Twenty generic mana',
};

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
      label: this.labelForSymbol(raw, code),
      known,
    };
  }

  private labelForSymbol(raw: string, code: string): string {
    const simpleLabel = SIMPLE_SYMBOL_LABELS[code] ?? GENERIC_MANA_LABELS[code];
    if (simpleLabel) {
      return simpleLabel;
    }

    if (/^[wubrg][wubrg]$/.test(code)) {
      return `${this.colorLabel(code.charAt(0))} or ${this.colorLabel(code.charAt(1))}`;
    }
    if (/^[2c][wubrg]$/.test(code)) {
      const firstLabel = code.charAt(0) === '2' ? 'Two generic mana' : 'Colorless mana';

      return `${firstLabel} or ${this.colorLabel(code.charAt(1))}`;
    }
    if (/^[wubrg]p$/.test(code)) {
      return `${this.colorLabel(code.charAt(0))} or 2 life`;
    }
    if (/^[wubrg]{2}p$/.test(code)) {
      return `${this.colorLabel(code.charAt(0))}, ${this.colorLabel(code.charAt(1))}, or 2 life`;
    }

    return `{${raw}}`;
  }

  private colorLabel(code: string): string {
    return COLOR_SYMBOL_LABELS[code.toUpperCase() as ManaColor] ?? code.toUpperCase();
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
