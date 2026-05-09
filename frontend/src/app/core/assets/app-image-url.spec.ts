import { appImageUrl, publicAssetUrl } from './app-image-url';

describe('appImageUrl', () => {
  it('resolves project assets as root-relative URLs', () => {
    expect(publicAssetUrl('assets/images/avatars/storm-seer.png')).toBe('/assets/images/avatars/storm-seer.png');
    expect(appImageUrl('assets/images/avatars/storm-seer.png')).toBe('/assets/images/avatars/storm-seer.png');
  });

  it('keeps inline and external image URLs unchanged', () => {
    expect(appImageUrl('data:image/png;base64,abc')).toBe('data:image/png;base64,abc');
    expect(appImageUrl('https://example.test/avatar.png')).toBe('https://example.test/avatar.png');
  });
});
