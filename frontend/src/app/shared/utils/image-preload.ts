export type ImagePreloadPriority = 'auto' | 'high' | 'low';

interface ImagePreloadOptions {
  fetchPriority?: ImagePreloadPriority;
}

const pendingPreloads = new Map<string, Promise<boolean>>();

export function preloadImage(imageUrl: string | null, options: ImagePreloadOptions = {}): Promise<boolean> {
  if (!imageUrl || typeof Image === 'undefined') {
    return Promise.resolve(false);
  }

  const existingPreload = pendingPreloads.get(imageUrl);
  if (existingPreload) {
    return existingPreload;
  }

  const preload = new Promise<boolean>((resolve) => {
    const image = new Image();
    image.decoding = 'async';
    image.fetchPriority = options.fetchPriority ?? 'auto';
    image.onload = () => resolve(true);
    image.onerror = () => resolve(false);
    image.src = imageUrl;

    if (image.complete) {
      resolve(image.naturalWidth > 0);
    }
  });

  pendingPreloads.set(imageUrl, preload);
  void preload.finally(() => pendingPreloads.delete(imageUrl));

  return preload;
}
