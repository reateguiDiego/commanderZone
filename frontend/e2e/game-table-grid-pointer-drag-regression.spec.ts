import { expect, test, type Page } from '@playwright/test';
import { installGridTable } from './support/game-table-grid-fixture';

test.use({ channel: process.env['E2E_BROWSER_CHANNEL'] || undefined, actionTimeout: 10_000 });

test('Grid persists an upper battlefield pointer drop at the ghost preview position and ignores distant relations', async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(60_000);
  const context = await browser.newContext({ baseURL, viewport: { width: 1600, height: 1000 } });
  try {
    // This fixture always uses the same viewer and game, so the notice can be
    // acknowledged before Angular evaluates it instead of covering the board.
    await context.addInitScript(() => {
      localStorage.setItem('commanderzone.fair-play-notice.p1.grid-fixture', '1');
    });
    const runtime = await installGridTable(context, 4, 'p1');
    runtime.bootstrap.staticCards['p1:battlefield:2'].typeLine = 'Artifact — Equipment';

    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/games/grid-fixture');
    await page.locator('.zoom-toggle-button').click();
    await page.getByTestId('battlefield-zoom-grid-button').click();
    await expect.poll(() => runtime.sockets.length).toBe(1);

    const local = page.locator('[data-testid="grid-player-panel"][data-player-id="p1"]');
    const upper = page.locator('[data-testid="grid-player-panel"][data-player-id="p2"]');
    const localBattlefield = local.getByTestId('battlefield-zone');
    const upperBattlefield = upper.getByTestId('battlefield-zone');
    await expect(upper).toHaveClass(/is-top-row/);
    await expect(upperBattlefield).toHaveAttribute('data-battlefield-vertically-inverted', '');

    // Grid cells normally intercept cross-player drops to ask for confirmation.
    // Removing only that outer capture exposes the real public battlefield drop
    // zone, so this test can assert the coordinate generated for an inverted
    // battlefield before the same confirmation flow persists it.
    await upper.evaluate((cell) => cell.removeAttribute('data-player-drop-target'));

    const hand = local.getByTestId('hand-area');
    await hand.hover();
    await expect(hand).toHaveClass(/hand-revealed/);
    const handCard = local.locator('[data-testid="game-card"][data-card-instance-id="p1:hand:0"]');
    const [handBounds, upperBounds] = await Promise.all([
      handCard.boundingBox(),
      upperBattlefield.boundingBox(),
    ]);
    if (!handBounds || !upperBounds) {
      throw new Error('Expected measurable hand card and upper Grid battlefield.');
    }

    const upperDropPoint = {
      x: upperBounds.x + upperBounds.width * 0.72,
      y: upperBounds.y + upperBounds.height * 0.6,
    };
    await page.mouse.move(
      handBounds.x + handBounds.width / 2,
      handBounds.y + handBounds.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(upperDropPoint.x, upperDropPoint.y, { steps: 12 });
    await expect(page.locator('.hand-floating-card')).toBeVisible();

    const projection = await invertedGhostProjection(page, 'p2');
    // Keep the regression point away from the upper mana lane and existing
    // rows; a snap would intentionally change the final position.
    expect(projection.visualTop).toBeGreaterThan(projection.manaBottom + 12);
    expect(projection.nearestExistingLogicalRowDistance).toBeGreaterThan(20);

    runtime.respondWith(
      [
        {
          op: 'zone.cards.move',
          instanceId: 'p1:hand:0',
          from: { playerId: 'p1', zone: 'hand' },
          to: { playerId: 'p2', zone: 'battlefield' },
        },
      ],
      'card.moved',
    );
    await page.mouse.up();
    await upper.evaluate((cell) => cell.setAttribute('data-player-drop-target', 'p2'));

    const confirmation = page.getByRole('dialog').filter({ hasText: 'Player 2' });
    await expect(confirmation).toBeVisible();
    await confirmation.locator('button.primary-button').click();
    const moved = await waitForCommand(runtime.commands, 'card.moved', 'p1:hand:0');
    const movePayload = moved.payload as {
      readonly targetPlayerId?: string;
      readonly position?: { readonly x: number; readonly y: number; readonly unit?: string };
    };
    expect(movePayload.targetPlayerId).toBe('p2');
    expect(movePayload.position).toMatchObject({ unit: 'ratio' });
    expect(movePayload.position?.x).toBeCloseTo(projection.expectedRatio.x, 5);
    expect(movePayload.position?.y).toBeCloseTo(projection.expectedRatio.y, 5);

    // A compatible Equipment may only attach when its rendered drop geometry
    // actually overlaps a target. Moving it into an empty Grid area must stay
    // an ordinary position command, never a remote stack/attachment relation.
    const equipment = local.locator(
      '[data-testid="game-card"][data-card-instance-id="p1:battlefield:2"]',
    );
    const [equipmentBounds, localBounds] = await Promise.all([
      equipment.boundingBox(),
      localBattlefield.boundingBox(),
    ]);
    if (!equipmentBounds || !localBounds) {
      throw new Error('Expected measurable Equipment and local Grid battlefield.');
    }
    const commandsBeforeDistantDrop = runtime.commands.length;
    await page.mouse.move(
      equipmentBounds.x + equipmentBounds.width / 2,
      equipmentBounds.y + equipmentBounds.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      localBounds.x + localBounds.width * 0.82,
      localBounds.y + localBounds.height * 0.3,
      { steps: 12 },
    );
    await page.mouse.up();
    await expect
      .poll(() => runtime.commands.slice(commandsBeforeDistantDrop).map((command) => command.type))
      .toContain('card.position.changed');
    const distantDropCommands = runtime.commands.slice(commandsBeforeDistantDrop);
    expect(distantDropCommands.map((command) => command.type)).not.toContain('attachment.created');
    expect(distantDropCommands.map((command) => command.type)).not.toContain(
      'battlefield_stack.created',
    );
    await expect(equipment).not.toHaveClass(/attachment-stack-equipment/);
    await expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

interface InvertedGhostProjection {
  readonly expectedRatio: { readonly x: number; readonly y: number };
  readonly visualTop: number;
  readonly manaBottom: number;
  readonly nearestExistingLogicalRowDistance: number;
}

async function invertedGhostProjection(
  page: Page,
  playerId: string,
): Promise<InvertedGhostProjection> {
  return page
    .locator(`[data-testid="battlefield-zone"][data-player-id="${playerId}"]`)
    .evaluate((battlefield) => {
      const ghost = document.querySelector<HTMLElement>('.hand-floating-card');
      const referenceCard = battlefield.querySelector<HTMLElement>(
        '[data-testid="game-card"][data-zone="battlefield"]',
      );
      if (!ghost || !referenceCard) {
        throw new Error('Expected an active hand ghost and a battlefield card-size reference.');
      }

      const bounds = battlefield.getBoundingClientRect();
      const cardWidth = Math.max(
        1,
        Math.round(referenceCard.offsetWidth || referenceCard.getBoundingClientRect().width),
      );
      const cardHeight = Math.max(
        1,
        Math.round(referenceCard.offsetHeight || referenceCard.getBoundingClientRect().height),
      );
      const visualLeft = Math.max(
        0,
        Math.min(
          Math.round(bounds.width - cardWidth),
          Math.round(Number.parseFloat(ghost.style.left) - bounds.left),
        ),
      );
      const visualTop = Math.max(
        0,
        Math.min(
          Math.round(bounds.height - cardHeight),
          Math.round(Number.parseFloat(ghost.style.top) - bounds.top),
        ),
      );
      const logicalWidth = Math.round(battlefield.clientWidth || bounds.width);
      const logicalHeight = Math.round(battlefield.clientHeight || bounds.height);
      const logicalLeft = visualLeft;
      const logicalTop = Math.max(0, Math.round(logicalHeight - cardHeight - visualTop));
      const availableWidth = Math.max(1, Math.round(logicalWidth - cardWidth));
      const availableHeight = Math.max(1, Math.round(logicalHeight - cardHeight));
      const manaBottom =
        battlefield.querySelector<HTMLElement>('[data-mana-lane]')?.getBoundingClientRect()
          .bottom ?? bounds.top;
      const existingRows = [0, Math.round(availableHeight / 2), availableHeight];

      return {
        expectedRatio: {
          x:
            Math.round(Math.max(0, Math.min(1, logicalLeft / availableWidth)) * 1_000_000) /
            1_000_000,
          y:
            Math.round(Math.max(0, Math.min(1, logicalTop / availableHeight)) * 1_000_000) /
            1_000_000,
        },
        visualTop: bounds.top + visualTop,
        manaBottom,
        nearestExistingLogicalRowDistance: Math.min(
          ...existingRows.map((row) => Math.abs(row - logicalTop)),
        ),
      };
    });
}

async function waitForCommand(
  commands: readonly {
    readonly type?: string;
    readonly payload?: unknown;
  }[],
  type: string,
  instanceId: string,
): Promise<{ readonly type?: string; readonly payload?: unknown }> {
  await expect
    .poll(() =>
      commands.find(
        (command) =>
          command.type === type &&
          typeof command.payload === 'object' &&
          command.payload !== null &&
          (command.payload as { readonly instanceId?: unknown }).instanceId === instanceId,
      ),
    )
    .toBeTruthy();

  const command = commands.find(
    (candidate) =>
      candidate.type === type &&
      typeof candidate.payload === 'object' &&
      candidate.payload !== null &&
      (candidate.payload as { readonly instanceId?: unknown }).instanceId === instanceId,
  );
  if (!command) {
    throw new Error(`Expected ${type} command for ${instanceId}.`);
  }

  return command;
}
