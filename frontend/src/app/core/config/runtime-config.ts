export interface CommanderZoneRuntimeConfig {
  readonly googleClientId?: string;
  readonly googleAdsenseClient?: string;
}

declare global {
  // Loaded from /runtime-config.js before Angular bootstraps.
  // eslint-disable-next-line no-var
  var commanderZoneRuntimeConfig: CommanderZoneRuntimeConfig | undefined;
}

export function runtimeGoogleClientId(): string {
  return globalThis.commanderZoneRuntimeConfig?.googleClientId?.trim() ?? '';
}

export function runtimeGoogleAdsenseClient(): string {
  return globalThis.commanderZoneRuntimeConfig?.googleAdsenseClient?.trim() ?? '';
}
