import { expect, type APIRequestContext, type APIResponse, type Browser, type BrowserContext } from '@playwright/test';

const API_BASE_URL = process.env['E2E_API_BASE_URL'] ?? 'http://localhost:8000';
const MAILPIT_API_BASE_URL = process.env['E2E_MAILPIT_API_BASE_URL'] ?? 'http://127.0.0.1:8025';

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
  refreshToken: string;
  user: E2EAuthUser;
  credentials: {
    email: string;
    password: string;
    displayName: string;
  };
}

export async function createRealUserSession(request: APIRequestContext, prefix = 'e2e'): Promise<RealUserSession> {
  const credentials = uniqueCredentials(prefix);
  let refreshToken = '';

  const registerResponse = await request.post(`${API_BASE_URL}/auth/register`, {
    data: credentials,
  });
  if (!registerResponse.ok()) {
    throw new Error(`Register E2E user failed (${registerResponse.status()}): ${await registerResponse.text()}`);
  }
  const registerPayload = (await registerResponse.json()) as {
    emailVerificationToken?: string;
  };

  let token = '';
  const verificationToken = typeof registerPayload.emailVerificationToken === 'string' && registerPayload.emailVerificationToken.trim() !== ''
    ? registerPayload.emailVerificationToken
    : await readEmailVerificationToken(request, credentials.email);

  if (verificationToken) {
    const verificationResponse = await request.post(`${API_BASE_URL}/auth/email-verification/confirm`, {
      data: {
        token: verificationToken,
      },
    });
    expect(verificationResponse.ok()).toBeTruthy();
    const verificationPayload = (await verificationResponse.json()) as { token?: string };
    token = String(verificationPayload.token ?? '');
    refreshToken = extractRefreshToken(verificationResponse) ?? refreshToken;
  }

  if (!token) {
    const loginResponse = await request.post(`${API_BASE_URL}/auth/login`, {
      data: {
        email: credentials.email,
        password: credentials.password,
      },
    });
    expect(loginResponse.ok()).toBeTruthy();
    const loginPayload = (await loginResponse.json()) as { token: string };
    token = String(loginPayload.token ?? '');
    refreshToken = extractRefreshToken(loginResponse) ?? refreshToken;
  }

  expect(token.length).toBeGreaterThan(10);
  expect(refreshToken.length).toBeGreaterThan(10);

  const meResponse = await request.get(`${API_BASE_URL}/me`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  await expectApiOk(meResponse, 'load current E2E user');
  const mePayload = (await meResponse.json()) as { user: E2EAuthUser };

  return { token, refreshToken, user: mePayload.user, credentials };
}

export function authStorageState(baseURL: string, user: E2EAuthUser, refreshToken: string): {
  cookies: Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
    expires: number;
    httpOnly: boolean;
    secure: boolean;
    sameSite: 'Lax';
  }>;
  origins: Array<{ origin: string; localStorage: Array<{ name: string; value: string }> }>;
} {
  const apiOrigin = new URL(API_BASE_URL);
  const apiHost = apiOrigin.hostname;
  const isSecure = apiOrigin.protocol === 'https:';

  return {
    cookies: [
      {
        name: 'commanderzone.refresh',
        value: refreshToken,
        domain: apiHost,
        path: '/auth',
        expires: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
        httpOnly: true,
        secure: isSecure,
        sameSite: 'Lax',
      },
    ],
    origins: [
      {
        origin: new URL(baseURL).origin,
        localStorage: [
          { name: 'commanderzone.user', value: JSON.stringify(user) },
          {
            name: 'commanderzone.cookieConsent',
            value: JSON.stringify({
              analytics: false,
              decision: 'rejected',
              updatedAt: new Date().toISOString(),
            }),
          },
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
  const { token, refreshToken, user, credentials } = await createRealUserSession(request, prefix);

  const context = await browser.newContext({
    baseURL,
    storageState: authStorageState(baseURL, user, refreshToken),
  });

  return { context, token, user, credentials };
}

function extractRefreshToken(response: APIResponse): string | null {
  const setCookie = response.headers()['set-cookie'] ?? '';
  const match = setCookie.match(/commanderzone\.refresh=([^;]+)/);
  if (!match) {
    return null;
  }

  return match[1] ?? null;
}

function uniqueCredentials(prefix: string): { email: string; password: string; displayName: string } {
  const token = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const firstNames = ['Alex', 'Sofia', 'Lucas', 'Marta', 'Diego', 'Nora', 'Leo', 'Carla', 'Hugo', 'Paula'];
  const lastNames = ['Rivera', 'Morales', 'Vega', 'Navarro', 'Santos', 'Lopez', 'Castro', 'Serrano', 'Campos', 'Ortega'];
  const firstName = firstNames[Math.floor(Math.random() * firstNames.length)] ?? 'Alex';
  const lastName = lastNames[Math.floor(Math.random() * lastNames.length)] ?? 'Rivera';
  const displaySuffix = token.replace(/[^a-z0-9]/gi, '').slice(-6);

  return {
    email: `${prefix}-${token}@example.test`,
    password: `Pass-${token}-1234`,
    displayName: `${firstName} ${lastName[0]} ${displaySuffix}`,
  };
}

async function readEmailVerificationToken(request: APIRequestContext, email: string): Promise<string | null> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await request.get(`${MAILPIT_API_BASE_URL}/api/v1/messages`);
    if (response.ok()) {
      const payload = (await response.json()) as {
        messages?: Array<{
          To?: Array<{ Address?: string }>;
          Snippet?: string;
        }>;
      };
      const message = (payload.messages ?? []).find((candidate) =>
        (candidate.To ?? []).some((recipient) => recipient.Address?.toLowerCase() === email.toLowerCase()),
      );
      const token = extractEmailVerificationToken(message?.Snippet ?? '');
      if (token) {
        return token;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  return null;
}

function extractEmailVerificationToken(text: string): string | null {
  const match = text.match(/[?&]token=([A-Za-z0-9_-]+)/);

  return match?.[1] ?? null;
}

async function expectApiOk(response: APIResponse, action: string): Promise<void> {
  if (response.ok()) {
    return;
  }

  const body = await response.text();
  throw new Error(`Failed to ${action}. HTTP ${response.status()}: ${body}`);
}
