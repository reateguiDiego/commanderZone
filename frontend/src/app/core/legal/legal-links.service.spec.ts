import { NavigationEnd, Router } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { RuntimeLanguageSelectorService } from '../localization/runtime-language-selector.service';
import { getPublicChromeCopy } from '../localization/public-chrome-copy';
import { LegalLinksService } from './legal-links.service';

describe('LegalLinksService', () => {
  let routerEvents: Subject<NavigationEnd>;
  let routerMock: Pick<Router, 'url' | 'events'>;

  beforeEach(() => {
    TestBed.resetTestingModule();
    routerEvents = new Subject<NavigationEnd>();
    routerMock = {
      url: '/de/faq/',
      events: routerEvents.asObservable() as Router['events'],
    };

    TestBed.configureTestingModule({
      providers: [
        LegalLinksService,
        { provide: Router, useValue: routerMock },
        {
          provide: RuntimeLanguageSelectorService,
          useFactory: () => {
            throw new Error('Runtime i18n must not be resolved by public legal links.');
          },
        },
      ],
    });
  });

  afterEach(() => {
    routerEvents.complete();
  });

  it('uses the SEO route locale without resolving runtime language preferences', () => {
    const service = TestBed.inject(LegalLinksService);

    expect(service.currentLocale()).toBe('de');
    expect(service.chromeCopy().footer.ariaLabel).toBe(getPublicChromeCopy('de').footer.ariaLabel);
  });

  it('updates from legal route URLs and falls back to English for unknown public paths', () => {
    const service = TestBed.inject(LegalLinksService);

    routerEvents.next(new NavigationEnd(1, '/es/politica-cookies/', '/es/politica-cookies/'));
    expect(service.currentLocale()).toBe('es');
    expect(service.links()[0].href).toBe('/es/politica-privacidad/');

    routerEvents.next(new NavigationEnd(2, '/unknown-public-page', '/unknown-public-page'));
    expect(service.currentLocale()).toBe('en');
    expect(service.chromeCopy().footer.ariaLabel).toBe(getPublicChromeCopy('en').footer.ariaLabel);
  });
});
