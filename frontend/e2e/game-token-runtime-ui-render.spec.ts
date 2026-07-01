import { expect, test, type APIRequestContext, type BrowserContext, type Page, type WebSocket } from '@playwright/test';
import { authStorageState } from './support/auth';
import { createCommanderGameWithBasicDecks, resolveGameToPlaying } from './support/commander-game';
import { clickGameMenuAction, focusPlayer } from './support/game-table';

const API_BASE_URL = process.env['E2E_API_BASE_URL'] ?? 'http://127.0.0.1:8000';
const RUNTIME_READY_URL = process.env['E2E_GAME_RUNTIME_READY_URL'] ?? 'http://127.0.0.1:8091/readyz';
const POLL_TIMEOUT = 30_000;

type JsonObject = Record<string, unknown>;

interface TokenCard {
  readonly scryfallId: string;
  readonly name: string;
  readonly imageUris?: Record<string, string | null | undefined>;
  readonly cardFaces?: Array<{ readonly imageUris?: Record<string, string | null | undefined> }>;
  readonly searchQuery: string;
}

interface BrowserAudit {
  readonly label: 'A' | 'B';
  readonly sent: JsonObject[];
  readonly received: JsonObject[];
  readonly consoleErrors: string[];
  readonly pageErrors: string[];
  readonly resyncSignals: string[];
  readonly commandFallbackRequests: string[];
  readonly snapshotReloadRequests: string[];
  readonly websocketTicketRoutes: string[];
  readonly websocketErrors: string[];
  readonly websocketCloses: string[];
  readonly serverErrors: string[];
}

test.setTimeout(240_000);

test('P56 runtime token creation renders selected token print immediately without refresh', async ({ browser, request, baseURL }) => {
  if (!baseURL) {
    throw new Error('Playwright baseURL is required.');
  }

  await assertGameRuntimeReady(request);
  const tokenCard = await findRenderableTokenCard(request);
  const setup = await createCommanderGameWithBasicDecks(request, {
    runId: `p56${Date.now().toString(36).slice(-6)}`,
    playerAPrefix: 'p56a',
    playerBPrefix: 'p56b',
    roomVisibility: 'public',
  });
  const { gameId, playerA, playerB } = setup;
  await resolveGameToPlaying(request, gameId, [playerA, playerB]);

  const contextA = await browser.newContext({
    baseURL,
    storageState: authStorageState(baseURL, playerA.user, playerA.refreshToken),
  });
  const contextB = await browser.newContext({
    baseURL,
    storageState: authStorageState(baseURL, playerB.user, playerB.refreshToken),
  });
  await Promise.all([enableFrontendGameplayV2(contextA), enableFrontendGameplayV2(contextB)]);

  try {
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();
    const auditA = collectBrowserAudit(pageA, 'A', gameId);
    const auditB = collectBrowserAudit(pageB, 'B', gameId);

    await Promise.all([pageA.goto(`/games/${gameId}`), pageB.goto(`/games/${gameId}`)]);
    await Promise.all([
      expect(pageA.getByTestId('game-screen')).toBeVisible({ timeout: POLL_TIMEOUT }),
      expect(pageB.getByTestId('game-screen')).toBeVisible({ timeout: POLL_TIMEOUT }),
    ]);
    await Promise.all([
      expect(pageA.getByTestId('mulligan-overlay')).toBeHidden(),
      expect(pageB.getByTestId('mulligan-overlay')).toBeHidden(),
      waitForGameplayConnection(auditA),
      waitForGameplayConnection(auditB),
    ]);
    await Promise.all([
      focusPlayer(pageA, playerA.user.displayName),
      focusPlayer(pageB, playerA.user.displayName),
    ]);
    await expect.poll(() => auditA.websocketTicketRoutes.includes('runtime_ws'), { timeout: 10_000 }).toBe(true);
    await expect.poll(() => auditB.websocketTicketRoutes.includes('runtime_ws'), { timeout: 10_000 }).toBe(true);

    const baselineSnapshotReloads = auditA.snapshotReloadRequests.length + auditB.snapshotReloadRequests.length;
    const startReceivedA = auditA.received.length;
    const startReceivedB = auditB.received.length;
    const startSentA = auditA.sent.length;

    await clickGameMenuAction(pageA, /^Create token$/);
    const dialog = pageA.getByRole('dialog', { name: 'Create token' });
    await expect(dialog).toBeVisible({ timeout: POLL_TIMEOUT });
    await dialog.locator('input[name="gameplayCardSearch"]').fill(tokenCard.searchQuery);
    const createButton = dialog.getByRole('button', { name: new RegExp(`^Create 1 ${escapeRegExp(tokenCard.name)}$`) }).first();
    await expect(createButton).toBeVisible({ timeout: POLL_TIMEOUT });
    await createButton.click();

    const ownerPatch = await waitForPatchAfter(auditA.received, startReceivedA, hasTokenAddOperation);
    const rivalPatch = await waitForPatchAfter(auditB.received, startReceivedB, hasTokenAddOperation);
    const tokenOp = operation(ownerPatch, 'zone.cards.add');
    const rivalTokenOp = operation(rivalPatch, 'zone.cards.add');
    const token = addedCards(ownerPatch)[0]!;
    const rivalToken = addedCards(rivalPatch)[0]!;
    const tokenId = String(token['instanceId']);
    const tokenCardKey = String(token['cardKey']);
    const tokenPrintId = String(token['printId']);
    const staticCard = staticCardFor(tokenOp, tokenCardKey);

    expect(sentCommandsAfter(auditA, startSentA, 'card.token.created')).toHaveLength(1);
    expect(token['isToken']).toBe(true);
    expect(token['cardKey']).toBeTruthy();
    expect(token['printId']).toBe(tokenCard.scryfallId);
    expect(token['cardVersion']).toBeTruthy();
    expect(token['language']).toBeTruthy();
    expect(token['viewerVisibility']).toBe('public');
    expect(staticCard?.['name']).toBe(tokenCard.name);
    expect(staticCard?.['cardKey']).toBe(tokenCardKey);
    expect(staticCard?.['printId']).toBe(tokenPrintId);
    expect(staticCard?.['viewerVisibility']).toBe('public');
    expect(hasRenderableStaticImage(staticCard), JSON.stringify(staticCard)).toBe(true);
    expect(JSON.stringify(ownerPatch)).not.toContain('oracleText');
    expect(JSON.stringify(rivalPatch)).not.toContain('oracleText');
    expect(rivalToken['cardKey']).toBe(token['cardKey']);
    expect(rivalToken['printId']).toBe(token['printId']);
    expect(staticCardFor(rivalTokenOp, tokenCardKey)?.['name']).toBe(tokenCard.name);

    const cardLookup = await request.get(`${API_BASE_URL}/cards/${encodeURIComponent(tokenPrintId)}`, {
      headers: { Authorization: `Bearer ${playerA.token}` },
    });
    expect(cardLookup.ok(), `${cardLookup.status()} ${await cardLookup.text()}`).toBeTruthy();
    const lookupPayload = await cardLookup.json() as { card?: { scryfallId?: string } };
    expect(lookupPayload.card?.scryfallId).toBe(tokenPrintId);

    await expectVisibleTokenPrint(pageA, playerA.user.id, tokenId, tokenCard.name);
    await expectVisibleTokenPrint(pageB, playerA.user.id, tokenId, tokenCard.name);
    expect(auditA.snapshotReloadRequests.length + auditB.snapshotReloadRequests.length).toBe(baselineSnapshotReloads);
    expect(auditA.commandFallbackRequests).toEqual([]);
    expect(auditB.commandFallbackRequests).toEqual([]);
    assertNoRuntimeResyncOrErrors([auditA, auditB], [ownerPatch, rivalPatch]);

    console.log(`[P56 token evidence] ${JSON.stringify({
      tokenName: tokenCard.name,
      tokenScryfallId: tokenCard.scryfallId,
      ownerCard: token,
      ownerStaticCard: staticCard,
      rivalCard: rivalToken,
      fallbackPosts: auditA.commandFallbackRequests.length + auditB.commandFallbackRequests.length,
      snapshotReloadsAfterAction: auditA.snapshotReloadRequests.length + auditB.snapshotReloadRequests.length - baselineSnapshotReloads,
      ticketRoutes: [...auditA.websocketTicketRoutes, ...auditB.websocketTicketRoutes],
    })}`);
  } finally {
    await Promise.all([
      contextA.close().catch(() => undefined),
      contextB.close().catch(() => undefined),
    ]);
  }
});

async function assertGameRuntimeReady(request: APIRequestContext): Promise<void> {
  const response = await request.get(RUNTIME_READY_URL, { timeout: 10_000 });
  if (!response.ok()) {
    throw new Error(`game-runtime is not ready at ${RUNTIME_READY_URL}: ${response.status()} ${await response.text()}`);
  }
}

async function enableFrontendGameplayV2(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    window.localStorage.setItem('commanderzone.gameplayV2FrontendEnabled', '1');
  });
}

async function findRenderableTokenCard(request: APIRequestContext): Promise<TokenCard> {
  for (const query of ['Goblin', 'Soldier', 'Treasure', 'Clue', 'Beast']) {
    const response = await request.get(`${API_BASE_URL}/cards/search`, {
      params: {
        q: query,
        page: '1',
        limit: '50',
        tokenOnly: 'true',
        lang: 'en',
      },
    });
    expect(response.ok(), `${response.status()} ${await response.text()}`).toBeTruthy();
    const payload = await response.json() as { data?: TokenCard[] };
    const card = (payload.data ?? []).find((candidate) => candidate.scryfallId && candidate.name && hasTokenCardImage(candidate));
    if (card) {
      return { ...card, searchQuery: query };
    }
  }

  throw new Error('Could not find a renderable token card in the local card catalog.');
}

function collectBrowserAudit(page: Page, label: 'A' | 'B', gameId: string): BrowserAudit {
  const audit: BrowserAudit = {
    label,
    sent: [],
    received: [],
    consoleErrors: [],
    pageErrors: [],
    resyncSignals: [],
    commandFallbackRequests: [],
    snapshotReloadRequests: [],
    websocketTicketRoutes: [],
    websocketErrors: [],
    websocketCloses: [],
    serverErrors: [],
  };

  page.on('request', (request) => {
    const url = request.url();
    if (request.method() === 'POST' && url.includes(`/games/${gameId}/commands`)) {
      audit.commandFallbackRequests.push(`${label} ${url}`);
    }
    if (request.method() === 'GET' && (url.includes(`/games/${gameId}/snapshot`) || url.includes(`/games/${gameId}/bootstrap`))) {
      audit.snapshotReloadRequests.push(`${label} ${url}`);
    }
  });
  page.on('response', (response) => {
    const request = response.request();
    if (request.method() === 'POST' && response.url().includes(`/games/${gameId}/websocket-ticket`)) {
      void response.json().then((payload: unknown) => {
        if (isRecord(payload) && typeof payload['route'] === 'string') {
          audit.websocketTicketRoutes.push(payload['route']);
        }
      }).catch(() => undefined);
    }
    if (response.status() >= 500) {
      audit.serverErrors.push(`${label} ${response.status()} ${response.url()}`);
    }
  });
  page.on('console', (message) => {
    const text = `${label} ${message.text()}`;
    if (message.type() === 'error') {
      audit.consoleErrors.push(text);
    }
    if (/resync_required|refetch_started|snapshot_reload|fallback HTTP/i.test(text)) {
      audit.resyncSignals.push(text);
    }
  });
  page.on('pageerror', (error) => {
    audit.pageErrors.push(`${label} ${error.message}`);
  });
  page.on('websocket', (socket: WebSocket) => {
    if (!isRuntimeWebSocket(socket.url())) {
      return;
    }
    socket.on('framesent', (event) => {
      const parsed = parseFrame(event.payload);
      if (parsed) {
        audit.sent.push(parsed);
      }
    });
    socket.on('framereceived', (event) => {
      const parsed = parseFrame(event.payload);
      if (parsed) {
        audit.received.push(parsed);
      }
    });
    socket.on('socketerror', (error) => audit.websocketErrors.push(`${label} ${String(error)}`));
    socket.on('close', () => audit.websocketCloses.push(`${label} ${socket.url()}`));
  });

  return audit;
}

async function waitForGameplayConnection(audit: BrowserAudit): Promise<void> {
  await expect.poll(() =>
    audit.received.some((message) => message['kind'] === 'connection_state' && message['status'] === 'connected'),
  { timeout: POLL_TIMEOUT }).toBe(true);
}

async function waitForPatchAfter(
  frames: readonly JsonObject[],
  startIndex: number,
  predicate: (message: JsonObject) => boolean,
): Promise<JsonObject> {
  await expect.poll(() =>
    frames.slice(startIndex).find((message) => message['kind'] === 'patch.v2' && predicate(message)) ?? null,
  { timeout: POLL_TIMEOUT }).not.toBeNull();
  const patch = frames.slice(startIndex).find((message) => message['kind'] === 'patch.v2' && predicate(message));
  if (!patch) {
    throw new Error(`patch.v2 frame was not captured. Recent frames: ${JSON.stringify(frames.slice(-20), null, 2)}`);
  }
  return patch;
}

function hasTokenAddOperation(message: JsonObject): boolean {
  return addedCards(message).some((card) => card['isToken'] === true);
}

function operation(message: JsonObject, op: string): JsonObject | null {
  const ops = Array.isArray(message['ops']) ? message['ops'] as JsonObject[] : [];
  return ops.find((item) => item['op'] === op) ?? null;
}

function addedCards(message: JsonObject): JsonObject[] {
  const op = operation(message, 'zone.cards.add');
  return Array.isArray(op?.['cards']) ? op['cards'] as JsonObject[] : [];
}

function staticCardFor(operationPayload: JsonObject | null, cardKey: string): JsonObject | null {
  const staticCards = isRecord(operationPayload?.['staticCards']) ? operationPayload['staticCards'] : null;
  const direct = isRecord(staticCards?.[cardKey]) ? staticCards[cardKey] : null;
  if (direct) {
    return direct;
  }
  return Object.values(staticCards ?? {}).find((value) =>
    isRecord(value) && (value['cardKey'] === cardKey || value['cardRef'] === cardKey),
  ) as JsonObject | undefined ?? null;
}

function sentCommandsAfter(audit: BrowserAudit, startIndex: number, type: string): JsonObject[] {
  return audit.sent.slice(startIndex).filter((message) =>
    message['kind'] === 'command.v2' && message['type'] === type,
  );
}

async function expectVisibleTokenPrint(page: Page, playerId: string, instanceId: string, name: string): Promise<void> {
  const card = page.locator(
    `[data-testid="game-card"][data-zone="battlefield"][data-owner-player-id="${playerId}"][data-card-instance-id="${instanceId}"]`,
  );
  await expect(card).toBeVisible({ timeout: POLL_TIMEOUT });
  await expect(card).toHaveAttribute('data-card-name', name, { timeout: POLL_TIMEOUT });
  const image = card.locator('img').first();
  await expect(image).toBeVisible({ timeout: POLL_TIMEOUT });
  const src = await image.getAttribute('src');
  expect(src ?? '').not.toBe('');
  expect(src ?? '').not.toContain('facedown_card');
}

function assertNoRuntimeResyncOrErrors(audits: readonly BrowserAudit[], patches: readonly JsonObject[]): void {
  const resyncFrames = audits.flatMap((audit) =>
    audit.received.filter((message) => message['kind'] === 'resync_required'),
  );
  const legacyPatchFrames = audits.flatMap((audit) =>
    audit.received.filter((message) => message['kind'] === 'game_patch'),
  );
  expect(resyncFrames, 'unexpected resync_required websocket frames').toEqual([]);
  expect(legacyPatchFrames, 'unexpected legacy game_patch websocket frames').toEqual([]);
  expect(audits.flatMap((audit) => audit.resyncSignals), 'unexpected resync/refetch/snapshot console signals').toEqual([]);
  expect(audits.flatMap((audit) => audit.consoleErrors), 'unexpected console errors').toEqual([]);
  expect(audits.flatMap((audit) => audit.pageErrors), 'unexpected page errors').toEqual([]);
  expect(audits.flatMap((audit) => audit.websocketErrors), 'unexpected websocket errors').toEqual([]);
  expect(audits.flatMap((audit) => audit.serverErrors), 'unexpected server errors').toEqual([]);
  expect(JSON.stringify(patches), 'unexpected snapshot_reload marker in token patches').not.toContain('snapshot_reload');
}

function hasTokenCardImage(card: TokenCard): boolean {
  return Object.values(card.imageUris ?? {}).some((value) => typeof value === 'string' && value.trim() !== '')
    || (card.cardFaces ?? []).some((face) => Object.values(face.imageUris ?? {}).some((value) =>
      typeof value === 'string' && value.trim() !== '',
    ));
}

function hasRenderableStaticImage(card: JsonObject | null): boolean {
  if (!card) {
    return false;
  }
  const imageUris = isRecord(card['imageUris']) ? card['imageUris'] : {};
  if (Object.values(imageUris).some((value) => typeof value === 'string' && value.trim() !== '')) {
    return true;
  }
  const faces = Array.isArray(card['cardFaces']) ? card['cardFaces'] : [];
  return faces.some((face) => {
    const faceImages = isRecord(face) && isRecord(face['imageUris']) ? face['imageUris'] : {};
    return Object.values(faceImages).some((value) => typeof value === 'string' && value.trim() !== '');
  });
}

function isRuntimeWebSocket(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.pathname === '/ws' || parsed.pathname.endsWith('/ws');
  } catch {
    return url.includes('/ws?');
  }
}

function parseFrame(payload: string | Buffer): JsonObject | null {
  try {
    const text = typeof payload === 'string' ? payload : payload.toString('utf8');
    const parsed = JSON.parse(text) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
