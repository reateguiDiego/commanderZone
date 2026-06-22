import { HttpClient } from '@angular/common/http';
import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { RUNTIME_TRANSLATION_FALLBACKS } from './runtime-translation-fallbacks';
import { RuntimeTranslationLoader } from './runtime-translation-loader';

describe('RuntimeTranslationLoader', () => {
  const httpGet = vi.fn();

  beforeEach(() => {
    TestBed.resetTestingModule();
    httpGet.mockReset();
  });

  it('loads runtime translations through HTTP in the browser', () => {
    httpGet.mockReturnValue(of({ common: { title: 'CommanderZone' } }));
    TestBed.configureTestingModule({
      providers: [
        RuntimeTranslationLoader,
        { provide: PLATFORM_ID, useValue: 'browser' },
        { provide: HttpClient, useValue: { get: httpGet } },
      ],
    });

    TestBed.inject(RuntimeTranslationLoader).getTranslation('zh-hans').subscribe();

    expect(httpGet).toHaveBeenCalledWith('assets/i18n/zh-hans.json');
  });

  it('uses in-memory fallbacks during server prerender without HTTP', () => {
    TestBed.configureTestingModule({
      providers: [
        RuntimeTranslationLoader,
        { provide: PLATFORM_ID, useValue: 'server' },
        { provide: HttpClient, useValue: { get: httpGet } },
      ],
    });

    TestBed.inject(RuntimeTranslationLoader).getTranslation('es').subscribe((translations) => {
      expect(translations['common.app.app.loading']).toBe(RUNTIME_TRANSLATION_FALLBACKS['common.app.app.loading']);
    });

    expect(httpGet).not.toHaveBeenCalled();
  });
});
