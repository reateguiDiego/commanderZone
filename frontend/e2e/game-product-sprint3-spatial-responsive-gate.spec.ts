import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { authStorageState, createRealUserSession } from './support/auth';
import { resolveGameToPlaying } from './support/commander-game';
import { createBasicCommanderDeckFromDatabase } from './support/decks';
import { openChat } from './support/game-table';
import { sendRuntimeCommand, type RuntimeWebSocketCommandResult } from './support/runtime-websocket';

const API_BASE_URL = process.env['E2E_API_BASE_URL'] ?? 'http://127.0.0.1:8000';
const BATTLEFIELD_ZOOM_STORAGE_KEY = 'commanderZone.gameTable.battlefieldZoomPercent';
const RESPONSIVE_STATES = ['normal', 'compact', 'aggressive', 'minimal'] as const;
const COLOR_ORDER = ['W', 'U', 'B', 'R', 'G', 'C'] as const;
const execFileAsync = promisify(execFile);

type JsonObject = Record<string, unknown>;
type ResponsiveState = (typeof RESPONSIVE_STATES)[number];
type IdentityFixture = 'white-dfc' | 'ur' | 'wubrg' | 'colorless' | 'partners';
type RatioPosition = { x: number; y: number; unit: 'ratio' };
type Player = Awaited<ReturnType<typeof createRealUserSession>> & {
  deckId: string;
  expectedIdentity: string[];
};
type Setup = { gameId: string; players: Player[] };
type DenseFixture = {
  version: number;
  targetId: string;
  attachmentIds: string[];
  stackIds: string[];
  faceDownId: string;
  freeIds: [string, string];
};
type BrowserAudit = {
  sentCommands: JsonObject[];
  receivedFrames: JsonObject[];
  recoveryRequests: number;
  errors: string[];
};

const SCENARIOS: ReadonlyArray<{
  players: 2 | 3 | 4 | 5 | 6;
  viewport: { width: number; height: number };
  state: ResponsiveState;
  battlefieldZoom: 70 | 100 | 140;
  identity: IdentityFixture;
  attachments: 1 | 2 | 5;
  stackMembers: 2 | 4 | 8;
}> = [
  { players: 2, viewport: { width: 1600, height: 1000 }, state: 'normal', battlefieldZoom: 70, identity: 'white-dfc', attachments: 1, stackMembers: 2 },
  { players: 3, viewport: { width: 1280, height: 800 }, state: 'compact', battlefieldZoom: 100, identity: 'ur', attachments: 2, stackMembers: 4 },
  { players: 4, viewport: { width: 1050, height: 680 }, state: 'aggressive', battlefieldZoom: 140, identity: 'wubrg', attachments: 5, stackMembers: 4 },
  { players: 5, viewport: { width: 850, height: 600 }, state: 'minimal', battlefieldZoom: 70, identity: 'colorless', attachments: 2, stackMembers: 4 },
  { players: 6, viewport: { width: 900, height: 600 }, state: 'minimal', battlefieldZoom: 140, identity: 'partners', attachments: 5, stackMembers: 8 },
];

test.describe('Gameplay 1.0 Sprint 3E integrated spatial, relations and responsive release gate', () => {
  test.describe.configure({ mode: 'serial' });

  for (const scenario of SCENARIOS) {
    test(`${scenario.players}P integrates ${scenario.state}, ${scenario.attachments} attachments and stack ${scenario.stackMembers}`, async ({ browser, request, baseURL }) => {
      test.setTimeout(900_000);
      if (!baseURL) throw new Error('Playwright baseURL is required.');
      await assertServicesAndMetrics(request);

      const setup = await createGame(request, scenario.players, scenario.identity);
      const contexts = await createContexts(browser, baseURL, setup, scenario.viewport, scenario.battlefieldZoom);
      const pages = await Promise.all(contexts.map((context) => context.newPage()));
      const audits = pages.map((page) => auditPage(page, setup.gameId));

      try {
        if (scenario.players === 2) {
          await Promise.all(pages.map((page) => page.goto(`/games/${setup.gameId}`)));
          await Promise.all(pages.map((page) => expect(page.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 })));
          await assertMulliganAcrossFourStates(pages[0]!);
          await resolveGameToPlaying(request, setup.gameId, setup.players);
          await expect(pages[0]!.getByTestId('mulligan-overlay')).toBeHidden({ timeout: 30_000 });
          await pages[0]!.setViewportSize(scenario.viewport);
        } else {
          await resolveGameToPlaying(request, setup.gameId, setup.players);
        }

        const fixture = await seedDenseFixture(request, setup, scenario);
        if (scenario.players === 2) {
          await Promise.all(pages.map((page) => page.reload()));
        } else {
          await Promise.all(pages.map((page) => page.goto(`/games/${setup.gameId}`)));
        }
        await Promise.all(pages.map((page) => expect(page.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 })));
				await expectStablePresence(request, setup, pages);
        await Promise.all(pages.map((page) => focusPlayerById(page, setup.players[0]!.user.id)));

        await assertResponsiveSurface(pages[0]!, scenario.state, scenario.players);
        await assertOpponentPanels(pages[0]!, scenario.players);
        await assertClosedOpponentsDrawerDoesNotInterceptChat(pages[0]!);
        await assertManaHelper(pages[0]!, canonicalIdentity(setup.players[0]!.expectedIdentity));
        await assertDenseCards(pages, setup.players[0]!.user.id, fixture);
        await assertIdenticalSharedState(request, setup, fixture);
        await assertPrivacy(request, setup, fixture.faceDownId);
        await assertZoneModalFits(pages[0]!);

        const layoutBaseline = layoutMutationCommands(audits[0]!.sentCommands).length;
        const recoveryBaseline = audits[0]!.recoveryRequests;
        const sharedBeforeLayout = await canonicalSharedState(request, setup, fixture);
        await setBattlefieldZoom(pages[0]!, scenario.battlefieldZoom);
        await assertResponsiveSurface(pages[0]!, scenario.state, scenario.players);
        expect(await canonicalSharedState(request, setup, fixture)).toEqual(sharedBeforeLayout);
        expect(layoutMutationCommands(audits[0]!.sentCommands)).toHaveLength(layoutBaseline);
        expect(audits[0]!.recoveryRequests).toBe(recoveryBaseline);

        let version = fixture.version;
        const accepted = async (
          actorIndex: number,
          type: string,
          payload: JsonObject,
          clientActionId?: string,
        ): Promise<RuntimeWebSocketCommandResult> => {
          const result = await sendRuntimeCommand(request, {
            gameId: setup.gameId,
            token: setup.players[actorIndex]!.token,
            baseVersion: version,
            type,
            payload,
            ...(clientActionId ? { clientActionId } : {}),
          });
          version = result.version;
          await waitForSnapshotVersion(request, setup.gameId, setup.players[0]!.token, version);
          await assertPatchOnAllViewers(audits, result.clientActionId, version);
          return result;
        };

        const counterResult = await accepted(0, 'card.counter.changed', {
          playerId: setup.players[0]!.user.id,
          instanceId: fixture.targetId,
          counter: 'shield',
          value: 10,
        });
        expect(operation(counterResult.patch, 'card.counters.patch')).not.toHaveProperty('power');
        expect(operation(counterResult.patch, 'card.counters.patch')).not.toHaveProperty('toughness');
        await assertFiveCounters(pages[0]!, fixture.targetId, true, 10);
        await assertFiveCounters(pages[1]!, fixture.targetId, false, 10);

        if (scenario.players === 2) {
          version = await assertUiSingleAndBatchDrag(request, setup, pages, audits, fixture, version);
        }
        if (scenario.players === 3) {
          version = await assertControllerChangeAndAtomicRejection(request, setup, fixture, version, audits);
        }
        if (scenario.players === 4) {
          version = await assertAttachmentReorderAndIdempotence(request, setup, fixture, version, audits);
        }
        if (scenario.players === 5) {
          version = await assertStackReorderAndDetach(request, setup, fixture, version, audits);
        }
        if (scenario.players === 6) {
          version = await assertResponsiveTransitionsAndDraft(pages[0]!, setup, fixture, request, audits[0]!, version);
          await assertRefreshReconnectRestart(request, setup, contexts, pages, audits, fixture, version);
        }

        for (const page of pages) {
          await expect(page.locator('body')).not.toContainText('Unknown Card');
          await expectNoGlobalOverflow(page);
        }
        for (const audit of audits) assertCleanAudit(audit);
      } finally {
        await Promise.all(contexts.map((context) => context.close().catch(() => undefined)));
      }
    });
  }

  test('manual native Chrome matrix is certified externally at 80/100/125/150 with BF 70/100/140', async () => {
    test.skip(process.env['E2E_MANUAL_SPRINT3_ZOOM'] !== '1', 'Run headed with native Chrome controls; viewport emulation is not accepted.');
  });
});

async function seedDenseFixture(
  request: APIRequestContext,
  setup: Setup,
  scenario: (typeof SCENARIOS)[number],
): Promise<DenseFixture> {
  const initial = await gameSnapshot(request, setup.gameId, setup.players[0]!.token);
  const playerId = setup.players[0]!.user.id;
  let version = Number(initial['version'] ?? 1);

  const created = await sendRuntimeCommand(request, {
    gameId: setup.gameId,
    token: setup.players[0]!.token,
    baseVersion: version,
    type: 'card.token.created',
    payload: {
      playerId,
      quantity: 1,
      card: { name: 'Sprint 3 Integrated Formula', typeLine: 'Token Creature', power: '*', toughness: '1+*' },
    },
  });
  version = created.version;
  const targetId = String((operation(created.patch, 'zone.cards.add')?.['cards'] as JsonObject[] | undefined)?.[0]?.['instanceId'] ?? '');
  expect(targetId).not.toBe('');

  version = (await sendRuntimeCommand(request, {
    gameId: setup.gameId,
    token: setup.players[0]!.token,
    baseVersion: version,
    type: 'card.position.changed',
    payload: { playerId, zone: 'battlefield', instanceId: targetId, position: ratio(0.18, 0.3) },
  })).version;
  version = (await sendRuntimeCommand(request, {
    gameId: setup.gameId,
    token: setup.players[0]!.token,
    baseVersion: version,
    type: 'card.stats.override.set',
    payload: { playerId, instanceId: targetId, faceIndex: 0, power: 4, toughness: 5 },
  })).version;

  for (const counter of [
    { counter: '+1/+1', value: 1 },
    { counter: 'shield', value: 9 },
    { counter: 'charge', value: 10 },
    { counter: 'quest progress', value: 99 },
    { counter: 'red', value: 100 },
  ]) {
    version = (await sendRuntimeCommand(request, {
      gameId: setup.gameId,
      token: setup.players[0]!.token,
      baseVersion: version,
      type: 'card.counter.changed',
      payload: { playerId, instanceId: targetId, ...counter },
    })).version;
  }

  const needed = scenario.attachments + scenario.stackMembers + 4;
  const sources = [
    ...zoneIds(initial, playerId, 'hand').map((instanceId) => ({ instanceId, fromZone: 'hand' })),
    ...zoneIds(initial, playerId, 'library').map((instanceId) => ({ instanceId, fromZone: 'library' })),
  ].slice(0, needed);
  expect(sources).toHaveLength(needed);
  for (const [index, source] of sources.entries()) {
    const column = index % 6;
    const row = Math.floor(index / 6);
    const isZoneModalCard = index === sources.length - 1;
    version = (await sendRuntimeCommand(request, {
      gameId: setup.gameId,
      token: setup.players[0]!.token,
      baseVersion: version,
      type: 'card.moved',
      payload: {
        playerId,
        fromZone: source.fromZone,
        toZone: isZoneModalCard ? 'graveyard' : 'battlefield',
        instanceId: source.instanceId,
        ...(!isZoneModalCard ? { position: ratio(0.32 + column * 0.1, 0.18 + row * 0.34) } : {}),
      },
    })).version;
  }

  const attachmentIds = sources.slice(0, scenario.attachments).map((source) => source.instanceId);
  const stackIds = sources.slice(scenario.attachments, scenario.attachments + scenario.stackMembers).map((source) => source.instanceId);
  const faceDownId = sources.at(-4)!.instanceId;
  const freeIds = [sources.at(-3)!.instanceId, sources.at(-2)!.instanceId] as [string, string];

  for (const attachmentId of attachmentIds) {
    version = (await sendRuntimeCommand(request, {
      gameId: setup.gameId,
      token: setup.players[0]!.token,
      baseVersion: version,
      type: 'attachment.created',
      payload: { equipmentInstanceId: attachmentId, attachedToInstanceId: targetId },
    })).version;
  }
  version = (await sendRuntimeCommand(request, {
    gameId: setup.gameId,
    token: setup.players[0]!.token,
    baseVersion: version,
    type: 'battlefield.stack.created',
    payload: { orderedInstanceIds: stackIds, rootInstanceId: stackIds[0], stackKind: 'land' },
  })).version;
  version = (await sendRuntimeCommand(request, {
    gameId: setup.gameId,
    token: setup.players[0]!.token,
    baseVersion: version,
    type: 'card.face_down.changed',
    payload: { playerId, instanceId: faceDownId, faceDown: true },
  })).version;
  if (scenario.players >= 4) {
    version = (await sendRuntimeCommand(request, {
      gameId: setup.gameId,
      token: setup.players[0]!.token,
      baseVersion: version,
      type: 'card.tapped',
      payload: { playerId, instanceId: targetId, tapped: true },
    })).version;
  }

  return { version, targetId, attachmentIds, stackIds, faceDownId, freeIds };
}

async function assertUiSingleAndBatchDrag(
  request: APIRequestContext,
  setup: Setup,
  pages: Page[],
  audits: BrowserAudit[],
  fixture: DenseFixture,
  version: number,
): Promise<number> {
  const ownerId = setup.players[0]!.user.id;
  const single = await dragAndWaitForSpatialCommand(pages[0]!, audits[0]!, ownerId, fixture.freeIds[0], ratio(0.44, 0.42), 'card.position.changed');
  assertCanonicalSpatialCommand(single, 'card.position.changed');
  version += 1;
  await waitForSnapshotVersion(request, setup.gameId, setup.players[0]!.token, version);
  await assertPatchOnAllViewers(audits, String(single['clientActionId']), version);

  await pages[0]!.keyboard.press('Escape');
  for (const instanceId of fixture.freeIds) {
    await battlefieldCard(pages[0]!, ownerId, instanceId).click({ modifiers: ['Shift'] });
    await expect(battlefieldCard(pages[0]!, ownerId, instanceId)).toHaveClass(/selected/);
  }
  const batch = await dragAndWaitForSpatialCommand(pages[0]!, audits[0]!, ownerId, fixture.freeIds[0], ratio(0.58, 0.88), 'cards.position.changed');
  assertCanonicalSpatialCommand(batch, 'cards.position.changed');
  version += 1;
  await waitForSnapshotVersion(request, setup.gameId, setup.players[0]!.token, version);
  await assertPatchOnAllViewers(audits, String(batch['clientActionId']), version);
  await pages[0]!.keyboard.press('Escape');
  return version;
}

async function assertControllerChangeAndAtomicRejection(
  request: APIRequestContext,
  setup: Setup,
  fixture: DenseFixture,
  version: number,
  audits: BrowserAudit[],
): Promise<number> {
  const changed = await sendRuntimeCommand(request, {
    gameId: setup.gameId,
    token: setup.players[0]!.token,
    baseVersion: version,
    type: 'card.controller.changed',
    payload: { playerId: setup.players[0]!.user.id, instanceId: fixture.targetId, targetPlayerId: setup.players[1]!.user.id },
  });
  version = changed.version;
  await assertPatchOnAllViewers(audits, changed.clientActionId, version);
  const moved = await sendRuntimeCommand(request, {
    gameId: setup.gameId,
    token: setup.players[1]!.token,
    baseVersion: version,
    type: 'card.position.changed',
    payload: { playerId: setup.players[0]!.user.id, zone: 'battlefield', instanceId: fixture.targetId, position: ratio(0.24, 0.38) },
  });
  version = moved.version;
  await assertPatchOnAllViewers(audits, moved.clientActionId, version);

  const before = await canonicalSharedState(request, setup, fixture);
  await expect(sendRuntimeCommand(request, {
    gameId: setup.gameId,
    token: setup.players[0]!.token,
    baseVersion: version,
    type: 'cards.position.changed',
    payload: {
      playerId: setup.players[0]!.user.id,
      zone: 'battlefield',
      positions: [
        { instanceId: fixture.freeIds[0], position: ratio(0.1, 0.1) },
        { instanceId: fixture.targetId, position: ratio(0.9, 0.9) },
      ],
    },
  })).rejects.toThrow(/MIXED_AUTHORITY|CONTROLLED|AUTHORITY|PERMISSION/);
  expect(await canonicalSharedState(request, setup, fixture)).toEqual(before);
  return version;
}

async function assertAttachmentReorderAndIdempotence(
  request: APIRequestContext,
  setup: Setup,
  fixture: DenseFixture,
  version: number,
  audits: BrowserAudit[],
): Promise<number> {
  let graph = relationGraph(await gameSnapshot(request, setup.gameId, setup.players[0]!.token));
  const order = graph.attachments.map((item) => String(item['id'])).reverse();
  const reordered = await sendRuntimeCommand(request, {
    gameId: setup.gameId,
    token: setup.players[0]!.token,
    baseVersion: version,
    type: 'attachment.reordered',
    payload: { attachedToInstanceId: fixture.targetId, orderedAttachmentIds: order },
  });
  version = reordered.version;
  await assertPatchOnAllViewers(audits, reordered.clientActionId, version);
  graph = relationGraph(await gameSnapshot(request, setup.gameId, setup.players[0]!.token));
  expect(graph.attachments.map((item) => item['id'])).toEqual(order);

  const actionId = `sprint3e-idempotent-${Date.now()}`;
  const first = await sendRuntimeCommand(request, {
    gameId: setup.gameId,
    token: setup.players[0]!.token,
    baseVersion: version,
    type: 'card.stats.override.set',
    payload: { playerId: setup.players[0]!.user.id, instanceId: fixture.targetId, faceIndex: 0, power: 4 },
    clientActionId: actionId,
  });
  version = first.version;
  const duplicate = await sendRuntimeCommand(request, {
    gameId: setup.gameId,
    token: setup.players[0]!.token,
    baseVersion: version,
    type: 'card.stats.override.set',
    payload: { playerId: setup.players[0]!.user.id, instanceId: fixture.targetId, faceIndex: 0, power: 4 },
    clientActionId: actionId,
  });
  expect(duplicate.version).toBe(version);
  return version;
}

async function assertStackReorderAndDetach(
  request: APIRequestContext,
  setup: Setup,
  fixture: DenseFixture,
  version: number,
  audits: BrowserAudit[],
): Promise<number> {
  let graph = relationGraph(await gameSnapshot(request, setup.gameId, setup.players[0]!.token));
  const stackId = String(graph.stacks[0]?.['id']);
  const order = [...fixture.stackIds].reverse();
  const reordered = await sendRuntimeCommand(request, {
    gameId: setup.gameId,
    token: setup.players[0]!.token,
    baseVersion: version,
    type: 'battlefield.stack.reordered',
    payload: { stackId, orderedInstanceIds: order, rootInstanceId: order[0] },
  });
  version = reordered.version;
  await assertPatchOnAllViewers(audits, reordered.clientActionId, version);
  const removedId = order.at(-1)!;
  const removed = await sendRuntimeCommand(request, {
    gameId: setup.gameId,
    token: setup.players[0]!.token,
    baseVersion: version,
    type: 'battlefield.stack.member_removed',
    payload: { stackId, instanceId: removedId, position: ratio(0.72, 0.72) },
  });
  version = removed.version;
  await assertPatchOnAllViewers(audits, removed.clientActionId, version);
  graph = relationGraph(await gameSnapshot(request, setup.gameId, setup.players[0]!.token));
  expect(graph.stacks[0]?.['orderedMemberIds']).not.toContain(removedId);
  expect(findCard(await gameSnapshot(request, setup.gameId, setup.players[0]!.token), removedId)?.['position']).toEqual(ratio(0.72, 0.72));
  return version;
}

async function assertResponsiveTransitionsAndDraft(
  page: Page,
  setup: Setup,
  fixture: DenseFixture,
  request: APIRequestContext,
  audit: BrowserAudit,
  version: number,
): Promise<number> {
  const baseline = await canonicalSharedState(request, setup, fixture);
  const mutationBaseline = layoutMutationCommands(audit.sentCommands).length;
  const transitions = [
    { viewport: { width: 1600, height: 1000 }, state: 'normal' },
    { viewport: { width: 1400, height: 850 }, state: 'compact' },
    { viewport: { width: 1150, height: 700 }, state: 'aggressive' },
    { viewport: { width: 900, height: 600 }, state: 'minimal' },
  ] as const;
  for (const transition of transitions) {
    await page.setViewportSize(transition.viewport);
    await assertResponsiveSurface(page, transition.state, 6);
    await assertManaHelper(page, canonicalIdentity(setup.players[0]!.expectedIdentity));
    await assertFiveCounters(page, fixture.targetId, true, 10);
  }
  await openChat(page);
  await page.getByTestId('chat-input').fill('draft survives responsive transition');
  await page.setViewportSize({ width: 1150, height: 700 });
  await expect(page.getByTestId('chat-input')).toHaveValue('draft survives responsive transition');
  await page.setViewportSize({ width: 460, height: 340 });
  await expect(page.getByTestId('game-screen')).toHaveAttribute('data-responsive-state', 'minimal');
  await expect(page.getByTestId('game-screen')).toHaveAttribute('data-responsive-supported', 'false');
  await expect(page.getByTestId('game-unsupported-resolution-lock')).toBeVisible();
  await page.setViewportSize({ width: 900, height: 600 });
  await expect(page.getByTestId('game-screen')).toHaveAttribute('data-responsive-state', 'minimal');
  expect(await canonicalSharedState(request, setup, fixture)).toEqual(baseline);
  expect(layoutMutationCommands(audit.sentCommands)).toHaveLength(mutationBaseline);
  return version;
}

async function assertRefreshReconnectRestart(
  request: APIRequestContext,
  setup: Setup,
  contexts: BrowserContext[],
  pages: Page[],
  audits: BrowserAudit[],
  fixture: DenseFixture,
  version: number,
): Promise<void> {
  const before = await canonicalSharedState(request, setup, fixture);
  await pages[0]!.reload();
  await expect(pages[0]!.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 });
  await focusPlayerById(pages[0]!, setup.players[0]!.user.id);
  await assertManaHelper(pages[0]!, canonicalIdentity(setup.players[0]!.expectedIdentity));

  await pages[1]!.close();
  pages[1] = await contexts[1]!.newPage();
  audits[1] = auditPage(pages[1]!, setup.gameId);
  await pages[1]!.goto(`/games/${setup.gameId}`);
  await expect(pages[1]!.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 });
  await focusPlayerById(pages[1]!, setup.players[0]!.user.id);

  if (pages[2]) {
    await pages[2].close();
    pages[2] = await contexts[2]!.newPage();
    audits[2] = auditPage(pages[2]!, setup.gameId);
    await pages[2]!.goto(`/games/${setup.gameId}`);
    await expect(pages[2]!.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 });
    await focusPlayerById(pages[2]!, setup.players[0]!.user.id);
  }
  const afterReconnect = await canonicalSharedState(request, setup, fixture);
  expect(canonicalStateWithoutVersion(afterReconnect)).toEqual(canonicalStateWithoutVersion(before));
  expect(Number(afterReconnect['version'] ?? 0)).toBeGreaterThanOrEqual(version);

  await restartRuntime();
  await expect.poll(async () => {
    try { return (await request.get('http://127.0.0.1:8091/readyz')).ok(); } catch { return false; }
  }, { timeout: 60_000 }).toBe(true);
  await Promise.all(pages.map((page) => page.reload()));
  await Promise.all(pages.map((page) => expect(page.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 })));
  await Promise.all(pages.map((page) => focusPlayerById(page, setup.players[0]!.user.id)));
  const afterRestart = await canonicalSharedState(request, setup, fixture);
  expect(canonicalStateWithoutVersion(afterRestart)).toEqual(canonicalStateWithoutVersion(before));
  expect(Number(afterRestart['version'] ?? 0)).toBeGreaterThanOrEqual(Number(afterReconnect['version'] ?? 0));

  const action = await sendRuntimeCommand(request, {
    gameId: setup.gameId,
    token: setup.players[0]!.token,
    baseVersion: Number(afterRestart['version'] ?? version),
    type: 'card.counter.changed',
    payload: { playerId: setup.players[0]!.user.id, instanceId: fixture.targetId, counter: 'shield', value: 11 },
  });
  await waitForSnapshotVersion(request, setup.gameId, setup.players[0]!.token, action.version);
  await assertPatchOnAllViewers(audits, action.clientActionId, action.version);
  await assertFiveCounters(pages[0]!, fixture.targetId, true, 11);
  await assertServicesAndMetrics(request);
}

function canonicalStateWithoutVersion(state: JsonObject): JsonObject {
  const { version: _durablePresenceVersion, ...gameplayState } = state;
  return gameplayState;
}

async function assertResponsiveSurface(page: Page, state: ResponsiveState, playerCount: number): Promise<void> {
  const screen = page.getByTestId('game-screen');
  await expect(screen).toHaveAttribute('data-responsive-state', state);
  await expect(screen).toHaveAttribute('data-responsive-supported', 'true');
  await expect(screen).toHaveAttribute('data-player-count', String(playerCount));
  expect(RESPONSIVE_STATES).toContain(await screen.getAttribute('data-responsive-state'));
  await expect(page.getByTestId('battlefield-zone')).toBeVisible();
  await expect(page.getByTestId('hand-area')).toBeVisible();
  await expect(page.getByTestId('zone-piles')).toBeVisible();
  await expect(page.getByTestId('player-summary-panel').first()).toBeVisible();
  await expect(page.getByTestId('battlefield-zoom-controls')).toBeVisible();
  await expect(page.getByTestId('mana-helper')).toBeVisible();
  await expect(page.getByTestId('game-unsupported-resolution-lock')).toBeHidden();
  await expectNoGlobalOverflow(page);
}

async function assertMulliganAcrossFourStates(page: Page): Promise<void> {
  for (const entry of [
    { viewport: { width: 1600, height: 1000 }, state: 'normal' },
    { viewport: { width: 1180, height: 820 }, state: 'compact' },
    { viewport: { width: 900, height: 600 }, state: 'aggressive' },
    { viewport: { width: 650, height: 480 }, state: 'minimal' },
  ] as const) {
    await page.setViewportSize(entry.viewport);
    await expect(page.getByTestId('game-screen')).toHaveAttribute('data-responsive-state', entry.state);
    await expect(page.getByTestId('mulligan-overlay')).toBeVisible();
    await expect(page.getByTestId('mulligan-keep')).toBeVisible();
    await expect(page.getByTestId('mulligan-take')).toBeVisible();
    await expectNoGlobalOverflow(page);
  }
}

async function assertOpponentPanels(page: Page, playerCount: number): Promise<void> {
  const drawer = page.getByTestId('opponents-drawer-toggle');
  if (await drawer.isVisible() && await drawer.getAttribute('aria-expanded') !== 'true') await drawer.click();
	if (await drawer.isVisible()) await expect(drawer).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId('opponent-mini-board')).toHaveCount(playerCount - 1);
  const boards = page.getByTestId('opponent-mini-board');
  const visibleBoardCount = await drawer.isVisible() ? await boards.count() : Math.min(1, await boards.count());
  for (let index = 0; index < visibleBoardCount; index += 1) {
    await expect(boards.nth(index)).toBeVisible();
		await expectWithinViewport(page, boards.nth(index));
  }
  if (await drawer.isVisible() && await drawer.getAttribute('aria-expanded') === 'true') {
    await drawer.click();
    await expect(drawer).toHaveAttribute('aria-expanded', 'false');
  }
}

async function assertClosedOpponentsDrawerDoesNotInterceptChat(page: Page): Promise<void> {
  const drawer = page.getByTestId('opponents-drawer-toggle');
  if (await drawer.isVisible() && await drawer.getAttribute('aria-expanded') !== 'false') {
    await drawer.click();
  }
  if (await drawer.isVisible()) await expect(drawer).toHaveAttribute('aria-expanded', 'false');
	if (await drawer.isVisible()) {
		await expect(page.locator('#game-table-opponents-list')).toHaveAttribute('aria-hidden', 'true');
		await expect(page.locator('#game-table-opponents-list')).toHaveAttribute('inert', '');
	}
  await openChat(page);
  const input = page.getByTestId('chat-input');
  await input.fill('');
  const send = page.getByTestId('chat-send');
  await send.click();
  await input.evaluate((element) => (element as HTMLElement).blur());
  await send.evaluate((element) => (element as HTMLElement).blur());
  await page.mouse.move(0, 0);
  await expect(page.getByTestId('chat-panel')).toBeHidden();
}

async function assertManaHelper(page: Page, expectedColors: readonly string[]): Promise<void> {
  const helper = page.getByTestId('mana-helper');
  const battlefield = page.getByTestId('battlefield-zone');
  await expect(helper).toBeVisible();
  await expect(helper).toHaveAttribute('data-mana-helper-orientation', 'vertical');
  const colors = await helper.locator('[data-mana-pool-color]').evaluateAll((buttons) => buttons.map((button) => (button as HTMLElement).dataset['manaPoolColor'] ?? ''));
  expect(colors).toEqual(expectedColors);
  expect(colors.at(-1)).toBe('C');
  const [helperBox, battlefieldBox] = await Promise.all([helper.boundingBox(), battlefield.boundingBox()]);
  expect(helperBox).not.toBeNull();
  expect(battlefieldBox).not.toBeNull();
  expect(Math.abs(helperBox!.x - battlefieldBox!.x)).toBeLessThanOrEqual(18);
  expect(Math.abs((helperBox!.y + helperBox!.height / 2) - (battlefieldBox!.y + battlefieldBox!.height / 2))).toBeLessThanOrEqual(4);
  const hitTargets = await helper.locator('[data-mana-pool-color]').evaluateAll((buttons) => buttons.map((button) => {
    const rect = button.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return hit === button || (hit !== null && button.contains(hit));
  }));
  expect(hitTargets.every(Boolean)).toBe(true);
}

async function assertFiveCounters(page: Page, instanceId: string, interactive: boolean, shieldValue = 9): Promise<void> {
  const card = page.locator(`[data-testid="game-card"][data-card-instance-id="${instanceId}"]`);
  const rail = card.getByTestId('card-counter-rail');
  const markers = rail.locator('[data-counter-key]');
  await expect(card).toBeVisible();
  await expect(rail).toBeVisible();
  await expect(markers).toHaveCount(5);
  await expect(markers.nth(4)).toBeVisible();
  const values = await markers.evaluateAll((items) => items.map((item) => Number((item as HTMLElement).dataset['counterValue'])));
  expect(values).toEqual(expect.arrayContaining([1, shieldValue, 10, 99, 100]));
  for (let index = 0; index < 5; index++) {
    const marker = markers.nth(index);
    const box = await marker.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(20);
    expect(box!.height).toBeGreaterThanOrEqual(20);
    expect(await marker.getAttribute('role')).toBe(interactive ? 'button' : null);
  }
  const stats = card.locator('.power-toughness-overlay span');
  await expect(stats).toHaveCount(2);
  expect((await stats.allTextContents()).join('/')).not.toMatch(/NaN/);
}

async function assertDenseCards(pages: Page[], ownerId: string, fixture: DenseFixture): Promise<void> {
  const ids = [fixture.targetId, ...fixture.attachmentIds, ...fixture.stackIds, fixture.faceDownId, ...fixture.freeIds];
  for (const page of pages) {
    for (const instanceId of ids) {
      const privateFaceDown = page !== pages[0] && instanceId === fixture.faceDownId;
      const card = privateFaceDown ? opaqueBattlefieldShell(page, ownerId) : battlefieldCard(page, ownerId, instanceId);
      if (privateFaceDown) await expect(battlefieldCard(page, ownerId, instanceId)).toHaveCount(0);
      await expect(card).toBeVisible();
      const box = await card.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.width).toBeGreaterThan(12);
      expect(box!.height).toBeGreaterThan(12);
    }
    await assertFiveCounters(page, fixture.targetId, page === pages[0]);
  }
}

async function assertZoneModalFits(page: Page): Promise<void> {
  const graveyard = page.locator('[data-testid="drop-zone"][data-zone="graveyard"]');
  await graveyard.click();
  const modal = page.getByTestId('zone-modal');
  await expect(modal).toBeVisible();
  const box = await modal.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(-1);
  expect(box!.y).toBeGreaterThanOrEqual(-1);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width + 1);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height + 1);
  await page.getByTestId('zone-modal-close').click();
  await expect(modal).toBeHidden();
}

async function assertPrivacy(request: APIRequestContext, setup: Setup, faceDownId: string): Promise<void> {
  for (const viewer of setup.players.slice(1, 3)) {
    const snapshot = await gameSnapshot(request, setup.gameId, viewer.token);
    expect(findCard(snapshot, faceDownId)).toBeUndefined();
    const shell = opaqueBattlefieldSnapshotCard(snapshot, setup.players[0]!.user.id);
    expect(shell?.['faceDown']).toBe(true);
    expect(JSON.stringify(shell)).not.toMatch(/cardKey|cardRef|printId|imageUris|cardFaces|oracleText|printedStats|manualOverrides|viewerMask|socketId|connectionEpoch/i);
  }
}

async function assertIdenticalSharedState(request: APIRequestContext, setup: Setup, fixture: DenseFixture): Promise<void> {
  const states = await Promise.all(setup.players.slice(0, 3).map(async (player) => canonicalSharedState(request, setup, fixture, player.token)));
  for (const state of states.slice(1)) expect(state).toEqual(states[0]);
}

async function canonicalSharedState(request: APIRequestContext, setup: Setup, fixture: DenseFixture, token = setup.players[0]!.token): Promise<JsonObject> {
  const snapshot = await gameSnapshot(request, setup.gameId, token);
  const ids = [fixture.targetId, ...fixture.attachmentIds, ...fixture.stackIds, fixture.faceDownId, ...fixture.freeIds];
  return {
    version: snapshot['version'],
    cards: Object.fromEntries(ids.map((instanceId) => {
      const card = instanceId === fixture.faceDownId
        ? findCard(snapshot, instanceId) ?? opaqueBattlefieldSnapshotCard(snapshot, setup.players[0]!.user.id) ?? {}
        : findCard(snapshot, instanceId) ?? {};
      return [instanceId, {
        position: card['position'],
        controllerId: card['controllerId'],
        counters: card['counters'],
        faceDown: card['faceDown'],
        tapped: card['tapped'],
        power: card['power'] ?? null,
        toughness: card['toughness'] ?? null,
        manualOverrides: Array.isArray(card['manualOverrides']) && card['manualOverrides'].length === 0
          ? null
          : card['manualOverrides'] ?? null,
      }];
    })),
    relations: relationGraph(snapshot),
    turn: snapshot['turn'],
    status: snapshot['status'],
  };
}

function relationGraph(snapshot: JsonObject): { attachments: JsonObject[]; stacks: JsonObject[] } {
  const relations = snapshot['relations'] as JsonObject | undefined;
  return {
    attachments: structuredClone((relations?.['attachments'] ?? snapshot['attachments'] ?? []) as JsonObject[]),
    stacks: structuredClone((relations?.['battlefieldStacks'] ?? snapshot['battlefieldStacks'] ?? []) as JsonObject[]),
  };
}

async function setBattlefieldZoom(page: Page, zoom: 70 | 100 | 140): Promise<void> {
  const controls = page.getByTestId('battlefield-zoom-controls');
  const slider = page.getByTestId('battlefield-zoom-slider');
  if (!(await slider.isVisible())) await controls.locator('button').first().click();
  await slider.evaluate((node, value) => {
    const input = node as HTMLInputElement;
    input.value = String(value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, zoom);
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), BATTLEFIELD_ZOOM_STORAGE_KEY)).toBe(String(zoom));
}

async function dragAndWaitForSpatialCommand(
  page: Page,
  audit: BrowserAudit,
  playerId: string,
  instanceId: string,
  target: RatioPosition,
  expectedType: 'card.position.changed' | 'cards.position.changed',
): Promise<JsonObject> {
  const baseline = spatialCommands(audit.sentCommands).length;
  await dragBattlefieldCardToRatio(page, playerId, instanceId, target);
  await expect.poll(() => spatialCommands(audit.sentCommands).length, { timeout: 20_000 }).toBe(baseline + 1);
  const command = spatialCommands(audit.sentCommands)[baseline]!;
  expect(command['type']).toBe(expectedType);
  return command;
}

async function dragBattlefieldCardToRatio(page: Page, playerId: string, instanceId: string, target: RatioPosition): Promise<void> {
  const card = battlefieldCard(page, playerId, instanceId);
  const battlefield = page.locator(`[data-testid="battlefield-zone"][data-player-id="${playerId}"]`);
  const cardBox = await card.boundingBox();
  if (!cardBox) throw new Error(`Card ${instanceId} has no rendered bounding box.`);
  const pointerOffset = await card.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    for (const offsetY of [0.5, 0.35, 0.65, 0.2, 0.8]) {
      for (const offsetX of [0.5, 0.35, 0.65, 0.2, 0.8]) {
        const hit = document.elementFromPoint(rect.left + rect.width * offsetX, rect.top + rect.height * offsetY);
        if (hit === element || (hit instanceof Node && element.contains(hit))) return { x: rect.width * offsetX, y: rect.height * offsetY };
      }
    }
    throw new Error('Card has no clickable interior point.');
  });
  const content = await battlefield.evaluate((element) => {
    const root = element as HTMLElement;
    const rect = root.getBoundingClientRect();
    const style = getComputedStyle(root);
    const left = Number.parseFloat(style.paddingLeft);
    const right = Number.parseFloat(style.paddingRight);
    const top = Number.parseFloat(style.paddingTop);
    const bottom = Number.parseFloat(style.paddingBottom);
    return { left: rect.left + left, top: rect.top + top, width: root.clientWidth - left - right, height: root.clientHeight - top - bottom };
  });
  const endX = content.left + target.x * Math.max(1, content.width - cardBox.width) + pointerOffset.x;
  const endY = content.top + target.y * Math.max(1, content.height - cardBox.height) + pointerOffset.y;
  await page.mouse.move(cardBox.x + pointerOffset.x, cardBox.y + pointerOffset.y);
  await page.mouse.down();
  await page.mouse.move(endX, endY, { steps: 16 });
  await page.mouse.up();
}

function assertCanonicalSpatialCommand(command: JsonObject, expectedType: 'card.position.changed' | 'cards.position.changed'): void {
  expect(command['kind']).toBe('command.v2');
  expect(command['type']).toBe(expectedType);
  const payload = command['payload'] as JsonObject;
  expect(containsForbiddenSpatialKey(payload)).toBe(false);
  if (expectedType === 'card.position.changed') {
    assertCanonicalRatio(payload['position']);
  } else {
    const positions = payload['positions'] as JsonObject[];
    expect(positions.length).toBeGreaterThan(1);
    for (const item of positions) assertCanonicalRatio(item['position']);
  }
}

function assertCanonicalRatio(value: unknown): void {
  expect(value && typeof value === 'object' && !Array.isArray(value)).toBe(true);
  const position = value as JsonObject;
  expect(Object.keys(position).sort()).toEqual(['unit', 'x', 'y']);
  expect(position['unit']).toBe('ratio');
  expect(Number.isFinite(position['x']) && Number(position['x']) >= 0 && Number(position['x']) <= 1).toBe(true);
  expect(Number.isFinite(position['y']) && Number(position['y']) >= 0 && Number(position['y']) <= 1).toBe(true);
}

async function assertPatchOnAllViewers(audits: BrowserAudit[], actionId: string, version: number): Promise<void> {
  await Promise.all(audits.map((audit) => expect.poll(() => audit.receivedFrames.some((frame) => frame['kind'] === 'patch.v2'
    && frame['ackClientActionId'] === actionId
    && Number(frame['version']) === version), { timeout: 20_000 }).toBe(true)));
}

function auditPage(page: Page, gameId: string): BrowserAudit {
  const audit: BrowserAudit = { sentCommands: [], receivedFrames: [], recoveryRequests: 0, errors: [] };
  page.on('websocket', (socket) => {
    socket.on('framesent', ({ payload }) => {
      const frame = parseFrame(payload);
      if (frame?.['kind'] === 'command.v2') audit.sentCommands.push(frame);
    });
    socket.on('framereceived', ({ payload }) => {
      const frame = parseFrame(payload);
      if (frame) audit.receivedFrames.push(frame);
    });
  });
  page.on('request', (httpRequest) => {
    if (httpRequest.method() === 'GET' && new RegExp(`/games/${gameId}/(bootstrap|snapshot)`).test(httpRequest.url())) audit.recoveryRequests++;
  });
  page.on('pageerror', (error) => audit.errors.push(error.message));
  return audit;
}

function assertCleanAudit(audit: BrowserAudit): void {
  const serialized = JSON.stringify(audit.receivedFrames);
  expect(audit.receivedFrames.some((frame) => frame['kind'] === 'game_patch')).toBe(false);
  expect(audit.receivedFrames.some((frame) => frame['kind'] === 'resync_required' || frame['status'] === 'resync_required')).toBe(false);
  expect(serialized).not.toMatch(/target_not_found|fallback|recovery_required/i);
  expect(audit.errors.filter((error) => /target_not_found|resync_required|NaN/i.test(error))).toEqual([]);
}

async function createContexts(
  browser: Browser,
  baseURL: string,
  setup: Setup,
  ownerViewport: { width: number; height: number },
  ownerZoom: 70 | 100 | 140,
): Promise<BrowserContext[]> {
  const profiles = setup.players.map((player, index) => ({
		player,
		viewport: index === 0 ? ownerViewport : (index === 1 ? { width: 900, height: 620 } : { width: 1600, height: 1000 }),
		zoom: index === 0 ? ownerZoom : (index === 1 ? 70 as const : 140 as const),
	}));
  return Promise.all(profiles.map(async ({ player, viewport, zoom }) => {
    const context = await browser.newContext({ baseURL, viewport, storageState: authStorageState(baseURL, player.user, player.refreshToken) });
    await context.addInitScript(({ key, value }) => {
      localStorage.setItem('commanderzone.gameplayV2FrontendEnabled', '1');
      localStorage.setItem(key, String(value));
    }, { key: BATTLEFIELD_ZOOM_STORAGE_KEY, value: zoom });
    return context;
  }));
}

async function focusPlayerById(page: Page, playerId: string): Promise<void> {
  const panel = page.getByTestId('player-panel');
  if (await panel.getAttribute('data-player-id') === playerId) return;
  const drawer = page.getByTestId('opponents-drawer-toggle');
  const drawerVisible = await drawer.isVisible();
  if (drawerVisible && await drawer.getAttribute('aria-expanded') !== 'true') await drawer.click();
  const board = page.locator(`[data-testid="opponent-mini-board"][data-player-id="${playerId}"]`);
  await expect(board).toBeVisible();
	if (drawerVisible) await expectWithinViewport(page, board);
  await board.click();
  await expect(panel).toHaveAttribute('data-player-id', playerId);
}

async function expectWithinViewport(page: Page, locator: Locator): Promise<void> {
	await expect.poll(async () => {
		const box = await locator.boundingBox();
		const viewport = page.viewportSize();
		return box !== null && viewport !== null && box.x >= 0 && box.y >= 0
			&& box.x + box.width <= viewport.width && box.y + box.height <= viewport.height;
	}).toBe(true);
}

async function assertServicesAndMetrics(request: APIRequestContext): Promise<void> {
  for (const url of [
    `${API_BASE_URL}/healthz`, `${API_BASE_URL}/readyz`,
    'http://127.0.0.1:8081/healthz', 'http://127.0.0.1:8081/readyz',
    'http://127.0.0.1:8091/healthz', 'http://127.0.0.1:8091/readyz',
  ]) {
    const response = await request.get(url, { timeout: 10_000 });
    expect(response.ok(), `${url}: HTTP ${response.status()}`).toBe(true);
  }
  const metrics = await request.get('http://127.0.0.1:8091/metrics', { timeout: 10_000 });
  expect(metrics.ok()).toBe(true);
  const metricsPayload = await metrics.json() as JsonObject;
  expect(metricsPayload['runtime']).toBeDefined();
  expect(metricsPayload['gateway']).toBeDefined();
  expect(metricsPayload['totals']).toBeDefined();
}

async function restartRuntime(): Promise<void> {
  await execFileAsync('docker', ['compose', 'restart', 'game-runtime'], { cwd: resolve(process.cwd(), '..'), timeout: 60_000, windowsHide: true });
}

async function createGame(request: APIRequestContext, playerCount: number, identity: IdentityFixture): Promise<Setup> {
  const runId = `s3e${playerCount}${Date.now().toString(36)}`;
  const players: Player[] = [];
  for (let index = 0; index < playerCount; index++) {
    const session = await createRealUserSession(request, `${runId}-${index}`);
    const deck = index === 0
      ? await createIdentityDeck(request, session.token, `I-${runId.slice(-12)}`, identity)
      : await createBasicCommanderDeckFromDatabase(request, { ownerToken: session.token, name: `D${index}-${runId.slice(-12)}` })
        .then((basic) => ({ deckId: basic.deckId, colorIdentity: basic.commander.colorIdentity }));
    players.push({ ...session, deckId: deck.deckId, expectedIdentity: deck.colorIdentity });
  }
  const create = await request.post(`${API_BASE_URL}/rooms`, {
    headers: bearer(players[0]!.token),
    data: { deckId: players[0]!.deckId, visibility: 'private', name: `Sprint 3E ${runId}`, format: 'commander', maxPlayers: playerCount, mulliganRule: 'LONDON', firstMulliganFree: true },
  });
  expect(create.ok(), await create.text()).toBe(true);
  const roomId = String(((await create.json()) as { room: { id: string } }).room.id);
  for (const player of players.slice(1)) {
    const join = await request.post(`${API_BASE_URL}/rooms/${roomId}/join`, { headers: bearer(player.token), data: { deckId: player.deckId } });
    expect(join.ok(), await join.text()).toBe(true);
  }
  await resolveTurnOrder(request, roomId, players);
  const start = await request.post(`${API_BASE_URL}/rooms/${roomId}/start`, { headers: bearer(players[0]!.token) });
  expect(start.ok(), await start.text()).toBe(true);
  return { gameId: String(((await start.json()) as { game: { id: string } }).game.id), players };
}

async function createIdentityDeck(request: APIRequestContext, token: string, name: string, identity: IdentityFixture): Promise<{ deckId: string; colorIdentity: string[] }> {
  if (identity === 'white-dfc') {
    const deck = await createBasicCommanderDeckFromDatabase(request, { ownerToken: token, name, includeWhiteDfc: true });
    return { deckId: deck.deckId, colorIdentity: deck.commander.colorIdentity };
  }
  const fixture: { commanders: Array<readonly [string, string, readonly string[]]>; land: readonly [string, string, readonly string[]] } = identity === 'ur'
    ? { commanders: [['Niv-Mizzet', 'Niv-Mizzet, the Firemind', ['U', 'R']]], land: ['Island', 'Island', ['U']] }
    : identity === 'wubrg'
      ? { commanders: [['Kenrith', 'Kenrith, the Returned King', ['W', 'U', 'B', 'R', 'G']]], land: ['Plains', 'Plains', ['W']] }
      : identity === 'colorless'
        ? { commanders: [['Ulamog', 'Ulamog, the Ceaseless Hunger', []]], land: ['Wastes', 'Wastes', []] }
        : { commanders: [['Tymna', 'Tymna the Weaver', ['W', 'B']], ['Kraum', "Kraum, Ludevic's Opus", ['U', 'R']]], land: ['Plains', 'Plains', ['W']] };
  const commanders = await Promise.all(fixture.commanders.map(([query, exact, colors]) => findCardFixture(request, query, exact, colors, true)));
  const land = await findCardFixture(request, fixture.land[0], fixture.land[1], fixture.land[2], false);
  const response = await request.post(`${API_BASE_URL}/decks/quick-build`, {
    headers: bearer(token),
    data: {
      name,
      cards: [
        ...commanders.map((commander) => ({ scryfallId: commander.scryfallId, quantity: 1, section: 'commander' })),
        { scryfallId: land.scryfallId, quantity: 100 - commanders.length, section: 'main' },
      ],
    },
  });
  expect(response.ok(), await response.text()).toBe(true);
  const payload = await response.json() as { deck?: { id?: string } };
  return { deckId: String(payload.deck?.id ?? ''), colorIdentity: canonicalIdentity(commanders.flatMap((commander) => commander.colorIdentity ?? [])).filter((color) => color !== 'C') };
}

async function findCardFixture(request: APIRequestContext, query: string, exactName: string, expectedIdentity: readonly string[], legendary: boolean): Promise<{ scryfallId: string; colorIdentity?: string[] }> {
  const response = await request.get(`${API_BASE_URL}/cards/search?q=${encodeURIComponent(query)}&limit=30&commanderLegal=true`);
  expect(response.ok(), await response.text()).toBe(true);
  const payload = await response.json() as { data?: Array<{ scryfallId: string; name: string; typeLine?: string; colorIdentity?: string[] }> };
  const expected = [...expectedIdentity].sort().join('');
  const card = (payload.data ?? []).find((candidate) => candidate.name === exactName)
    ?? (payload.data ?? []).find((candidate) => [...(candidate.colorIdentity ?? [])].sort().join('') === expected
      && (legendary ? (candidate.typeLine ?? '').toLowerCase().includes('legendary') : (candidate.typeLine ?? '').toLowerCase().includes('basic land')));
  if (!card) throw new Error(`Missing Sprint 3E fixture card: ${exactName}`);
  return card;
}

async function resolveTurnOrder(request: APIRequestContext, roomId: string, players: Player[]): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const room = await request.get(`${API_BASE_URL}/rooms/${roomId}`, { headers: bearer(players[0]!.token) });
    const entries = ((await room.json()) as { room: { players: Array<{ turnRolls?: number[] }> } }).room.players;
    const rolls = entries.map((entry) => entry.turnRolls?.join('-') ?? '');
    if (rolls.length === players.length && rolls.every(Boolean) && new Set(rolls).size === players.length) return;
    for (const player of players) {
      const response = await request.post(`${API_BASE_URL}/rooms/${roomId}/roll-turn`, { headers: bearer(player.token) });
      if (!response.ok() && response.status() !== 409) throw new Error(await response.text());
    }
  }
  throw new Error('Could not resolve Sprint 3E turn order.');
}

async function gameSnapshot(request: APIRequestContext, gameId: string, token: string): Promise<JsonObject> {
  const response = await request.get(`${API_BASE_URL}/games/${gameId}/snapshot`, { headers: bearer(token) });
  expect(response.ok(), await response.text()).toBe(true);
  return ((await response.json()) as { game: { snapshot: JsonObject } }).game.snapshot;
}

async function expectStablePresence(request: APIRequestContext, setup: Setup, pages: readonly Page[]): Promise<void> {
	await expect.poll(async () => {
		const live = await gameSnapshot(request, setup.gameId, setup.players[0]!.token);
		const presence = (live['presence'] ?? {}) as Record<string, JsonObject>;
		return setup.players.every((player) => presence[player.user.id]?.['connected'] !== false);
	}, { timeout: 30_000 }).toBe(true);
	await Promise.all(pages.map((page) => expect(page.locator('app-game-disconnect-vote-modal [role="dialog"]')).toHaveCount(0)));
}

async function waitForSnapshotVersion(request: APIRequestContext, gameId: string, token: string, version: number): Promise<void> {
  await expect.poll(async () => Number((await gameSnapshot(request, gameId, token))['version']), { timeout: 20_000 }).toBe(version);
}

function findCard(snapshot: JsonObject, instanceId: string): JsonObject | undefined {
  const instances = snapshot['instances'] as Record<string, JsonObject> | undefined;
  if (instances?.[instanceId]) return instances[instanceId];
  const players = snapshot['players'] as Record<string, JsonObject> | undefined;
  for (const player of Object.values(players ?? {})) {
    const zones = player['zones'] as Record<string, JsonObject[]> | undefined;
    for (const cards of Object.values(zones ?? {})) {
      const card = cards.find((candidate) => candidate['instanceId'] === instanceId);
      if (card) return card;
    }
  }
  return undefined;
}

function zoneIds(snapshot: JsonObject, playerId: string, zone: string): string[] {
  const player = (snapshot['players'] as Record<string, JsonObject> | undefined)?.[playerId];
  const cards = ((player?.['zones'] as Record<string, JsonObject[]> | undefined) ?? {})[zone] ?? [];
  return cards.map((card) => String(card['instanceId'] ?? '')).filter(Boolean);
}

function operation(message: JsonObject, op: string): JsonObject | null {
  const ops = Array.isArray(message['ops']) ? message['ops'] as JsonObject[] : [];
  return ops.find((item) => item['op'] === op) ?? null;
}

function spatialCommands(commands: JsonObject[]): JsonObject[] {
  return commands.filter((command) => command['type'] === 'card.position.changed' || command['type'] === 'cards.position.changed');
}

function layoutMutationCommands(commands: JsonObject[]): JsonObject[] {
  return commands.filter((command) => {
    const type = String(command['type'] ?? '');
    return type === 'card.position.changed' || type === 'cards.position.changed' || type.startsWith('attachment.') || type.startsWith('battlefield.stack.');
  });
}

function containsForbiddenSpatialKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsForbiddenSpatialKey);
  if (!value || typeof value !== 'object') return false;
  const forbidden = /^(px|viewport|browserZoom|battlefieldZoom|zoom|zoomPercent|devicePixelRatio|rawPointer|domOffset|offsetX|offsetY|cardWidth|cardHeight)$/i;
  return Object.entries(value as JsonObject).some(([key, child]) => forbidden.test(key) || containsForbiddenSpatialKey(child));
}

function parseFrame(payload: string | Buffer): JsonObject | null {
  try { return JSON.parse(typeof payload === 'string' ? payload : payload.toString('utf8')) as JsonObject; } catch { return null; }
}

function battlefieldCard(page: Page, ownerId: string, instanceId: string) {
  return page.locator(`[data-testid="game-card"][data-zone="battlefield"][data-owner-player-id="${ownerId}"][data-card-instance-id="${instanceId}"]`);
}

function opaqueBattlefieldShell(page: Page, ownerId: string) {
  return page.locator(
    `[data-testid="game-card"][data-zone="battlefield"][data-owner-player-id="${ownerId}"][data-card-instance-id^="${ownerId}-hidden-battlefield-"]`,
  ).first();
}

function opaqueBattlefieldSnapshotCard(snapshot: JsonObject, ownerId: string): JsonObject | undefined {
  const player = (snapshot['players'] as Record<string, JsonObject> | undefined)?.[ownerId];
  const cards = (player?.['zones'] as Record<string, JsonObject[]> | undefined)?.['battlefield'] ?? [];
  return cards.find((card) => String(card['instanceId'] ?? '').startsWith(`${ownerId}-hidden-battlefield-`));
}

async function expectNoGlobalOverflow(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) <= document.documentElement.clientWidth + 1)).toBe(true);
}

function canonicalIdentity(identity: readonly string[]): string[] {
  const colors = new Set(identity.map((color) => color.toUpperCase()));
  return COLOR_ORDER.filter((color) => color === 'C' || colors.has(color));
}

function ratio(x: number, y: number): RatioPosition {
  return { x, y, unit: 'ratio' };
}

function bearer(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}
