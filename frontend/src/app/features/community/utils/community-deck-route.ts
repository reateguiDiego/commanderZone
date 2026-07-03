import { CommunityDeckSummary } from '../../../core/models/community.model';

export function communityDeckRoute(deck: Pick<CommunityDeckSummary, 'id' | 'publicSlug' | 'canonicalPath'>): string {
  const path = deck.canonicalPath ?? `/community/decks/${deck.publicSlug ?? deck.id}/`;

  return path.length > 1 ? path.replace(/\/+$/, '') : path;
}
