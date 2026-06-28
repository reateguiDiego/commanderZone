import { expect, type Locator, type Page } from '@playwright/test';

export async function focusPlayer(page: Page, displayName: string): Promise<void> {
  try {
    await expect.poll(() => hasFocusedPlayerName(page, displayName), { timeout: 5000 }).toBe(true);
    return;
  } catch {
    // The requested player is in the opponents column when it is not focused.
  }

  const thumb = await resolveOpponentBoard(page, displayName);
  await expect(thumb).toBeVisible();
  await thumb.click();
  await expect.poll(() => hasFocusedPlayerName(page, displayName), { timeout: 5000 }).toBe(true);
}

export async function expectFocusedPlayer(page: Page, displayName: string): Promise<void> {
  await expect.poll(() => hasFocusedPlayerName(page, displayName), { timeout: 5000 }).toBe(true);
}

export async function expectOpponentVisible(page: Page, displayName: string): Promise<void> {
  await expect(await resolveOpponentBoard(page, displayName)).toBeVisible();
}

export async function readTableLife(page: Page, displayName: string): Promise<number> {
  if (await isFocusedPlayer(page, displayName)) {
    return numberFromText(await safeText(page.getByTestId('focused-player-life').getByTestId('life-value')), displayName);
  }

  const raw = await safeText((await resolveOpponentBoard(page, displayName)).getByTestId('opponent-life'));

  return numberFromText(raw, displayName);
}

export async function readTableZoneCounts(page: Page, displayName: string): Promise<{ hand: number; library: number }> {
  await focusPlayer(page, displayName);

  const panel = page.getByTestId('player-panel');
  const handRaw = await panel.getAttribute('data-hand-count');
  const playerId = await panel.getAttribute('data-player-id');
  if (!playerId) {
    throw new Error(`Missing focused player id for ${displayName}.`);
  }
  const libraryRaw = await safeText(page.locator(`[data-testid="zone-count"][data-player-id="${playerId}"][data-zone="library"]`));

  return {
    hand: numberFromText(handRaw ?? '0', displayName),
    library: numberFromText(libraryRaw, displayName),
  };
}

export async function clickGameMenuAction(page: Page, name: string | RegExp): Promise<void> {
  await page.getByTestId('game-screen').click({ button: 'right' });
  const menu = page.getByTestId('context-menu');
  await expect(menu).toBeVisible();
  await menu.getByRole('button', { name }).click();
}

export async function drawMine(page: Page): Promise<void> {
  const playerId = await page.getByTestId('player-panel').getAttribute('data-player-id');
  if (!playerId) {
    throw new Error('Missing focused player id while drawing from library.');
  }

  const library = page.locator(`[data-testid="drop-zone"][data-player-id="${playerId}"][data-zone="library"]`);
  await expect(library).toBeVisible();
  await library.dblclick();
}

export async function openChat(page: Page): Promise<void> {
  const chatTab = page.getByTestId('chat-open');
  await expect(chatTab).toBeVisible();
  await chatTab.click();
  await expect(page.getByTestId('chat-panel')).toBeVisible();
  await expect(page.getByTestId('chat-input')).toBeVisible();
}

async function isFocusedPlayer(page: Page, displayName: string): Promise<boolean> {
  try {
    return await hasFocusedPlayerName(page, displayName);
  } catch {
    return false;
  }
}

function numberFromText(raw: string, label: string): number {
  const value = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(value)) {
    throw new Error(`Could not parse numeric value "${raw}" for ${label}.`);
  }

  return value;
}

async function safeText(locator: Locator): Promise<string> {
  return ((await locator.textContent({ timeout: 750 })) ?? '').trim();
}

async function resolveOpponentBoard(page: Page, displayName: string): Promise<Locator> {
  const namedBoard = page.getByTestId('opponent-mini-board').filter({ hasText: displayName });
  if (await namedBoard.count() > 0) {
    return namedBoard.first();
  }

  const boards = page.getByTestId('opponent-mini-board');
  if (await boards.count() === 1) {
    return boards.first();
  }

  throw new Error(`Could not resolve opponent board for ${displayName}.`);
}

async function hasFocusedPlayerName(page: Page, displayName: string): Promise<boolean> {
  const labels = page.getByTestId('focused-player-name');
  const count = await labels.count();
  for (let index = 0; index < count; index += 1) {
    if ((await safeText(labels.nth(index))) === displayName) {
      return true;
    }
  }

  return false;
}
