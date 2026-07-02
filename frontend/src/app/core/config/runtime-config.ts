export interface CommanderZoneRuntimeConfig {
  readonly googleClientId?: string;
}

declare global {
  // Loaded from /runtime-config.js before Angular bootstraps.
  // eslint-disable-next-line no-var
  var commanderZoneRuntimeConfig: CommanderZoneRuntimeConfig | undefined;
}

export function runtimeGoogleClientId(): string {
  return globalThis.commanderZoneRuntimeConfig?.googleClientId?.trim() ?? '';
}
