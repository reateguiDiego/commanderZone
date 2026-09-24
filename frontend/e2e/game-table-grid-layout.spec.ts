import { expect, test, type BrowserContext } from '@playwright/test';
import { installGridTable } from './support/game-table-grid-fixture';
import type { GameCardPosition } from '../src/app/core/models/game.model';
import type {
  GameplayClientMessage,
  GameplayPatchV2Message,
} from '../src/app/core/models/game-realtime.model';

// This presentation contract test uses the real V2 projection and browser renderer.
// This does not replace the backend/runtime multiplayer gauntlet.
test.use({ channel: process.env['E2E_BROWSER_CHANNEL'] || undefined, actionTimeout: 10_000 });

test('Grid keeps each player contained, private and stable across view and viewport changes', async ({
  browser,
  baseURL,
}, testInfo) => {
  test.setTimeout(120_000);
  const contexts: BrowserContext[] = [];
  try {
    for (const count of [1, 2, 3, 4]) {
      const context = await browser.newContext({
        baseURL,
        viewport: { width: 1600, height: 1000 },
      });
      contexts.push(context);
      const runtime = await installGridTable(context, count, 'p1');
      const page = await context.newPage();
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto('/games/grid-fixture');
      if (count === 1) await page.locator('app-game-rematch-modal .modal-close-button').click();
      await expect(page.locator('.zoom-toggle-button')).toBeVisible();
      await page.locator('.zoom-toggle-button').click();
      await page.getByTestId('battlefield-zoom-slider').fill('111');
      await page.getByTestId('battlefield-zoom-grid-button').click();
      await expect(page.getByTestId('grid-player-panel')).toHaveCount(count);
      await expect(page.getByTestId('battlefield-zone')).toHaveCount(count);
      await expect(page.locator('.player-sidebar, app-opponent-mini-board')).toHaveCount(0);
      await expect(page.getByTestId('grid-player-panel').last()).toHaveAttribute(
        'data-player-id',
        'p1',
      );
      await expect(page.getByTestId('game-table-grid')).not.toContainText('Private p2');

      for (const viewport of [
        { width: 1600, height: 1000 },
        { width: 1100, height: 700 },
      ]) {
        await page.setViewportSize(viewport);
        await expect(page.getByTestId('battlefield-zoom-square-button')).toBeVisible();
        await expect
          .poll(() =>
            page.getByTestId('grid-player-panel').evaluateAll((cells) =>
              cells.every((cell) => {
                const bounds = cell.getBoundingClientRect();
                return [
                  ...cell.querySelectorAll(
                    '[data-testid="battlefield-zone"] [data-testid="game-card"]',
                  ),
                ].every((card) => {
                  const rect = card.getBoundingClientRect();
                  return (
                    rect.left >= bounds.left - 1 &&
                    rect.right <= bounds.right + 1 &&
                    rect.top >= bounds.top - 1 &&
                    rect.bottom <= bounds.bottom + 1
                  );
                });
              }),
            ),
          )
          .toBe(true);
        await expect
          .poll(() =>
            page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
          )
          .toBe(true);
        await page.screenshot({ path: testInfo.outputPath(`grid-${count}-${viewport.width}.png`) });
      }
      const before = await page
        .getByTestId('grid-player-panel')
        .evaluateAll((cells) => cells.map((cell) => cell.getAttribute('data-player-id')));
      await expect.poll(() => runtime.sockets.length).toBe(1);
      const patch: GameplayPatchV2Message = {
        kind: 'patch.v2',
        gameId: 'grid-fixture',
        version: 2,
        visibility: 'public',
        ops: [
          { op: 'player.life.set', playerId: 'p1', value: 33 },
          {
            op: 'turn.set',
            turn: { activePlayerId: count > 1 ? 'p2' : 'p1', phase: 'combat', number: 2 },
          },
        ],
      };
      runtime.sockets[0].send(JSON.stringify(patch));
      await expect(
        page.getByTestId('grid-player-panel').last().locator('.player-cell-life'),
      ).toContainText('33');
      expect(
        await page
          .getByTestId('grid-player-panel')
          .evaluateAll((cells) => cells.map((cell) => cell.getAttribute('data-player-id'))),
      ).toEqual(before);
      expect(runtime.commands).toEqual([]);
      if (count === 4) {
        const localCard = page.locator(
          '[data-testid="grid-player-panel"][data-player-id="p1"] [data-card-instance-id="p1:battlefield:0"]',
        );
        const opponentCard = page.locator(
          '[data-testid="grid-player-panel"][data-player-id="p2"] [data-card-instance-id="p2:battlefield:0"]',
        );
        await expect(opponentCard).toHaveClass(/locked-card/);
        await localCard.hover();
        await expect(page.locator('app-card-preview-overlay')).toBeVisible();
        const bounds = await localCard.boundingBox();
        if (!bounds) throw new Error('Local battlefield card has no bounds.');
        await page.mouse.move(bounds.x + 35, bounds.y + 35);
        await page.mouse.down();
        await page.mouse.move(bounds.x + 115, bounds.y + 50, { steps: 8 });
        await page.mouse.up();
        await expect.poll(() => runtime.commands.length).toBe(1);
        const move = runtime.commands[0];
        expect(move).toMatchObject({
          kind: 'command.v2',
          type: 'card.position.changed',
          payload: { playerId: 'p1' },
        });
        if (move.kind !== 'command.v2') throw new Error('Expected V2 position command.');
        const payload = move.payload as { position: GameCardPosition };
        expect(payload.position.unit).toBe('ratio');
        expect(payload.position.x).toBeGreaterThan(0.1);
        expect(payload.position.x).toBeLessThan(0.3);
      }
      const commandsAfterInteraction = runtime.commands.length;
      for (let repeat = 0; repeat < 2; repeat++) {
        await page.getByTestId('battlefield-zoom-square-button').click();
        await expect(page.locator('.player-sidebar')).toHaveCount(1);
        await expect(page.getByTestId('battlefield-zone')).toHaveCount(1);
        await page.getByTestId('battlefield-zoom-grid-button').click();
        await expect(page.getByTestId('battlefield-zone')).toHaveCount(count);
      }
      await page.getByTestId('battlefield-zoom-square-button').click();
      await page.setViewportSize({ width: 1600, height: 1000 });
      await page.locator('.zoom-toggle-button').click();
      await expect(page.getByTestId('battlefield-zoom-slider')).toHaveValue('111');
      expect(runtime.commands).toHaveLength(commandsAfterInteraction);
      expect(errors).toEqual([]);
    }

    // A second viewer has an isolated session and the local seat follows that viewer.
    const second = await browser.newContext({ baseURL, viewport: { width: 1600, height: 1000 } });
    contexts.push(second);
    await installGridTable(second, 4, 'p2');
    const page = await second.newPage();
    await page.goto('/games/grid-fixture');
    await page.locator('.zoom-toggle-button').click();
    await page.getByTestId('battlefield-zoom-grid-button').click();
    await expect(page.getByTestId('grid-player-panel').last()).toHaveAttribute(
      'data-player-id',
      'p2',
    );
    await expect(page.getByTestId('game-table-grid')).not.toContainText('Private p1');
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
