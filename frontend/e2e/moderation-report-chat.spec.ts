import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { authStorageState, createRealUserSession } from './support/auth';
import { createCommanderGameWithValidDecks, resolveGameToPlaying } from './support/commander-game';
import { openChat } from './support/game-table';
import {
  drainLocalModerationEvidence,
  grantLocalModeratorRole,
  isLocalModerationE2eEnabled,
} from './support/moderation';
import { sendRuntimeCommand } from './support/runtime-websocket';

const API_BASE_URL = process.env['E2E_API_BASE_URL'] ?? 'http://127.0.0.1:8000';

test.skip(!isLocalModerationE2eEnabled(), 'Set CZ_E2E_DOCKER_ROLE_GRANT=1 for the local-only moderation E2E.');
test.use({ channel: process.env['E2E_BROWSER_CHANNEL'] || undefined, actionTimeout: 15_000 });

test('chat report captures evidence, reaches the moderator queue, and issues one strike', async ({ browser, request, baseURL }) => {
  test.setTimeout(240_000);
  if (!baseURL) {
    throw new Error('Playwright baseURL is required.');
  }

  const setup = await createCommanderGameWithValidDecks(request, {
    playerAPrefix: 'moderation-reported',
    playerBPrefix: 'moderation-reporter',
  });
  const { gameId, playerA, playerB } = setup;
  await resolveGameToPlaying(request, gameId, [playerA, playerB]);

  const moderator = await grantLocalModeratorRole(request, await createRealUserSession(request, 'moderation-reviewer'));
  const pendingBefore = await pendingReviewCount(request, moderator.token);
  const contextA = await browser.newContext({
    baseURL,
    storageState: authStorageState(baseURL, playerA.user, playerA.refreshToken),
  });
  const contextB = await browser.newContext({
    baseURL,
    storageState: authStorageState(baseURL, playerB.user, playerB.refreshToken),
  });
  const moderatorContext = await browser.newContext({
    baseURL,
    storageState: authStorageState(baseURL, moderator.user, moderator.refreshToken),
  });

  try {
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();
    const moderatorPage = await moderatorContext.newPage();
    await Promise.all([pageA.goto(`/games/${gameId}`), pageB.goto(`/games/${gameId}`)]);
    await Promise.all([
      expect(pageA.getByTestId('game-screen')).toBeVisible(),
      expect(pageB.getByTestId('game-screen')).toBeVisible(),
    ]);
    await Promise.all([acknowledgeFairPlay(pageA), acknowledgeFairPlay(pageB)]);

    await Promise.all([openChat(pageA), openChat(pageB)]);
    const message = `moderation-report-${Date.now()}`;
    await pageA.getByTestId('chat-input').fill(message);
    await pageA.getByTestId('chat-input').press('Enter');

    const messageRow = pageB.getByTestId('chat-message').filter({ hasText: message });
    await expect(messageRow).toBeVisible();
    await messageRow.hover();
    const reportAction = pageB.getByTestId('chat-report-message');
    await expect(reportAction).toBeVisible();
    await reportAction.click();

    const reportModal = pageB.locator('app-report-modal .modal-panel');
    await expect(reportModal).toBeVisible();
    await reportModal.locator('select').selectOption('public_offensive_content');
    const submission = pageB.waitForResponse((response) => (
      response.request().method() === 'POST' && new URL(response.url()).pathname === '/reports'
    ));
    await reportModal.locator('button.primary-button').click();
    const submissionResponse = await submission;
    expect(submissionResponse.status()).toBe(201);
    const reportPayload = await submissionResponse.json() as { report: { id: string; status: string } };
    expect(reportPayload.report.status).toBe('collecting_evidence');

    await sendRuntimeCommand(request, {
      gameId,
      token: playerB.token,
      baseVersion: await gameVersion(request, gameId, playerB.token),
      type: 'game.concede',
      payload: { playerId: playerB.user.id },
    });
    await expect.poll(() => gameSnapshotStatus(request, gameId, playerA.token)).toBe(403);
    await drainLocalModerationEvidence();
    await expect.poll(() => pendingReport(request, moderator.token, reportPayload.report.id)).toMatchObject({
      id: reportPayload.report.id,
      status: 'pending_review',
    });
    await expect.poll(() => pendingReviewCount(request, moderator.token)).toBe(pendingBefore + 1);
    const queuePage = await pageContainingReport(request, moderator.token, reportPayload.report.id);
    if (queuePage === null) {
      throw new Error(`Moderation queue did not contain report ${reportPayload.report.id}.`);
    }

    await moderatorPage.goto('/admin');
    await expect(moderatorPage.locator('.admin-report-badge')).toHaveText(moderationBadgeText(pendingBefore + 1));
    await moderatorPage.locator('.admin-nav-item').filter({ hasText: 'Reports' }).click();
    for (let page = 1; page < queuePage; page += 1) {
      const nextPage = moderatorPage.locator('.admin-report-queue__pagination button').last();
      await expect(nextPage).toBeEnabled();
      await nextPage.click();
    }
    const queueItem = moderatorPage.locator('.admin-report-queue__item').filter({ hasText: playerA.user.displayName });
    await expect(queueItem).toBeVisible();
    await queueItem.click();
    await expect(moderatorPage.locator('.admin-report-detail')).toContainText(message);

    await moderatorPage.locator('select[name="resolutionOutcome"]').selectOption('strike');
    await moderatorPage.locator('textarea[name="strikeDescription"]').fill('Repeated offensive chat behavior.');
    const resolution = moderatorPage.waitForResponse((response) => (
      response.request().method() === 'PATCH'
      && new URL(response.url()).pathname === `/admin/reports/${reportPayload.report.id}/resolution`
    ));
    await moderatorPage.locator('.admin-report-resolution button').click();
    expect((await resolution).ok()).toBeTruthy();

    await expect.poll(() => moderationProfile(request, moderator.token, playerA.user.id)).toMatchObject({
      user: { reportsReceivedCount: 1, strikesCount: 1 },
      strikes: [expect.objectContaining({ description: 'Repeated offensive chat behavior.' })],
    });
    await expect.poll(() => moderationProfile(request, moderator.token, playerB.user.id)).toMatchObject({
      user: { reportsMadeCount: 1 },
    });
  } finally {
    await Promise.all([contextA.close(), contextB.close(), moderatorContext.close()]);
  }
});

async function acknowledgeFairPlay(page: Page): Promise<void> {
  const notice = page.getByTestId('fair-play-notice');
  await expect(notice).toBeVisible();
  await notice.getByTestId('fair-play-notice-dismiss').click();
  await expect(notice).toBeHidden();
}

async function gameVersion(request: APIRequestContext, gameId: string, token: string): Promise<number> {
  const response = await request.get(`${API_BASE_URL}/games/${gameId}/snapshot`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok()) {
    throw new Error(`Could not read game version: ${response.status()} ${await response.text()}`);
  }
  const payload = await response.json() as { game?: { snapshot?: { version?: number } } };

  return Math.max(1, Number(payload.game?.snapshot?.version ?? 1));
}

async function gameSnapshotStatus(request: APIRequestContext, gameId: string, token: string): Promise<number> {
  const response = await request.get(`${API_BASE_URL}/games/${gameId}/snapshot`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  return response.status();
}

async function pendingReport(
  request: APIRequestContext,
  token: string,
  reportId: string,
): Promise<Record<string, unknown> | null> {
  const response = await request.get(`${API_BASE_URL}/admin/reports/${reportId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok()) {
    return null;
  }
  const payload = await response.json() as { report?: Record<string, unknown> };

  return payload.report ?? null;
}

async function pageContainingReport(
  request: APIRequestContext,
  token: string,
  reportId: string,
): Promise<number | null> {
  const headers = { Authorization: `Bearer ${token}` };
  const firstResponse = await request.get(`${API_BASE_URL}/admin/reports?limit=30`, { headers });
  if (!firstResponse.ok()) {
    return null;
  }
  const firstPage = await firstResponse.json() as {
    reports?: Array<{ id?: string }>;
    totalPages?: number;
  };
  if ((firstPage.reports ?? []).some((report) => report.id === reportId)) {
    return 1;
  }

  const totalPages = Math.max(1, Number(firstPage.totalPages ?? 1));
  for (let page = 2; page <= totalPages; page += 1) {
    const response = await request.get(`${API_BASE_URL}/admin/reports?limit=30&page=${page}`, { headers });
    if (!response.ok()) {
      return null;
    }
    const payload = await response.json() as { reports?: Array<{ id?: string }> };
    if ((payload.reports ?? []).some((report) => report.id === reportId)) {
      return page;
    }
  }

  return null;
}

async function pendingReviewCount(request: APIRequestContext, token: string): Promise<number> {
  const response = await request.get(`${API_BASE_URL}/admin/reports/summary`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok()) {
    throw new Error(`Could not load moderation summary: ${response.status()} ${await response.text()}`);
  }
  const payload = await response.json() as { pendingReviewCount?: unknown };

  return Number(payload.pendingReviewCount ?? 0);
}

function moderationBadgeText(count: number): string {
  return count > 99 ? '99+' : String(count);
}

async function moderationProfile(
  request: APIRequestContext,
  token: string,
  userId: string,
): Promise<Record<string, unknown> | null> {
  const response = await request.get(`${API_BASE_URL}/admin/users/${userId}/moderation`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok()) {
    return null;
  }

  return response.json() as Promise<Record<string, unknown>>;
}
