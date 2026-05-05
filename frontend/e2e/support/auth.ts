import { expect, type APIRequestContext, type Browser, type BrowserContext } from '@playwright/test';

const API_BASE_URL = process.env['E2E_API_BASE_URL'] ?? 'http://127.0.0.1:8000';

export interface E2EAuthUser {
  id: string;
  email: string;
  displayName: string;
  roles: string[];
}

export interface AuthenticatedContextResult {
  context: BrowserContext;
  token: string;
  user: E2EAuthUser;
  credentials: {
    email: string;
    password: string;
    displayName: string;
  };
}

export interface RealUserSession {
  token: string;
  user: E2EAuthUser;
  credentials: {
    email: string;
    password: string;
    displayName: string;
  };
}

export async function createRealUserSession(request: APIRequestContext, prefix = 'e2e'): Promise<RealUserSession> {
  const credentials = uniqueCredentials(prefix);

  const registerResponse = await request.post(`${API_BASE_URL}/auth/register`, {
    data: credentials,
  });
  expect(registerResponse.ok()).toBeTruthy();

  const loginResponse = await request.post(`${API_BASE_URL}/auth/login`, {
    data: {
      email: credentials.email,
      password: credentials.password,
    },
  });
  expect(loginResponse.ok()).toBeTruthy();
  const loginPayload = (await loginResponse.json()) as { token: string };
  const token = String(loginPayload.token ?? '');
  expect(token.length).toBeGreaterThan(10);

  const meResponse = await request.get(`${API_BASE_URL}/me`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  expect(meResponse.ok()).toBeTruthy();
  const mePayload = (await meResponse.json()) as { user: E2EAuthUser };

  return { token, user: mePayload.user, credentials };
}

export function authStorageState(baseURL: string, token: string, user: E2EAuthUser): {
  cookies: [];
  origins: Array<{ origin: string; localStorage: Array<{ name: string; value: string }> }>;
} {
  return {
    cookies: [],
    origins: [
      {
        origin: new URL(baseURL).origin,
        localStorage: [
          { name: 'commanderzone.jwt', value: token },
          { name: 'commanderzone.user', value: JSON.stringify(user) },
        ],
      },
    ],
  };
}

export async function createAuthenticatedContext(
  browser: Browser,
  request: APIRequestContext,
  baseURL: string,
  prefix = 'e2e',
): Promise<AuthenticatedContextResult> {
  const { token, user, credentials } = await createRealUserSession(request, prefix);

  const context = await browser.newContext({
    baseURL,
    storageState: authStorageState(baseURL, token, user),
  });

  return { context, token, user, credentials };
}

function uniqueCredentials(prefix: string): { email: string; password: string; displayName: string } {
  const token = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  return {
    email: `${prefix}-${token}@example.test`,
    password: `Pass-${token}-1234`,
    displayName: `${prefix}-${token}`,
  };
}
