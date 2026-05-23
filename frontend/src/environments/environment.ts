const runtimeHostname = typeof globalThis !== 'undefined' && globalThis.location
  ? globalThis.location.hostname
  : '127.0.0.1';

const localApiHost = runtimeHostname.trim() !== '' ? runtimeHostname : '127.0.0.1';

export const environment = {
  production: false,
  apiBaseUrl: `http://${localApiHost}:8000`,
  mercureUrl: `http://${localApiHost}:3000/.well-known/mercure`,
} as const;
