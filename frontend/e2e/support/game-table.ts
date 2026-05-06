import { expect, type Locator, type Page } from '@playwright/test';

export async function focusPlayer(page: Page, displayName: string): Promise<void> {
  try {
    await expect(page.locator('.focused-board h1')).toHaveText(displayName, { timeout: 5000 });
    return;
  } catch {
    // The requested player is in the opponents column when it is not focused.
  }

  const thumb = page.getByTestId('opponent-mini-board').filter({
    has: page.locator('strong', { hasText: displayName }),
  });
  await expect(thumb).toBeVisible();
  await thumb.click();
  await expect(page.locator('.focused-board h1')).toHaveText(displayName);
}

export async function expectFocusedPlayer(page: Page, displayName: string): Promise<void> {
  await expect(page.locator('[data-testid="player-panel"] h1')).toHaveText(displayName);
}

export async function expectOpponentVisible(page: Page, displayName: string): Promise<void> {
  await expect(page.getByTestId('opponent-mini-board').filter({ hasText: displayName })).toBeVisible();
}

export async function readTableLife(page: Page, displayName: string): Promise<number> {
  if (await isFocusedPlayer(page, displayName)) {
    return numberFromText(await safeText(page.locator('.focused-board [data-testid="life-value"]')), displayName);
  }

  const raw = await safeText(page.getByTestId('opponent-mini-board').filter({
    has: page.locator('strong', { hasText: displayName }),
  }).locator('.opponent-life'));

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
  await page.getByRole('button', { name: /Settings/ }).click();
  const menu = page.locator('nav.context-menu');
  await expect(menu).toBeVisible();
  await menu.getByRole('button', { name }).click();
}

export async function drawMine(page: Page): Promise<void> {
  await clickGameMenuAction(page, /^Draw mine/);
}

export async function openChat(page: Page): Promise<void> {
  const chatTab = page.locator('.floating-panel header button', { hasText: 'Chat' });
  await expect(chatTab).toBeVisible();
  await chatTab.click();
  await expect(page.locator('.chat-form input[name="chatMessage"]')).toBeVisible();
}

async function isFocusedPlayer(page: Page, displayName: string): Promise<boolean> {
  try {
    const heading = page.locator('.focused-board h1');
    if ((await heading.count()) === 0) {
      return false;
    }

    return (await safeText(heading)) === displayName;
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
