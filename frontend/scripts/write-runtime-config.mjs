import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const frontendRoot = resolve(import.meta.dirname, '..');
const workspaceRoot = resolve(frontendRoot, '..');
const runtimeConfigPath = resolve(frontendRoot, 'public', 'runtime-config.js');
const localEnv = {
  ...readEnvFile(resolve(workspaceRoot, '.env')),
  ...readEnvFile(resolve(frontendRoot, '.env')),
};

const googleClientId = firstNonEmpty([
  process.env.GOOGLE_CLIENT_ID,
  process.env.COMMANDERZONE_GOOGLE_CLIENT_ID,
  firstConfiguredClientId(process.env.GOOGLE_OIDC_CLIENT_IDS),
  localEnv.GOOGLE_CLIENT_ID,
  localEnv.COMMANDERZONE_GOOGLE_CLIENT_ID,
  firstConfiguredClientId(localEnv.GOOGLE_OIDC_CLIENT_IDS),
]);

const config = {
  googleClientId,
};

writeFileSync(
  runtimeConfigPath,
  `globalThis.commanderZoneRuntimeConfig = Object.freeze(${JSON.stringify(config, null, 2)});\n`,
  'utf8',
);
console.log(`Wrote runtime config to ${runtimeConfigPath}`);

function firstConfiguredClientId(value) {
  return value?.split(',').map((clientId) => clientId.trim()).find(Boolean) ?? '';
}

function firstNonEmpty(values) {
  return values.map(normalizeClientId).find(Boolean) ?? '';
}

function normalizeClientId(value) {
  return value?.trim() ?? '';
}

function readEnvFile(path) {
  if (!existsSync(path)) {
    return {};
  }

  return Object.fromEntries(
    readFileSync(path, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const [key, ...rawValueParts] = line.split('=');
        const rawValue = rawValueParts.join('=').trim();
        return [key.trim(), unquote(rawValue)];
      }),
  );
}

function unquote(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }

  return value;
}
