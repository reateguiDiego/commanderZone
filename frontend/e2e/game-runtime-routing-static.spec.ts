import { expect, test } from '@playwright/test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const E2E_ROOT = join(process.cwd(), 'e2e');
const LEGACY_COMPATIBILITY_SPECS = new Set([
  'game-rollback-legacy-smoke.spec.ts',
]);

test('E2E runtime-primary helpers do not post gameplay commands through legacy HTTP', () => {
  const offenders: string[] = [];
  for (const file of tsFiles(E2E_ROOT)) {
    const relativePath = relative(E2E_ROOT, file).replaceAll('\\', '/');
    if (relativePath === 'game-runtime-routing-static.spec.ts' || LEGACY_COMPATIBILITY_SPECS.has(relativePath)) {
      continue;
    }
    const content = readFileSync(file, 'utf8');
    if (postsToLegacyGameplayCommandEndpoint(content)) {
      offenders.push(relativePath);
    }
  }

  expect(offenders).toEqual([]);
});

function postsToLegacyGameplayCommandEndpoint(content: string): boolean {
  const postCall = 'request.post';
  const routeTail = '/commands';
  let offset = 0;
  while (true) {
    const start = content.indexOf(postCall, offset);
    if (start < 0) {
      return false;
    }
    const snippet = content.slice(start, start + 240);
    if (snippet.includes('/games/') && snippet.includes(routeTail)) {
      return true;
    }
    offset = start + postCall.length;
  }
}

function tsFiles(directory: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      if (entry === 'playwright-report' || entry === 'test-results') {
        continue;
      }
      out.push(...tsFiles(path));
      continue;
    }
    if (entry.endsWith('.ts')) {
      out.push(path);
    }
  }
  return out;
}
