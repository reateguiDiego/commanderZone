import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { type APIRequestContext } from '@playwright/test';
import type { RealUserSession } from './auth';

const API_BASE_URL = process.env['E2E_API_BASE_URL'] ?? 'http://127.0.0.1:8000';
const execFileAsync = promisify(execFile);

export function isLocalModerationE2eEnabled(): boolean {
  return process.env['CZ_E2E_DOCKER_ROLE_GRANT'] === '1';
}

export async function grantLocalModeratorRole(
  request: APIRequestContext,
  session: RealUserSession,
): Promise<RealUserSession> {
  if (!isLocalModerationE2eEnabled()) {
    throw new Error('Local Docker role granting is disabled. Set CZ_E2E_DOCKER_ROLE_GRANT=1 to enable it.');
  }
  if (process.env['NODE_ENV'] === 'production') {
    throw new Error('The moderation E2E role helper must never run in production.');
  }

  await runApiConsole([
    'app:e2e:grant-role',
    '--email',
    session.credentials.email,
    '--role',
    'ROLE_ADMIN',
  ]);

  const refreshed = await request.post(`${API_BASE_URL}/auth/refresh`, {
    headers: { Cookie: `commanderzone.refresh=${session.refreshToken}` },
  });
  if (!refreshed.ok()) {
    throw new Error(`Refreshing the locally elevated moderator failed: ${refreshed.status()} ${await refreshed.text()}`);
  }
  const refreshedPayload = await refreshed.json() as { token?: string };
  const token = typeof refreshedPayload.token === 'string' ? refreshedPayload.token : '';
  const refreshToken = refreshTokenFromResponse(refreshed.headers()['set-cookie'] ?? '');
  if (token.length < 10 || refreshToken.length < 10) {
    throw new Error('Refreshing the locally elevated moderator did not issue usable credentials.');
  }

  const response = await request.get(`${API_BASE_URL}/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok()) {
    throw new Error(`Refreshing the locally elevated moderator failed: ${response.status()} ${await response.text()}`);
  }
  const payload = await response.json() as { user?: RealUserSession['user'] };
  if (!payload.user) {
    throw new Error('Refreshing the locally elevated moderator did not return a user.');
  }

  return { ...session, token, refreshToken, user: payload.user };
}

function refreshTokenFromResponse(setCookie: string): string {
  const match = setCookie.match(/commanderzone\.refresh=([^;]+)/);

  return match?.[1] ?? '';
}

export async function drainLocalModerationEvidence(): Promise<void> {
  if (!isLocalModerationE2eEnabled()) {
    throw new Error('Local Docker moderation evidence draining is disabled.');
  }

  await runApiConsole(['app:moderation-evidence-worker', '--batch-size=250']);
}

async function runApiConsole(consoleArguments: readonly string[]): Promise<void> {
  const composeDirectory = process.env['CZ_E2E_COMPOSE_DIR']
    ? resolve(process.env['CZ_E2E_COMPOSE_DIR'])
    : resolve(process.cwd(), '..');
  const command = [
    'compose',
    'exec',
    '-T',
    'api',
    'php',
    'bin/console',
    ...consoleArguments,
    '--no-interaction',
  ];

  try {
    await execFileAsync('docker', command, { cwd: composeDirectory, windowsHide: true });
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Local moderation E2E console command failed: ${detail}`);
  }
}
