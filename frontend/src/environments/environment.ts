const runtimeHostname = typeof globalThis !== 'undefined' && globalThis.location
  ? globalThis.location.hostname
  : '127.0.0.1';

const localApiHost = runtimeHostname.trim() !== '' ? runtimeHostname : '127.0.0.1';
const localDebugWebsocketHost = localApiHost === 'localhost' ? '127.0.0.1' : localApiHost;

export const environment = {
  production: false,
  apiBaseUrl: `http://${localApiHost}:8000`,
  mercureUrl: `http://${localApiHost}:3000/.well-known/mercure`,
  gameDebugWebsocketBaseUrl: `ws://${localDebugWebsocketHost}:8081`,
  gameplayV2FrontendEnabled: true,
  // Optional Google Search Console HTML meta verification token.
  // Prefer DNS TXT verification. If meta verification is required, paste only the real token from Search Console.
  googleSearchConsoleVerification: '',
} as const;
