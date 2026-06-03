import { TestBed } from '@angular/core/testing';
import { TranslateService as NgxTranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import { SUPPORTED_LOCALE_CODES } from './locale-config';
import { TranslationService } from './translation.service';

describe('TranslationService', () => {
  const addLangs = vi.fn();
  const use = vi.fn();
  const instant = vi.fn();
  const stream = vi.fn();
  const getCurrentLang = vi.fn();

  beforeEach(() => {
    addLangs.mockReset();
    use.mockReset();
    instant.mockReset();
    stream.mockReset();
    getCurrentLang.mockReset();
    use.mockReturnValue(of({}));
    stream.mockReturnValue(of('translated'));
    instant.mockReturnValue('translated');
    getCurrentLang.mockReturnValue('es');

    TestBed.configureTestingModule({
      providers: [
        TranslationService,
        {
          provide: NgxTranslateService,
          useValue: {
            addLangs,
            use,
            instant,
            stream,
            getCurrentLang,
          } satisfies Pick<NgxTranslateService, 'addLangs' | 'use' | 'instant' | 'stream' | 'getCurrentLang'>,
        },
      ],
    });
  });

  it('registers all supported locales with ngx-translate', () => {
    TestBed.inject(TranslationService);

    expect(addLangs).toHaveBeenCalledWith([...SUPPORTED_LOCALE_CODES]);
  });

  it('uses supported locales directly', () => {
    const service = TestBed.inject(TranslationService);

    service.useLocale('zh-hans');

    expect(use).toHaveBeenCalledWith('zh-hans');
  });

  it('falls back to the default locale for unsupported locale values', () => {
    const service = TestBed.inject(TranslationService);

    service.useLocale('zhs');
    getCurrentLang.mockReturnValue('unsupported');

    expect(use).toHaveBeenCalledWith('es');
    expect(service.currentLocale()).toBe('es');
  });

  it('delegates instant and stream calls to ngx-translate', () => {
    const service = TestBed.inject(TranslationService);
    const params = { name: 'CommanderZone' };

    expect(service.instant('common.title', params)).toBe('translated');
    service.stream('common.title', params);

    expect(instant).toHaveBeenCalledWith('common.title', params);
    expect(stream).toHaveBeenCalledWith('common.title', params);
  });
});
