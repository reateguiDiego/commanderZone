import { Location } from '@angular/common';
import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { SeoInternalLinkDirective } from './seo-internal-link.directive';

@Component({
  imports: [SeoInternalLinkDirective],
  template: `
    <a appSeoInternalLink href="/en/play-commander-online/">SEO</a>
    <a appSeoInternalLink href="/auth/login/">Login</a>
  `,
})
class TestHostComponent {}

describe('SeoInternalLinkDirective', () => {
  let fixture: ComponentFixture<TestHostComponent>;
  let location: { replaceState: ReturnType<typeof vi.fn> };
  let router: { navigateByUrl: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    router = {
      navigateByUrl: vi.fn().mockResolvedValue(true),
    };
    location = {
      replaceState: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [TestHostComponent],
      providers: [
        { provide: Router, useValue: router },
        { provide: Location, useValue: location },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TestHostComponent);
    fixture.detectChanges();
  });

  it('uses Angular navigation for canonical SEO links without removing href', async () => {
    const seoLink = fixture.nativeElement.querySelector('a[href="/en/play-commander-online/"]') as HTMLAnchorElement;
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });

    seoLink.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(router.navigateByUrl).toHaveBeenCalledWith('/en/play-commander-online');
    expect(seoLink.getAttribute('href')).toBe('/en/play-commander-online/');
    await Promise.resolve();
    expect(location.replaceState).toHaveBeenCalledWith('/en/play-commander-online/');
  });

  it('leaves non-SEO app links as normal anchors', () => {
    const loginLink = fixture.nativeElement.querySelector('a[href="/auth/login/"]') as HTMLAnchorElement;
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });

    loginLink.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(router.navigateByUrl).not.toHaveBeenCalled();
    expect(loginLink.getAttribute('href')).toBe('/auth/login/');
  });
});
