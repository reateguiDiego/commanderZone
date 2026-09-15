export function preloadImage(imageUrl: string | null): Promise<boolean> {
  if (!imageUrl || typeof Image === 'undefined') {
    return Promise.resolve(false);
  }

  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(true);
    image.onerror = () => resolve(false);
    image.src = imageUrl;

    if (image.complete) {
      resolve(image.naturalWidth > 0);
    }
  });
}
