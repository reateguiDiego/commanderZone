import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { DeckImportExportService } from './deck-import-export.service';

describe('DeckImportExportService', () => {
  let service: DeckImportExportService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(DeckImportExportService);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('normalizes plain text with headers and set codes for the backend', () => {
    const result = service.normalizeForBackend('Commander\n1 Atraxa, Praetors\' Voice\n\nDeck\n1x Sol Ring (CMM) 400', 'plain');

    expect(result).toBe('Commander\n1 Atraxa, Praetors\' Voice\n\nDeck\n1 Sol Ring (CMM) 400');
  });

  it('cleans common plain text suffixes and normalizes split-card separators', () => {
    const entries = service.parse(
      [
        '1 Hallowed Fountain (PECL) 265p',
        '1 Felidar Umbra (PLST) PCA-6',
        '1 Teferi, Time Raveler (WAR) 221★',
        '1 Andúril, Narsil Reforged (LTC) 491 *F*',
        '1 Fable of the Mirror-Breaker / Reflection of Kiki-Jiki (NEO) 141',
      ].join('\n'),
      'plain',
    );

    expect(entries.map((entry) => entry.name)).toEqual([
      'Hallowed Fountain',
      'Felidar Umbra',
      'Teferi, Time Raveler',
      'Andúril, Narsil Reforged',
      'Fable of the Mirror-Breaker // Reflection of Kiki-Jiki',
    ]);
    expect(entries[0].setCode).toBe('pecl');
    expect(entries[0].collectorNumber).toBe('265p');
  });

  it('keeps print metadata and does not call Scryfall directly for missing flavor names', async () => {
    vi.stubGlobal('fetch', vi.fn());

    const entries = service.parse("1 Donnie's Bo (PZA) 17", 'plain');
    const resolved = await service.resolveMissingFlavorNames(entries, ["Donnie's Bo"]);

    expect(resolved).toEqual(entries);
    expect(service.toBackendDecklist(resolved)).toBe("Deck\n1 Donnie's Bo (PZA) 17");
    expect(fetch).not.toHaveBeenCalled();
  });
});
