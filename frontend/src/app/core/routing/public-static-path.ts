import { PUBLIC_STATIC_PATHS } from './generated-public-static-paths';

export function isPublicStaticPath(path: string): boolean {
  return PUBLIC_STATIC_PATHS.has(normalizeBrowserPath(path));
}

export function normalizeBrowserPath(path: string): string {
  const [pathWithoutHash] = path.split('#');
  const [pathWithoutQuery] = (pathWithoutHash ?? '').split('?');
  const pathOnly = pathWithoutQuery ?? '';
  const withLeadingSlash = pathOnly.startsWith('/') ? pathOnly : `/${pathOnly}`;
  return withLeadingSlash.replace(/\/+$/, '') || '/';
}
