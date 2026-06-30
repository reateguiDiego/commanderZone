import { expect, test } from '@playwright/test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const E2E_ROOT = join(process.cwd(), 'e2e');

test('E2E runtime-primary helpers do not post gameplay commands through legacy HTTP', () => {
  const offenders: string[] = [];
  for (const file of tsFiles(E2E_ROOT)) {
    if (file.endsWith('game-runtime-routing-static.spec.ts')) {
      continue;
    }
    const content = readFileSync(file, 'utf8');
    if (postsToLegacyGameplayCommandEndpoint(content)) {
      offenders.push(relative(E2E_ROOT, file).replaceAll('\\', '/'));
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
