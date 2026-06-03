export const environment = {
  production: true,
  apiBaseUrl: 'https://api.commanderzone.com',
  mercureUrl: 'https://api.commanderzone.com/.well-known/mercure',
  // Optional Google Search Console HTML meta verification token.
  // Prefer DNS TXT verification. If meta verification is required, paste only the real token from Search Console.
  googleSearchConsoleVerification: '',
} as const;
