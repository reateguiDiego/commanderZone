let cacheBypassRunKey: string | null = null;

/**
 * Creates a cold-cache image URL only for an explicit localhost performance run.
 * Production URLs, browser caching and Scryfall URLs remain unchanged otherwise.
 */
export function imageRequestUrl(imageUrl: string): string {
  if (!shouldBypassImageCache()) {
    return imageUrl;
  }

  try {
    const url = new URL(imageUrl);
    if (url.hostname !== 'cards.scryfall.io') {
      return imageUrl;
    }

    url.searchParams.set('cz-image-run', imageCacheBypassRunKey());
    return url.toString();
  } catch {
    return imageUrl;
  }
}

function shouldBypassImageCache(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  const isLocalHost =
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1' ||
    window.location.hostname === '[::1]';

  return isLocalHost && new URLSearchParams(window.location.search).get('image-cache-bust') === '1';
}

function imageCacheBypassRunKey(): string {
  if (cacheBypassRunKey === null) {
    cacheBypassRunKey = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  return cacheBypassRunKey;
}
