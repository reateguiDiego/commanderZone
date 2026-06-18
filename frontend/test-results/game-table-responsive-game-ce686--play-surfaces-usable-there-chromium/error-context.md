# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: game-table-responsive.spec.ts >> game table requires landscape on mobile and tablet and keeps play surfaces usable there
- Location: e2e\game-table-responsive.spec.ts:7:5

# Error details

```
Error: expect(received).toBeTruthy()

Received: false
```

# Test source

```ts
  1   | import { expect, type APIRequestContext, type APIResponse, type Browser, type BrowserContext } from '@playwright/test';
  2   | 
  3   | const API_BASE_URL = process.env['E2E_API_BASE_URL'] ?? 'http://localhost:8000';
  4   | 
  5   | export interface E2EAuthUser {
  6   |   id: string;
  7   |   email: string;
  8   |   displayName: string;
  9   |   roles: string[];
  10  | }
  11  | 
  12  | export interface AuthenticatedContextResult {
  13  |   context: BrowserContext;
  14  |   token: string;
  15  |   user: E2EAuthUser;
  16  |   credentials: {
  17  |     email: string;
  18  |     password: string;
  19  |     displayName: string;
  20  |   };
  21  | }
  22  | 
  23  | export interface RealUserSession {
  24  |   token: string;
  25  |   refreshToken: string;
  26  |   user: E2EAuthUser;
  27  |   credentials: {
  28  |     email: string;
  29  |     password: string;
  30  |     displayName: string;
  31  |   };
  32  | }
  33  | 
  34  | export async function createRealUserSession(request: APIRequestContext, prefix = 'e2e'): Promise<RealUserSession> {
  35  |   const credentials = uniqueCredentials(prefix);
  36  |   let refreshToken = '';
  37  | 
  38  |   const registerResponse = await request.post(`${API_BASE_URL}/auth/register`, {
  39  |     data: credentials,
  40  |   });
  41  |   expect(registerResponse.ok()).toBeTruthy();
  42  |   const registerPayload = (await registerResponse.json()) as {
  43  |     emailVerificationToken?: string;
  44  |   };
  45  | 
  46  |   let token = '';
  47  |   if (typeof registerPayload.emailVerificationToken === 'string' && registerPayload.emailVerificationToken.trim() !== '') {
  48  |     const verificationResponse = await request.post(`${API_BASE_URL}/auth/email-verification/confirm`, {
  49  |       data: {
  50  |         token: registerPayload.emailVerificationToken,
  51  |       },
  52  |     });
  53  |     expect(verificationResponse.ok()).toBeTruthy();
  54  |     const verificationPayload = (await verificationResponse.json()) as { token?: string };
  55  |     token = String(verificationPayload.token ?? '');
  56  |     refreshToken = extractRefreshToken(verificationResponse) ?? refreshToken;
  57  |   }
  58  | 
  59  |   if (!token) {
  60  |     const loginResponse = await request.post(`${API_BASE_URL}/auth/login`, {
  61  |       data: {
  62  |         email: credentials.email,
  63  |         password: credentials.password,
  64  |       },
  65  |     });
> 66  |     expect(loginResponse.ok()).toBeTruthy();
      |                                ^ Error: expect(received).toBeTruthy()
  67  |     const loginPayload = (await loginResponse.json()) as { token: string };
  68  |     token = String(loginPayload.token ?? '');
  69  |     refreshToken = extractRefreshToken(loginResponse) ?? refreshToken;
  70  |   }
  71  | 
  72  |   expect(token.length).toBeGreaterThan(10);
  73  |   expect(refreshToken.length).toBeGreaterThan(10);
  74  | 
  75  |   const meResponse = await request.get(`${API_BASE_URL}/me`, {
  76  |     headers: {
  77  |       Authorization: `Bearer ${token}`,
  78  |     },
  79  |   });
  80  |   await expectApiOk(meResponse, 'load current E2E user');
  81  |   const mePayload = (await meResponse.json()) as { user: E2EAuthUser };
  82  | 
  83  |   return { token, refreshToken, user: mePayload.user, credentials };
  84  | }
  85  | 
  86  | export function authStorageState(baseURL: string, user: E2EAuthUser, refreshToken: string): {
  87  |   cookies: Array<{
  88  |     name: string;
  89  |     value: string;
  90  |     domain: string;
  91  |     path: string;
  92  |     expires: number;
  93  |     httpOnly: boolean;
  94  |     secure: boolean;
  95  |     sameSite: 'Lax';
  96  |   }>;
  97  |   origins: Array<{ origin: string; localStorage: Array<{ name: string; value: string }> }>;
  98  | } {
  99  |   const apiOrigin = new URL(API_BASE_URL);
  100 |   const apiHost = apiOrigin.hostname;
  101 |   const isSecure = apiOrigin.protocol === 'https:';
  102 | 
  103 |   return {
  104 |     cookies: [
  105 |       {
  106 |         name: 'commanderzone.refresh',
  107 |         value: refreshToken,
  108 |         domain: apiHost,
  109 |         path: '/auth',
  110 |         expires: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
  111 |         httpOnly: true,
  112 |         secure: isSecure,
  113 |         sameSite: 'Lax',
  114 |       },
  115 |     ],
  116 |     origins: [
  117 |       {
  118 |         origin: new URL(baseURL).origin,
  119 |         localStorage: [
  120 |           { name: 'commanderzone.user', value: JSON.stringify(user) },
  121 |         ],
  122 |       },
  123 |     ],
  124 |   };
  125 | }
  126 | 
  127 | export async function createAuthenticatedContext(
  128 |   browser: Browser,
  129 |   request: APIRequestContext,
  130 |   baseURL: string,
  131 |   prefix = 'e2e',
  132 | ): Promise<AuthenticatedContextResult> {
  133 |   const { token, refreshToken, user, credentials } = await createRealUserSession(request, prefix);
  134 | 
  135 |   const context = await browser.newContext({
  136 |     baseURL,
  137 |     storageState: authStorageState(baseURL, user, refreshToken),
  138 |   });
  139 | 
  140 |   return { context, token, user, credentials };
  141 | }
  142 | 
  143 | function extractRefreshToken(response: APIResponse): string | null {
  144 |   const setCookie = response.headers()['set-cookie'] ?? '';
  145 |   const match = setCookie.match(/commanderzone\.refresh=([^;]+)/);
  146 |   if (!match) {
  147 |     return null;
  148 |   }
  149 | 
  150 |   return match[1] ?? null;
  151 | }
  152 | 
  153 | function uniqueCredentials(prefix: string): { email: string; password: string; displayName: string } {
  154 |   const token = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  155 |   const firstNames = ['Alex', 'Sofia', 'Lucas', 'Marta', 'Diego', 'Nora', 'Leo', 'Carla', 'Hugo', 'Paula'];
  156 |   const lastNames = ['Rivera', 'Morales', 'Vega', 'Navarro', 'Santos', 'Lopez', 'Castro', 'Serrano', 'Campos', 'Ortega'];
  157 |   const firstName = firstNames[Math.floor(Math.random() * firstNames.length)] ?? 'Alex';
  158 |   const lastName = lastNames[Math.floor(Math.random() * lastNames.length)] ?? 'Rivera';
  159 |   const displaySuffix = token.replace(/[^a-z0-9]/gi, '').slice(-6);
  160 | 
  161 |   return {
  162 |     email: `${prefix}-${token}@example.test`,
  163 |     password: `Pass-${token}-1234`,
  164 |     displayName: `${firstName} ${lastName[0]} ${displaySuffix}`,
  165 |   };
  166 | }
```