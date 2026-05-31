import { expect, test, type Page } from '@playwright/test';
import { authStorageState } from './support/auth';
import { createCommanderGameWithValidDecks } from './support/commander-game';
import { clickGameMenuAction } from './support/game-table';

const API_BASE_URL = process.env['E2E_API_BASE_URL'] ?? 'http://127.0.0.1:8000';
const POLL_TIMEOUT = 20_000;

test.setTimeout(180_000);

test('active player concede blocks local pass-turn command and keeps table stable', async ({ browser, request, baseURL }) => {
  if (!baseURL) {
    throw new Error('Playwright baseURL is required.');
  }

  const setup = await createCommanderGameWithValidDecks(request, {
    playerAPrefix: 'concede-guard-a',
    playerBPrefix: 'concede-guard-b',
    roomVisibility: 'public',
  });
  const { gameId, playerA, playerB } = setup;

  const contextA = await browser.newContext({
    baseURL,
    storageState: authStorageState(baseURL, playerA.user, playerA.refreshToken),
  });
  const contextB = await browser.newContext({
    baseURL,
    storageState: authStorageState(baseURL, playerB.user, playerB.refreshToken),
  });

  try {
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();
    const debugPage = await contextA.newPage();

    await Promise.all([
      pageA.goto(`/games/${gameId}`),
      pageB.goto(`/games/${gameId}`),
      debugPage.goto(`/games/${gameId}/debug`),
    ]);

    await Promise.all([
      expect(pageA.getByTestId('game-screen')).toBeVisible(),
      expect(pageB.getByTestId('game-screen')).toBeVisible(),
      expect(debugPage.locator('main.debug-page')).toBeVisible(),
    ]);

    await ensureActivePlayerPage(pageA, pageB);

    await clickGameMenuAction(pageA, /^Concede$/i);
    const concedeDialog = pageA.getByRole('dialog', { name: 'Concede game?' });
    await expect(concedeDialog).toBeVisible();
    await concedeDialog.getByRole('button', { name: /^Concede$/ }).click();

    await expect.poll(async () => gamePlayerStatus(request, gameId, playerA.token, playerA.user.displayName), { timeout: POLL_TIMEOUT }).toBe('conceded');
    await expect.poll(async () => gamePlayerStatus(request, gameId, playerB.token, playerB.user.displayName), { timeout: POLL_TIMEOUT }).toBe('active');

    await expect(pageA.getByTestId('pass-turn')).toBeVisible();
    await expect(pageA.getByTestId('pass-turn')).toBeEnabled();
    await pageA.getByTestId('pass-turn').click();

    await expect.poll(async () => hasDeadLetterCommandType(debugPage, 'turn.changed'), { timeout: POLL_TIMEOUT }).toBe(false);
    await expect.poll(async () => hasDebugErrorCode(debugPage, 'COMMAND_REJECTED'), { timeout: POLL_TIMEOUT }).toBe(false);

    await expect(pageA.getByTestId('game-screen')).toBeVisible();
    await expect(pageB.getByTestId('game-screen')).toBeVisible();
  } finally {
    await contextA.close();
    await contextB.close();
  }
});

async function ensureActivePlayerPage(pageA: Page, pageB: Page): Promise<void> {
  const passA = pageA.getByTestId('pass-turn');
  const passB = pageB.getByTestId('pass-turn');

  const aVisible = await passA.isVisible().catch(() => false);
  if (aVisible) {
    return;
  }

  const bVisible = await passB.isVisible().catch(() => false);
  if (!bVisible) {
    await expect.poll(async () => passA.isVisible().catch(() => false)).toBe(true);
    return;
  }

  await passB.click();
  await expect.poll(async () => passA.isVisible().catch(() => false), { timeout: POLL_TIMEOUT }).toBe(true);
}

async function gamePlayerStatus(
  request: import('@playwright/test').APIRequestContext,
  gameId: string,
  token: string,
  displayName: string,
): Promise<string> {
  const snapshotResponse = await request.get(`${API_BASE_URL}/games/${gameId}/snapshot`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (!snapshotResponse.ok()) {
    return '';
  }

  const payload = (await snapshotResponse.json()) as {
    game: { snapshot: { players: Record<string, { user: { displayName: string }; status: string }> } };
  };

  const playerEntry = Object.values(payload.game.snapshot.players)
    .find((candidate) => candidate.user.displayName === displayName);

  return playerEntry?.status ?? '';
}

async function hasDeadLetterCommandType(debugPage: Page, commandType: string): Promise<boolean> {
  const rows = debugPage
    .locator('section')
    .filter({ hasText: 'Dead-letter local' })
    .locator('tbody tr');
  const count = await rows.count();
  for (let index = 0; index < count; index += 1) {
    const value = ((await rows.nth(index).locator('td').nth(1).textContent()) ?? '').trim();
    if (value === commandType) {
      return true;
    }
  }

  return false;
}

async function hasDebugErrorCode(debugPage: Page, code: string): Promise<boolean> {
  const errorsSection = debugPage.locator('section').filter({ hasText: 'Errores' }).first();
  const codeLocators = errorsSection.locator('article strong');
  const count = await codeLocators.count();
  for (let index = 0; index < count; index += 1) {
    const value = ((await codeLocators.nth(index).textContent()) ?? '').trim();
    if (value === code) {
      return true;
    }
  }

  return false;
}
