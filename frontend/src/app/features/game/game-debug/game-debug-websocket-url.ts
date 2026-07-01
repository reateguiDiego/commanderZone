export interface GameDebugWebsocketUrl {
  fullUrl: string;
  displayUrl: string;
}

export function buildGameDebugWebsocketUrl(baseUrl: string, gameId: string, ticket: string): GameDebugWebsocketUrl | null {
  const normalizedBaseUrl = baseUrl.trim();
  const normalizedGameId = gameId.trim();
  const normalizedTicket = ticket.trim();

  if (normalizedBaseUrl === '' || normalizedGameId === '' || normalizedTicket === '') {
    return null;
  }

  const url = new URL(normalizedBaseUrl);
  const basePath = url.pathname.replace(/\/$/, '');
  const debugPath = `${basePath}/games/${encodeURIComponent(normalizedGameId)}/debug`;
  url.pathname = debugPath.replace(/\/{2,}/g, '/');
  url.searchParams.set('ticket', normalizedTicket);

  const displayUrl = new URL(url.toString());
  displayUrl.searchParams.delete('ticket');

  return {
    fullUrl: url.toString(),
    displayUrl: displayUrl.toString(),
  };
}
