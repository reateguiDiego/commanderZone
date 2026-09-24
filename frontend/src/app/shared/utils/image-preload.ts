export type ImagePreloadPriority = 'auto' | 'high' | 'low';

interface ImagePreloadOptions {
  fetchPriority?: ImagePreloadPriority;
  signal?: AbortSignal;
}

const pendingPreloads = new Map<string, Promise<boolean>>();

export function preloadImage(imageUrl: string | null, options: ImagePreloadOptions = {}): Promise<boolean> {
  if (!imageUrl || typeof Image === 'undefined' || options.signal?.aborted) {
    return Promise.resolve(false);
  }

  const existingPreload = pendingPreloads.get(imageUrl);
  if (existingPreload) {
    return existingPreload;
  }

  const preload = new Promise<boolean>((resolve) => {
    const image = new Image();
    let settled = false;
    const settle = (loaded: boolean): void => {
      if (settled) {
        return;
      }

      settled = true;
      image.onload = null;
      image.onerror = null;
      options.signal?.removeEventListener('abort', cancel);
      resolve(loaded);
    };
    const cancel = (): void => {
      image.src = '';
      settle(false);
    };
    image.decoding = 'async';
    image.fetchPriority = options.fetchPriority ?? 'auto';
    image.onload = () => settle(true);
    image.onerror = () => settle(false);
    options.signal?.addEventListener('abort', cancel, { once: true });
    image.src = imageUrl;

    if (image.complete) {
      settle(image.naturalWidth > 0);
    }
  });

  pendingPreloads.set(imageUrl, preload);
  void preload.finally(() => pendingPreloads.delete(imageUrl));

  return preload;
}
