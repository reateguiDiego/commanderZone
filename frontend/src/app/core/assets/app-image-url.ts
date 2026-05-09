import { API_BASE_URL } from '../api/api.config';

const PUBLIC_ASSET_PREFIX = 'assets/';
const PUBLIC_ASSET_ABSOLUTE_PREFIX = '/assets/';

export function publicAssetUrl(assetPath: string): string {
  if (assetPath.startsWith(PUBLIC_ASSET_ABSOLUTE_PREFIX)) {
    return assetPath;
  }

  if (assetPath.startsWith(PUBLIC_ASSET_PREFIX)) {
    return `/${assetPath}`;
  }

  return `/assets/${assetPath.replace(/^\/+/, '')}`;
}

export function appImageUrl(imageUrl: string | null): string | null {
  if (!imageUrl) {
    return null;
  }

  if (isInlineOrExternalUrl(imageUrl)) {
    return imageUrl;
  }

  if (imageUrl.startsWith(PUBLIC_ASSET_PREFIX) || imageUrl.startsWith(PUBLIC_ASSET_ABSOLUTE_PREFIX)) {
    return publicAssetUrl(imageUrl);
  }

  return imageUrl.startsWith('/') ? `${API_BASE_URL}${imageUrl}` : imageUrl;
}

function isInlineOrExternalUrl(imageUrl: string): boolean {
  return /^(?:data|blob|https?):/i.test(imageUrl);
}
