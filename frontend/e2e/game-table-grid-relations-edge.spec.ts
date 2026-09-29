import { expect, test, type Locator, type Page } from '@playwright/test';
import { installGridTable } from './support/game-table-grid-fixture';

test.use({ channel: process.env['E2E_BROWSER_CHANNEL'] || undefined, actionTimeout: 10_000 });

test('Grid creates and removes nearby land stacks and attachments without relating distant drops', async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(90_000);
  const context = await browser.newContext({ baseURL, viewport: { width: 1600, height: 1000 } });

  try {
    const runtime = await installGridTable(context, 4, 'p1');
    await context.addInitScript(() => {
      localStorage.setItem('commanderzone.fair-play-notice.p1.grid-fixture', '1');
    });
    configureGridRelationsFixture(runtime);

    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/games/grid-fixture');
    await page.locator('.zoom-toggle-button').click();
    await page.getByTestId('battlefield-zoom-grid-button').click();
    await expect.poll(() => runtime.sockets.length).toBe(1);

    const local = page.locator('[data-testid="grid-player-panel"][data-player-id="p1"]');
    const battlefield = local.getByTestId('battlefield-zone');
    const card = (instanceId: string) =>
      local.locator(`[data-testid="game-card"][data-card-instance-id="${instanceId}"]`);
    const landTop = card('p1:battlefield:0');
    const landUnder = card('p1:battlefield:1');
    const equipment = card('p1:battlefield:2');
    await expect(battlefield).toBeVisible();

    const stackStart = runtime.commands.length;
    runtime.respondWith(
      [
        {
          op: 'battlefieldStack.add',
          battlefieldStack: {
            id: 'grid-land-stack',
            ownerId: 'p1',
            stackedInstanceId: 'p1:battlefield:1',
            stackTopInstanceId: 'p1:battlefield:0',
            createdAt: new Date().toISOString(),
          },
        },
      ],
      'battlefield_stack.created',
    );
    await dragCardOntoCard(page, landUnder, landTop);
    await expectCommand(runtime, stackStart, 'battlefield_stack.created', {
      stackedInstanceId: 'p1:battlefield:1',
      stackTopInstanceId: 'p1:battlefield:0',
    });
    // Grid intentionally shares the permanent-pile presentation for land
    // stacks and attachments; the persisted command above identifies which
    // relation is being rendered.
    await expect(landTop).toHaveClass(/attachment-stack-target/);
    await expect(landUnder).toHaveClass(/attachment-stack-equipment/);

    const unstackStart = runtime.commands.length;
    runtime.respondWith(
      [{ op: 'battlefieldStack.remove', id: 'grid-land-stack' }],
      'battlefield_stack.removed',
    );
    await dragCardToPoint(
      page,
      landUnder,
      await distantBattlefieldPoint(battlefield, [landTop, landUnder, equipment]),
      { start: await exposedCardPoint(page, landUnder) },
    );
    await expectCommand(runtime, unstackStart, 'battlefield_stack.removed', {
      id: 'grid-land-stack',
    });
    await expect(landTop).not.toHaveClass(/attachment-stack-target/);
    await expect(landUnder).not.toHaveClass(/attachment-stack-equipment/);

    const attachStart = runtime.commands.length;
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
    await dragCardOntoCard(page, equipment, landTop);
    await expectCommand(runtime, attachStart, 'attachment.created', {
      equipmentInstanceId: 'p1:battlefield:2',
      attachedToInstanceId: 'p1:battlefield:0',
    });
    await expect(landTop).toHaveClass(/attachment-stack-target/);
    await expect(equipment).toHaveClass(/attachment-stack-equipment/);

    const detachStart = runtime.commands.length;
    runtime.respondWith([{ op: 'attachment.remove', id: 'grid-attachment' }], 'attachment.removed');
    await dragCardToPoint(
      page,
      equipment,
      await distantBattlefieldPoint(battlefield, [landTop, landUnder, equipment]),
      { start: await exposedCardPoint(page, equipment) },
    );
    await expectCommand(runtime, detachStart, 'attachment.removed', { id: 'grid-attachment' });
    await expect(landTop).not.toHaveClass(/attachment-stack-target/);
    await expect(equipment).not.toHaveClass(/attachment-stack-equipment/);

    const distantLandStart = runtime.commands.length;
    await dragCardToPoint(
      page,
      landUnder,
      await distantBattlefieldPoint(battlefield, [landTop, landUnder, equipment]),
    );
    await expectCommand(runtime, distantLandStart, 'card.position.changed', {
      instanceId: 'p1:battlefield:1',
    });
    expect(relationCommandTypes(runtime, distantLandStart)).not.toContain(
      'battlefield_stack.created',
    );
    expect(relationCommandTypes(runtime, distantLandStart)).not.toContain('attachment.created');
    await expect(landUnder).not.toHaveClass(/attachment-stack-equipment/);

    const distantEquipmentStart = runtime.commands.length;
    await dragCardToPoint(
      page,
      equipment,
      await distantBattlefieldPoint(battlefield, [landTop, landUnder, equipment]),
    );
    await expectCommand(runtime, distantEquipmentStart, 'card.position.changed', {
      instanceId: 'p1:battlefield:2',
    });
    expect(relationCommandTypes(runtime, distantEquipmentStart)).not.toContain(
      'battlefield_stack.created',
    );
    expect(relationCommandTypes(runtime, distantEquipmentStart)).not.toContain(
      'attachment.created',
    );
    await expect(equipment).not.toHaveClass(/attachment-stack-equipment/);

    await expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

type GridRuntime = Awaited<ReturnType<typeof installGridTable>>;
type GridCommand = GridRuntime['commands'][number];

interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

interface PointerDragOptions {
  readonly start?: ScreenPoint;
}

function configureGridRelationsFixture(runtime: GridRuntime): void {
  runtime.bootstrap.staticCards['p1:battlefield:0'].typeLine = 'Basic Land — Forest';
  runtime.bootstrap.staticCards['p1:battlefield:1'].typeLine = 'Basic Land — Forest';
  runtime.bootstrap.staticCards['p1:battlefield:2'].typeLine = 'Artifact — Equipment';
  runtime.bootstrap.instances['p1:battlefield:0'].position = { x: 0.14, y: 0.68, unit: 'ratio' };
  runtime.bootstrap.instances['p1:battlefield:1'].position = { x: 0.56, y: 0.42, unit: 'ratio' };
  runtime.bootstrap.instances['p1:battlefield:2'].position = { x: 0.82, y: 0.14, unit: 'ratio' };
}

async function dragCardOntoCard(page: Page, source: Locator, target: Locator): Promise<void> {
  const targetBounds = await target.boundingBox();
  if (!targetBounds) {
    throw new Error('Expected a measurable Grid relation target.');
  }

  await dragCardToPoint(page, source, center(targetBounds));
}

async function dragCardToPoint(
  page: Page,
  source: Locator,
  target: ScreenPoint,
  options: PointerDragOptions = {},
): Promise<void> {
  const sourceBounds = await source.boundingBox();
  if (!sourceBounds) {
    throw new Error('Expected a measurable Grid relation source.');
  }

  const start = options.start ?? center(sourceBounds);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 12 });
  await page.mouse.up();
}

async function exposedCardPoint(page: Page, card: Locator): Promise<ScreenPoint> {
  const instanceId = await card.getAttribute('data-card-instance-id');
  const bounds = await card.boundingBox();
  if (!instanceId || !bounds) {
    throw new Error('Expected a measurable stacked Grid card.');
  }

  const point = await page.evaluate(
    ({ instanceId: expectedInstanceId, bounds: cardBounds }) => {
      const minX = Math.ceil(cardBounds.x + 2);
      const maxX = Math.floor(cardBounds.x + cardBounds.width - 2);
      const minY = Math.ceil(cardBounds.y + 2);
      const maxY = Math.floor(cardBounds.y + cardBounds.height - 2);

      for (let y = minY; y <= maxY; y += 2) {
        for (let x = minX; x <= maxX; x += 2) {
          const hit = document
            .elementFromPoint(x, y)
            ?.closest<HTMLElement>('[data-testid="game-card"][data-card-instance-id]');
          if (hit?.dataset['cardInstanceId'] === expectedInstanceId) {
            return { x, y };
          }
        }
      }

      return null;
    },
    { instanceId, bounds },
  );
  if (!point) {
    throw new Error(`Could not find an exposed pointer target for ${instanceId}.`);
  }

  return point;
}

async function distantBattlefieldPoint(
  battlefield: Locator,
  cards: readonly Locator[],
): Promise<ScreenPoint> {
  const [battlefieldBounds, ...cardBounds] = await Promise.all([
    battlefield.boundingBox(),
    ...cards.map((card) => card.boundingBox()),
  ]);
  if (!battlefieldBounds || cardBounds.some((bounds) => !bounds)) {
    throw new Error('Expected measurable Grid battlefield cards.');
  }

  const visibleCards = cardBounds.filter(
    (bounds): bounds is NonNullable<typeof bounds> => bounds !== null,
  );
  const candidates = [
    { x: 0.16, y: 0.22 },
    { x: 0.82, y: 0.22 },
    { x: 0.16, y: 0.7 },
    { x: 0.82, y: 0.7 },
  ].map(({ x, y }) => ({
    x: battlefieldBounds.x + battlefieldBounds.width * x,
    y: battlefieldBounds.y + battlefieldBounds.height * y,
  }));
  const point = candidates
    .map((candidate) => ({
      candidate,
      distance: Math.min(
        ...visibleCards.map((bounds) =>
          Math.hypot(candidate.x - center(bounds).x, candidate.y - center(bounds).y),
        ),
      ),
    }))
    .sort((left, right) => right.distance - left.distance)[0];
  const largestCardDimension = Math.max(
    ...visibleCards.flatMap((bounds) => [bounds.width, bounds.height]),
  );
  if (!point || point.distance < largestCardDimension * 1.4) {
    throw new Error('Could not find a Grid drop point sufficiently far from every card.');
  }

  return point.candidate;
}

function center(bounds: {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}): ScreenPoint {
  return {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  };
}

async function expectCommand(
  runtime: GridRuntime,
  startIndex: number,
  type: string,
  expectedPayload: Readonly<Record<string, string>>,
): Promise<void> {
  await expect
    .poll(() =>
      runtime.commands
        .slice(startIndex)
        .some((command) => matchesCommand(command, type, expectedPayload)),
    )
    .toBe(true);
}

function relationCommandTypes(runtime: GridRuntime, startIndex: number): readonly string[] {
  return runtime.commands
    .slice(startIndex)
    .filter(
      (command): command is Extract<GridCommand, { readonly kind: 'command.v2' }> =>
        command.kind === 'command.v2',
    )
    .map((command) => command.type);
}

function matchesCommand(
  command: GridCommand,
  type: string,
  expectedPayload: Readonly<Record<string, string>>,
): boolean {
  if (command.kind !== 'command.v2' || command.type !== type || !isRecord(command.payload)) {
    return false;
  }

  return Object.entries(expectedPayload).every(([key, value]) => command.payload[key] === value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
