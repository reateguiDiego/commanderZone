import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { expect, test, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';
import { authStorageState } from './support/auth';
import { createCommanderGameWithBasicDecks, resolveGameToPlaying } from './support/commander-game';
import { sendRuntimeCommand } from './support/runtime-websocket';

const API = process.env['E2E_API_BASE_URL'] ?? 'http://127.0.0.1:8000';
const execFileAsync = promisify(execFile);
type Json = Record<string, unknown>;
type Setup = Awaited<ReturnType<typeof createCommanderGameWithBasicDecks>>;

test.describe('dynamic power toughness authoritative gate', () => {
  test.describe.configure({ mode: 'serial' });
  let setup: Setup;
  let formulaTokenId = '';
  let expectedVersion = 0;

  test.beforeAll(async ({ request }) => {
    test.setTimeout(240_000);
    setup = await createCommanderGameWithBasicDecks(request, {
      runId: `dynamicpt${Date.now().toString(36)}`,
      playerAPrefix: 'dynamicpta',
      playerBPrefix: 'dynamicptb',
    });
    await resolveGameToPlaying(request, setup.gameId, [setup.playerA, setup.playerB]);
  });

  test('formula, explicit zero, decimals, counters, retry, clear, refresh and viewer projection stay coherent', async ({ browser, request, baseURL }) => {
    test.setTimeout(300_000);
    if (!baseURL) throw new Error('Playwright baseURL is required.');
    const initial = await snapshot(request, setup.gameId, setup.playerA.token);
    let version = Number(initial['version'] ?? 1);
    const created = await command(request, {
      gameId: setup.gameId,
      token: setup.playerA.token,
      baseVersion: version,
      type: 'card.token.created',
      payload: {
        playerId: setup.playerA.user.id,
        quantity: 1,
        card: { name: 'Dynamic Formula Token', typeLine: 'Token Creature', power: '*', toughness: '1+*' },
      },
    });
    version = created.version;
    formulaTokenId = String((operation(created.patch, 'zone.cards.add')?.['cards'] as Json[])[0]?.['instanceId'] ?? '');
    expect(formulaTokenId).not.toBe('');
    const createdCard = (operation(created.patch, 'zone.cards.add')?.['cards'] as Json[])[0]!;
    expect(createdCard['printedStats'], JSON.stringify(createdCard)).toBeDefined();
    expect(((createdCard['printedStats'] as Record<string, Json>)['0'])['power']).toBe('*');
    expect(createdCard['manualOverrides']).toBeNull();

    const contexts = await Promise.all([setup.playerA, setup.playerB].map((player) => browser.newContext({
      baseURL,
      storageState: authStorageState(baseURL, player.user, player.refreshToken),
    })));
    const pages: Page[] = [];
    const frames: Json[][] = [];
    try {
      for (const context of contexts) {
        await context.addInitScript(() => localStorage.setItem('commanderzone.gameplayV2FrontendEnabled', '1'));
        const page = await context.newPage();
        pages.push(page);
        frames.push(collectFrames(page));
      }
      await Promise.all(pages.map((page) => page.goto(`/games/${setup.gameId}`)));
      await Promise.all(pages.map((page) => expect(page.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 })));
      await expect(stats(pages[0]!, setup.playerA.user.id, formulaTokenId)).toHaveText(['*', '1+*'], { timeout: 20_000 });

      await stats(pages[0]!, setup.playerA.user.id, formulaTokenId).first().click();
      await expect(pages[0]!.locator('.table-error')).toContainText('Set a numeric override', { timeout: 10_000 });
      expect(Number((await snapshot(request, setup.gameId, setup.playerA.token))['version'])).toBe(version);
      await expect(stats(pages[0]!, setup.playerA.user.id, formulaTokenId)).toHaveText(['*', '1+*']);

      const setZero = await command(request, {
        gameId: setup.gameId, token: setup.playerA.token, baseVersion: version,
        type: 'card.stats.override.set', clientActionId: `pt-zero-${Date.now()}`,
        payload: { playerId: setup.playerA.user.id, instanceId: formulaTokenId, faceIndex: 0, power: 0, toughness: 0 },
      });
      version = setZero.version;
      expect(operation(setZero.patch, 'card.stats.override.set')?.['override']).toMatchObject({ power: 0, toughness: 0 });
      await expect(stats(pages[0]!, setup.playerA.user.id, formulaTokenId)).toHaveText(['0', '0'], { timeout: 20_000 });

      const counter = await command(request, {
        gameId: setup.gameId, token: setup.playerA.token, baseVersion: version,
        type: 'card.counter.changed',
        payload: { playerId: setup.playerA.user.id, instanceId: formulaTokenId, counter: '+1/+1', value: 1 },
      });
      version = counter.version;
      expect(operation(counter.patch, 'card.counters.patch')).not.toHaveProperty('power');
      expect(operation(counter.patch, 'card.counters.patch')).not.toHaveProperty('toughness');
      await expect(stats(pages[0]!, setup.playerA.user.id, formulaTokenId)).toHaveText(['1', '1'], { timeout: 20_000 });

      const retryId = `pt-decimal-retry-${Date.now()}`;
      const decimal = await command(request, {
        gameId: setup.gameId, token: setup.playerA.token, baseVersion: version,
        type: 'card.stats.override.set', clientActionId: retryId,
        payload: { playerId: setup.playerA.user.id, instanceId: formulaTokenId, faceIndex: 0, power: 1.5 },
      });
      version = decimal.version;
      const duplicate = await command(request, {
        gameId: setup.gameId, token: setup.playerA.token, baseVersion: version,
        type: 'card.stats.override.set', clientActionId: retryId,
        payload: { playerId: setup.playerA.user.id, instanceId: formulaTokenId, faceIndex: 0, power: 1.5 },
      });
      expect(duplicate.version).toBe(version);
      await expect(stats(pages[0]!, setup.playerA.user.id, formulaTokenId)).toHaveText(['2.5', '1'], { timeout: 20_000 });

      const cleared = await command(request, {
        gameId: setup.gameId, token: setup.playerA.token, baseVersion: version,
        type: 'card.stats.override.clear',
        payload: { playerId: setup.playerA.user.id, instanceId: formulaTokenId, faceIndex: 0, axes: ['power', 'toughness'] },
      });
      version = cleared.version;
      expect(operation(cleared.patch, 'card.stats.override.clear')?.['override']).toEqual({});
      await expect(stats(pages[0]!, setup.playerA.user.id, formulaTokenId)).toHaveText(['*', '1+*'], { timeout: 20_000 });

      const numericCreated = await command(request, {
        gameId: setup.gameId, token: setup.playerA.token, baseVersion: version,
        type: 'card.token.created',
        payload: { playerId: setup.playerA.user.id, quantity: 1, card: { name: 'Numeric Token', typeLine: 'Token Creature', power: '2', toughness: '3' } },
      });
      version = numericCreated.version;
      const numericTokenId = String((operation(numericCreated.patch, 'zone.cards.add')?.['cards'] as Json[])[0]?.['instanceId'] ?? '');
      await expect(stats(pages[0]!, setup.playerA.user.id, numericTokenId)).toHaveText(['2', '3'], { timeout: 20_000 });
      await stats(pages[0]!, setup.playerA.user.id, numericTokenId).first().click();
      await expect.poll(async () => {
        const current = await snapshot(request, setup.gameId, setup.playerA.token);
        return battlefieldCard(current, setup.playerA.user.id, numericTokenId)['power'];
      }, { timeout: 20_000 }).toBe(3);
      const numericAfterQuick = await snapshot(request, setup.gameId, setup.playerA.token);
      version = Number(numericAfterQuick['version']);
      const numericCard = battlefieldCard(numericAfterQuick, setup.playerA.user.id, numericTokenId);
      expect(numericCard['toughness']).toBe(3);
      expect(((numericCard['manualOverrides'] as Record<string, Json>)['0'])['power']).toBe(3);
      expect(((numericCard['manualOverrides'] as Record<string, Json>)['0'])).not.toHaveProperty('toughness');

      const live = await snapshot(request, setup.gameId, setup.playerA.token);
      const token = battlefieldCard(live, setup.playerA.user.id, formulaTokenId);
      expect(token['manualOverrides'] ?? []).toEqual([]);
      expect(token['counters']).toMatchObject({ '+1/+1': 1 });
      expect(token['power']).toBe('*');
      expect(token['toughness']).toBe('1+*');
      await Promise.all(pages.map((page) => page.reload()));
      await Promise.all(pages.map((page) => expect(page.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 })));
      await expect(stats(pages[0]!, setup.playerA.user.id, formulaTokenId)).toHaveText(['*', '1+*'], { timeout: 20_000 });
      for (const page of pages) await expect(page.locator('body')).not.toContainText('Unknown Card');
      for (const received of frames) assertClean(received);
      expectedVersion = version;
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
    }
  });

  test('actor restart replays printed formula, cleared override and independent counters', async ({ request }) => {
    test.setTimeout(180_000);
    await execFileAsync('docker', ['compose', 'restart', 'game-runtime'], {
      cwd: resolve(process.cwd(), '..'), timeout: 60_000, windowsHide: true,
    });
    await expect.poll(async () => (await request.get(`${API}/healthz`)).ok(), { timeout: 60_000 }).toBe(true);
    const rebuilt = await snapshot(request, setup.gameId, setup.playerA.token);
    expect(rebuilt['version']).toBe(expectedVersion);
    const token = battlefieldCard(rebuilt, setup.playerA.user.id, formulaTokenId);
    expect(token['power']).toBe('*');
    expect(token['toughness']).toBe('1+*');
    expect(token['manualOverrides'] ?? []).toEqual([]);
    expect(token['counters']).toMatchObject({ '+1/+1': 1 });
  });

  test('symbolic values, DFC faces, copy provenance, private identity and rejection remain non-destructive', async ({ request }) => {
    test.setTimeout(240_000);
    let current = await snapshot(request, setup.gameId, setup.playerA.token);
    let version = Number(current['version']);

    const symbolic = await command(request, {
      gameId: setup.gameId, token: setup.playerA.token, baseVersion: version,
      type: 'card.token.created',
      payload: { playerId: setup.playerA.user.id, quantity: 1, card: { name: 'Symbolic Token', typeLine: 'Token Creature', power: '?', toughness: '∞' } },
    });
    version = symbolic.version;
    const symbolicCard = (operation(symbolic.patch, 'zone.cards.add')?.['cards'] as Json[])[0]!;
    expect(((symbolicCard['printedStats'] as Record<string, Json>)['0'])['power']).toBe('?');
    expect(((symbolicCard['printedStats'] as Record<string, Json>)['0'])['toughness']).toBe('∞');
    expect(JSON.stringify(symbolic.patch)).not.toContain('NaN');

    const dfcCreated = await command(request, {
      gameId: setup.gameId, token: setup.playerA.token, baseVersion: version,
      type: 'card.token.created',
      payload: {
        playerId: setup.playerA.user.id,
        quantity: 1,
        card: {
          name: 'Variable Front // Numeric Back', typeLine: 'Token Creature', power: '*', toughness: '*',
          cardFaces: [
            { name: 'Variable Front', power: '*', toughness: '*' },
            { name: 'Numeric Back', power: '2', toughness: '3' },
          ],
        },
      },
    });
    version = dfcCreated.version;
    const dfcCard = (operation(dfcCreated.patch, 'zone.cards.add')?.['cards'] as Json[])[0]!;
    const dfcId = String(dfcCard['instanceId']);
    expect(((dfcCard['printedStats'] as Record<string, Json>)['0'])['power']).toBe('*');
    expect(((dfcCard['printedStats'] as Record<string, Json>)['1'])['power']).toBe('2');

    version = (await command(request, {
      gameId: setup.gameId, token: setup.playerA.token, baseVersion: version,
      type: 'card.stats.override.set',
      payload: { playerId: setup.playerA.user.id, instanceId: dfcId, faceIndex: 0, power: 4 },
    })).version;
    version = (await command(request, {
      gameId: setup.gameId, token: setup.playerA.token, baseVersion: version,
      type: 'card.face.changed',
      payload: { playerId: setup.playerA.user.id, instanceId: dfcId, faceIndex: 1 },
    })).version;
    version = (await command(request, {
      gameId: setup.gameId, token: setup.playerA.token, baseVersion: version,
      type: 'card.stats.override.set',
      payload: { playerId: setup.playerA.user.id, instanceId: dfcId, faceIndex: 1, toughness: 5 },
    })).version;
    version = (await command(request, {
      gameId: setup.gameId, token: setup.playerA.token, baseVersion: version,
      type: 'card.face.changed',
      payload: { playerId: setup.playerA.user.id, instanceId: dfcId, faceIndex: 0 },
    })).version;
    current = await snapshot(request, setup.gameId, setup.playerA.token);
    const dfcAfterFlip = battlefieldCard(current, setup.playerA.user.id, dfcId);
    expect(dfcAfterFlip['activeFaceIndex']).toBe(0);
    expect(((dfcAfterFlip['manualOverrides'] as Record<string, Json>)['0'])['power']).toBe(4);
    expect(((dfcAfterFlip['manualOverrides'] as Record<string, Json>)['1'])['toughness']).toBe(5);

    const copied = await command(request, {
      gameId: setup.gameId, token: setup.playerA.token, baseVersion: version,
      type: 'card.token_copy.created',
      payload: { playerId: setup.playerA.user.id, instanceId: dfcId, targetPlayerId: setup.playerA.user.id },
    });
    version = copied.version;
    const copiedCard = (operation(copied.patch, 'zone.cards.add')?.['cards'] as Json[])[0]!;
    expect(copiedCard['manualOverrides'] ?? null).toBeNull();
    expect(((copiedCard['printedStats'] as Record<string, Json>)['0'])['provenance']).toBe('copy_effect');
    expect(((copiedCard['printedStats'] as Record<string, Json>)['0'])['power']).toBe('*');

    current = await snapshot(request, setup.gameId, setup.playerA.token);
    const ownerState = (current['players'] as Record<string, Json>)[setup.playerA.user.id]!;
    const hand = (ownerState['zones'] as Record<string, Json[]>)['hand']!;
    const privateSource = hand[0];
    expect(privateSource).toBeDefined();
    const privateCopy = await command(request, {
      gameId: setup.gameId, token: setup.playerA.token, baseVersion: version,
      type: 'card.token_copy.created',
      payload: { playerId: setup.playerA.user.id, instanceId: String(privateSource!['instanceId']), targetPlayerId: setup.playerA.user.id },
    });
    version = privateCopy.version;
    const privateCopyCard = (operation(privateCopy.patch, 'zone.cards.add')?.['cards'] as Json[])[0]!;
    expect(privateCopyCard['name']).toBe('Token Copy');
    if (typeof privateSource!['cardKey'] === 'string' && privateSource!['cardKey'] !== '') {
      expect(JSON.stringify(privateCopy.patch)).not.toContain(String(privateSource!['cardKey']));
    }

    await expect(sendRuntimeCommand(request, {
      gameId: setup.gameId, token: setup.playerB.token, baseVersion: version,
      type: 'card.stats.override.set',
      payload: { playerId: setup.playerA.user.id, instanceId: dfcId, faceIndex: 0, power: 99 },
    })).rejects.toThrow();
    const afterRejection = await snapshot(request, setup.gameId, setup.playerA.token);
    expect(afterRejection['version']).toBe(version);
    expect(((battlefieldCard(afterRejection, setup.playerA.user.id, dfcId)['manualOverrides'] as Record<string, Json>)['0'])['power']).toBe(4);
  });
});

async function command(request: APIRequestContext, options: Parameters<typeof sendRuntimeCommand>[1]) {
  const result = await sendRuntimeCommand(request, options);
  expect(result.patch['kind']).toBe('patch.v2');
  return result;
}

async function snapshot(request: APIRequestContext, gameId: string, token: string): Promise<Json> {
  const response = await request.get(`${API}/games/${gameId}/snapshot`, { headers: { Authorization: `Bearer ${token}` } });
  expect(response.ok()).toBe(true);
  const payload = await response.json() as { game?: { snapshot?: Json } };
  return payload.game?.snapshot ?? {};
}

function operation(patch: Json, name: string): Json | null {
  return ((patch['ops'] as Json[] | undefined) ?? []).find((op) => op['op'] === name) ?? null;
}

function battlefieldCard(snapshot: Json, playerId: string, instanceId: string): Json {
  const player = (snapshot['players'] as Record<string, Json>)[playerId];
  const zones = player['zones'] as Record<string, Json[]>;
  const card = zones['battlefield'].find((candidate) => candidate['instanceId'] === instanceId);
  if (!card) throw new Error(`Missing battlefield card ${instanceId}`);
  return card;
}

function stats(page: Page, playerId: string, instanceId: string) {
  return page.locator(`[data-testid="game-card"][data-zone="battlefield"][data-owner-player-id="${playerId}"][data-card-instance-id="${instanceId}"] .power-toughness-overlay span`);
}

function collectFrames(page: Page): Json[] {
  const frames: Json[] = [];
  page.on('websocket', (socket) => socket.on('framereceived', ({ payload }) => {
    try { frames.push(JSON.parse(String(payload)) as Json); } catch { /* binary/ping */ }
  }));
  return frames;
}

function assertClean(frames: Json[]): void {
  expect(frames.some((frame) => frame['kind'] === 'game_patch')).toBe(false);
  expect(frames.some((frame) => frame['kind'] === 'resync_required' || frame['status'] === 'resync_required')).toBe(false);
  expect(frames.some((frame) => frame['kind'] === 'command_failed')).toBe(false);
}
