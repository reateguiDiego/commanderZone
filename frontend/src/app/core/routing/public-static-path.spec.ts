import { isPublicStaticPath, normalizeBrowserPath } from './public-static-path';

describe('public static path detection', () => {
  it('detects SEO and legal prerendered paths', () => {
    expect(isPublicStaticPath('/')).toBe(true);
    expect(isPublicStaticPath('/en/play-commander-online/')).toBe(true);
    expect(isPublicStaticPath('/privacy-policy/')).toBe(true);
    expect(isPublicStaticPath('/es/politica-privacidad/')).toBe(true);
  });

  it('does not classify private app paths as public static pages', () => {
    expect(isPublicStaticPath('/auth/login')).toBe(false);
    expect(isPublicStaticPath('/dashboard')).toBe(false);
    expect(isPublicStaticPath('/rooms')).toBe(false);
  });

  it('normalizes browser paths before matching', () => {
    expect(normalizeBrowserPath('en/play-commander-online/?x=1#top')).toBe('/en/play-commander-online');
    expect(normalizeBrowserPath('/')).toBe('/');
  });
});
