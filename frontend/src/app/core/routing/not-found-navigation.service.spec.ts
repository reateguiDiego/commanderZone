import { TestBed } from '@angular/core/testing';
import { NotFoundNavigationService } from './not-found-navigation.service';

describe('NotFoundNavigationService', () => {
  let service: NotFoundNavigationService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(NotFoundNavigationService);
  });

  it('returns the last good internal URL when a wildcard not-found route is reached', () => {
    service.recordNavigationEnd('/community?tab=decks', false);
    service.recordNavigationEnd('/missing-page', true);

    expect(service.returnUrl()).toBe('/community?tab=decks');
  });

  it('falls back to no return URL on direct not-found loads', () => {
    service.recordNavigationEnd('/missing-page', true);

    expect(service.returnUrl()).toBeNull();
  });

  it('removes URLs that later fail with an API not-found before redirecting to 404', () => {
    service.recordNavigationEnd('/community', false);
    service.recordNavigationEnd('/community/decks/missing-slug', false);

    service.markUrlAsNotFound('/community/decks/missing-slug');
    service.recordNavigationEnd('/404', true);

    expect(service.returnUrl()).toBe('/community');
  });

  it('ignores external and protocol-relative URLs', () => {
    service.recordNavigationEnd('/decks', false);
    service.recordNavigationEnd('https://example.test/path', false);
    service.recordNavigationEnd('//example.test/path', false);
    service.recordNavigationEnd('/missing', true);

    expect(service.returnUrl()).toBe('/decks');
  });
});
