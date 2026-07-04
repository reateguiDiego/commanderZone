export function communityUserProfilePath(
  canonicalPath: string | null | undefined,
  username: string | null | undefined,
): string | null {
  const trimmedCanonicalPath = canonicalPath?.trim();
  if (trimmedCanonicalPath?.startsWith('/community/users/') && !trimmedCanonicalPath.includes('/undefined')) {
    return trimmedCanonicalPath.replace(/\/+$/, '');
  }

  const trimmedUsername = username?.trim();
  if (!trimmedUsername) {
    return null;
  }

  return `/community/users/${encodeURIComponent(trimmedUsername.replace(/\s+/g, '-'))}`;
}

export function shouldOpenCommunityProfileInNewTab(currentUrl: string): boolean {
  const path = currentUrl.split(/[?#]/, 1)[0] ?? '';

  return /^\/rooms\/[^/]+\/waiting$/.test(path) || /^\/games\/[^/]+$/.test(path);
}
