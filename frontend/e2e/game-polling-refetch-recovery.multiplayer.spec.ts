import { expect, test } from '@playwright/test';
import { authStorageState } from './support/auth';
import { createCommanderGameWithValidDecks } from './support/commander-game';
import { readTableLife } from './support/game-table';

test.setTimeout(120000);

test('polling refetch recovers snapshot sync when realtime stream is unavailable', async ({ browser, request, baseURL }) => {
  if (!baseURL) {
    throw new Error('Playwright baseURL is required.');
  }

  const setup = await createCommanderGameWithValidDecks(request, {
    playerAPrefix: 'poll-a',
    playerBPrefix: 'poll-b',
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

  await contextB.addInitScript(() => {
    class DisabledEventSource {
      onmessage: ((this: EventSource, ev: MessageEvent<string>) => unknown) | null = null;
      onerror: ((this: EventSource, ev: Event) => unknown) | null = null;
      onopen: ((this: EventSource, ev: Event) => unknown) | null = null;
      readyState = 2;
      url = '';
      withCredentials = true;

      constructor(url: string) {
        this.url = url;
        queueMicrotask(() => {
          this.onerror?.(new Event('error'));
        });
      }

      close(): void {}

      addEventListener(): void {}

      removeEventListener(): void {}

      dispatchEvent(): boolean {
        return false;
      }
    }

    Object.defineProperty(window, 'EventSource', {
      configurable: true,
      writable: true,
      value: DisabledEventSource,
    });
  });

  try {
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    await Promise.all([
      pageA.goto(`/games/${gameId}`),
      pageB.goto(`/games/${gameId}`),
    ]);

    await expect(pageA.getByTestId('game-screen')).toBeVisible();
    await expect(pageB.getByTestId('game-screen')).toBeVisible();

    const lifeSelectorForA = pageA.locator(`[data-testid="life-value"][data-player-id="${playerA.user.id}"]`);

    await lifeSelectorForA.click({ button: 'right' });
    await expect(lifeSelectorForA).toHaveText('39');

    await expect
      .poll(async () => readTableLife(pageB, playerA.user.displayName), {
        timeout: 15000,
        intervals: [500, 1000, 1500, 2000],
      })
      .toBe(39);
  } finally {
    await contextA.close();
    await contextB.close();
  }
});
