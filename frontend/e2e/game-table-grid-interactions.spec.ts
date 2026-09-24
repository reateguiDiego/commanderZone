import { expect, test, type Page, type Locator } from '@playwright/test';
import { installGridTable } from './support/game-table-grid-fixture';

test.use({ channel: process.env['E2E_BROWSER_CHANNEL'] || undefined, actionTimeout: 10_000 });

test('Grid preserves local interactions and public relations while protecting opponent hands', async ({
  browser,
  baseURL,
}, testInfo) => {
  test.setTimeout(90_000);
  const context = await browser.newContext({ baseURL, viewport: { width: 1600, height: 1000 } });
  try {
    const runtime = await installGridTable(context, 4, 'p1');
    runtime.bootstrap.staticCards['p1:battlefield:2'].typeLine = 'Artifact — Equipment';
    runtime.bootstrap.instances['p1:battlefield:0'].isToken = true;
    runtime.bootstrap.instances['p1:battlefield:1'].isToken = true;
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/games/grid-fixture');
    await page.locator('.zoom-toggle-button').click();
    await page.getByTestId('battlefield-zoom-grid-button').click();
    const local = page.locator('[data-testid="grid-player-panel"][data-player-id="p1"]');
    const opponent = page.locator('[data-testid="grid-player-panel"][data-player-id="p2"]');
    const battlefield = local.getByTestId('battlefield-zone');
    const card = (id: string) =>
      local.locator(`[data-testid="game-card"][data-card-instance-id="${id}"]`);
    await expect.poll(() => runtime.sockets.length).toBe(1);

    // Counter edits use the existing command path; opponent markers are read-only.
    await expect(opponent.getByTestId('battlefield-zone').locator('.counter-marker')).toHaveClass(
      /readonly-counter-marker/,
    );
    runtime.respondWith([
      {
        op: 'card.counters.patch',
        playerId: 'p1',
        zone: 'battlefield',
        instanceId: 'p1:battlefield:1',
        counters: { '+1/+1': 3 },
      },
    ]);
    await card('p1:battlefield:1').locator('.counter-marker').click();
    await expect
      .poll(() => runtime.commands)
      .toEqual([
        expect.objectContaining({
          type: 'card.counter.changed',
          payload: expect.objectContaining({
            playerId: 'p1',
            instanceId: 'p1:battlefield:1',
            value: 3,
          }),
        }),
      ]);
    await expect(card('p1:battlefield:1').locator('.counter-value-badge')).toHaveText('3');

    // Mana is intentionally local presentation state, retained across both layouts.
    await battlefield.click({ button: 'right', position: { x: 180, y: 30 } });
    await page
      .getByTestId('context-menu')
      .getByRole('button', { name: /Show Mana Pool/i })
      .click();
    const mana = local
      .locator('.mana-pool-color')
      .filter({ has: page.locator('[data-mana-pool-color="C"]') });
    await mana.locator('.mana-value-button').click();
    await mana.locator('.step-button--add').click();
    await expect(mana.locator('strong')).toHaveText('1');
    await expect(opponent.locator('app-mana-pool-panel')).toHaveCount(0);

    // Real pointer transfer from the compact hand into this player's battlefield.
    const hand = local.getByTestId('hand-area');
    await hand.hover();
    await expect(hand).toHaveClass(/hand-revealed/);
    const handCard = card('p1:hand:0');
    const start = await handCard.boundingBox();
    const destination = await battlefield.boundingBox();
    if (!start || !destination) throw new Error('Expected measurable hand and battlefield.');
    runtime.respondWith([
      {
        op: 'zone.cards.move',
        instanceId: 'p1:hand:0',
        from: { playerId: 'p1', zone: 'hand' },
        to: { playerId: 'p1', zone: 'battlefield' },
      },
      { op: 'zone.count.set', playerId: 'p1', zone: 'hand', count: 1 },
    ]);
    await page.mouse.move(start.x + start.width / 2, start.y + 15);
    await page.mouse.down();
    await page.mouse.move(
      destination.x + destination.width * 0.35,
      destination.y + destination.height * 0.3,
      { steps: 12 },
    );
    await page.mouse.up();
    await expect
      .poll(() => runtime.commands.at(-1))
      .toMatchObject({
        type: 'card.moved',
        payload: {
          playerId: 'p1',
          fromZone: 'hand',
          toZone: 'battlefield',
          instanceId: 'p1:hand:0',
        },
      });
    await expect(battlefield.locator('[data-card-instance-id="p1:hand:0"]')).toHaveCount(1);
    await expect(local.getByTestId('hand-zone').getByTestId('game-card')).toHaveCount(1);

    // Move back out of the battlefield, then inspect the correct public zone.
    const graveyard = local.locator('[data-testid="drop-zone"][data-zone="graveyard"]');
    const moved = await card('p1:hand:0').boundingBox();
    const graveyardBounds = await graveyard.boundingBox();
    if (!moved || !graveyardBounds) throw new Error('Expected measurable card and graveyard.');
    runtime.respondWith([
      {
        op: 'zone.cards.move',
        instanceId: 'p1:hand:0',
        from: { playerId: 'p1', zone: 'battlefield' },
        to: { playerId: 'p1', zone: 'graveyard' },
      },
    ]);
    await page.mouse.move(moved.x + moved.width / 2, moved.y + 20);
    await page.mouse.down();
    await page.mouse.move(graveyardBounds.x + graveyardBounds.width / 2, graveyardBounds.y + 25, {
      steps: 12,
    });
    await page.mouse.up();
    await expect
      .poll(() => runtime.commands.at(-1))
      .toMatchObject({
        type: 'card.moved',
        payload: {
          playerId: 'p1',
          fromZone: 'battlefield',
          toZone: 'graveyard',
          instanceId: 'p1:hand:0',
        },
      });
    await expect(battlefield.locator('[data-card-instance-id="p1:hand:0"]')).toHaveCount(0);
    await graveyard.click();
    await expect(page.getByTestId('zone-modal')).toBeVisible();
    await expect(page.getByTestId('zone-modal')).toContainText('Private p1');
    await page.getByTestId('zone-modal-close').click();

    await verifyHandVisibility(page, opponent, runtime);
    await verifyPermanentRelations(page, local, runtime);

    const commandsBeforeSwitch = runtime.commands.length;
    await page.getByTestId('battlefield-zoom-square-button').click();
    await expect(
      page
        .locator('.mana-pool-color')
        .filter({ has: page.locator('[data-mana-pool-color="C"]') })
        .locator('strong'),
    ).toHaveText('1');
    await page.locator('.zoom-toggle-button').click();
    await page.getByTestId('battlefield-zoom-grid-button').click();
    await expect(mana.locator('strong')).toHaveText('1');
    expect(runtime.commands).toHaveLength(commandsBeforeSwitch);
    expect(errors).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath('grid-interactions.png') });
  } finally {
    await context.close();
  }
});

type GridRuntime = Awaited<ReturnType<typeof installGridTable>>;

async function verifyHandVisibility(
  page: Page,
  opponent: Locator,
  runtime: GridRuntime,
): Promise<void> {
  // Revealed identity is allowed only when supplied by the viewer's projection.
  const opponentHandCard = opponent.locator('[data-card-instance-id="p2:hand:0"]');
  await expect(opponentHandCard).toHaveClass(/face-down/);
  runtime.publish([{ op: 'hand.reveal_marker.set', playerId: 'p2', index: 0, revealed: true }]);
  await expect(opponentHandCard.locator('.reveal-indicator')).toBeVisible();
  await expect(opponentHandCard).toHaveClass(/face-down/);
  runtime.publish([
    {
      op: 'card.field.set',
      playerId: 'p2',
      zone: 'hand',
      instanceId: 'p2:hand:0',
      hidden: false,
      revealedTo: ['p1'],
      staticCard: {
        ...runtime.bootstrap.staticCards['p1:hand:0'],
        cardRef: 'p2:hand:0',
        cardKey: 'p2:hand:0',
        printId: 'p2:hand:0',
        name: 'Revealed opponent card',
      },
    },
  ]);
  await expect(opponentHandCard).not.toHaveClass(/face-down/);
  await expect(opponent.locator('[data-card-instance-id="p2:hand:1"]')).toHaveClass(/face-down/);
  await opponentHandCard.hover();
  await expect(page.locator('app-card-preview-overlay')).toContainText('Revealed opponent card');
  runtime.publish([
    {
      op: 'card.field.set',
      playerId: 'p2',
      zone: 'hand',
      instanceId: 'p2:hand:0',
      hidden: true,
      revealedTo: [],
    },
  ]);
  await expect(opponentHandCard).toHaveClass(/face-down/);
}

async function verifyPermanentRelations(
  page: Page,
  local: Locator,
  runtime: GridRuntime,
): Promise<void> {
  const card = (id: string) =>
    local.locator(`[data-testid="game-card"][data-card-instance-id="${id}"]`);
  // Create an attachment through the existing menu and target-selection path.
  runtime.respondWith(
    [
      {
        op: 'attachment.add',
        attachment: {
          id: 'grid-attachment',
          ownerId: 'p1',
          equipmentInstanceId: 'p1:battlefield:2',
          attachedToInstanceId: 'p1:battlefield:0',
          createdAt: new Date().toISOString(),
        },
      },
    ],
    'attachment.created',
  );
  await card('p1:battlefield:2').click({ button: 'right' });
  await page.getByTestId('context-menu').getByRole('button', { name: 'Attach to...' }).click();
  await card('p1:battlefield:0').click();
  await expect
    .poll(() => runtime.commands)
    .toContainEqual(
      expect.objectContaining({
        type: 'attachment.created',
        payload: {
          equipmentInstanceId: 'p1:battlefield:2',
          attachedToInstanceId: 'p1:battlefield:0',
        },
      }),
    );
  await expect(card('p1:battlefield:0')).toHaveClass(/attachment-stack-target/);
  await expect(card('p1:battlefield:2')).toHaveClass(/attachment-stack-equipment/);
  runtime.respondWith([{ op: 'attachment.remove', id: 'grid-attachment' }], 'attachment.removed');
  await card('p1:battlefield:0').click({ button: 'right' });
  await page
    .getByTestId('context-menu')
    .getByRole('button', { name: 'Detach all attached cards' })
    .click();
  await expect(card('p1:battlefield:2')).not.toHaveClass(/attachment-stack-equipment/);
  // Drag compatible tokens together to create a manual stack.
  const sourceToken = await card('p1:battlefield:1').boundingBox();
  const targetToken = await card('p1:battlefield:0').boundingBox();
  if (!sourceToken || !targetToken) throw new Error('Expected measurable tokens.');
  runtime.respondWith(
    [
      {
        op: 'battlefieldStack.add',
        battlefieldStack: {
          id: 'grid-stack',
          ownerId: 'p1',
          stackedInstanceId: 'p1:battlefield:1',
          stackTopInstanceId: 'p1:battlefield:0',
          createdAt: new Date().toISOString(),
        },
      },
    ],
    'battlefield_stack.created',
  );
  await page.mouse.move(
    sourceToken.x + sourceToken.width / 2,
    sourceToken.y + sourceToken.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    targetToken.x + targetToken.width / 2,
    targetToken.y + targetToken.height / 2,
    { steps: 12 },
  );
  await page.mouse.up();
  await expect
    .poll(() => runtime.commands)
    .toContainEqual(
      expect.objectContaining({
        type: 'battlefield_stack.created',
        payload: {
          stackedInstanceId: 'p1:battlefield:1',
          stackTopInstanceId: 'p1:battlefield:0',
        },
      }),
    );
  await expect(card('p1:battlefield:0')).toHaveClass(/attachment-stack-target/);
  await expect(card('p1:battlefield:1')).toHaveClass(/attachment-stack-equipment/);
  runtime.respondWith(
    [{ op: 'battlefieldStack.remove', id: 'grid-stack' }],
    'battlefield_stack.removed',
  );
  await card('p1:battlefield:0').click({ button: 'right' });
  await page
    .getByTestId('context-menu')
    .getByRole('button', { name: 'Remove from the stack' })
    .click();
  await expect(card('p1:battlefield:1')).not.toHaveClass(/attachment-stack-equipment/);
}
