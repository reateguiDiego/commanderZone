import { readFile } from 'node:fs/promises';
import path from 'node:path';

const workspaceRoot = process.cwd();
const robotsPath = path.join(workspaceRoot, 'public', 'robots.txt');
const seoRoutesPath = path.join(workspaceRoot, 'src', 'seo-prerender-routes.txt');
const robots = await readFile(robotsPath, 'utf8');
const seoRoutes = (await readFile(seoRoutesPath, 'utf8'))
  .split(/\r?\n/)
  .map((route) => route.trim())
  .filter(Boolean);

const directives = parseRobotsDirectives(robots);
const disallowRules = directives
  .filter((directive) => directive.name === 'disallow')
  .map((directive) => directive.value);

assertHasDirective(directives, 'user-agent', '*');
assertHasDirective(directives, 'allow', '/');
assertHasDirective(directives, 'sitemap', 'https://commanderzone.com/sitemap-index.xml');
assertNoGlobalDisallow(disallowRules);
assertSeoRoutesAreAllowed(seoRoutes, disallowRules);
assertInternalRoutesAreNotBlockedInRobots(disallowRules);

console.log('robots.txt validation passed.');

function parseRobotsDirectives(content) {
  return content
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+#.*$/, '').trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .map((line) => {
      const separatorIndex = line.indexOf(':');
      if (separatorIndex === -1) {
        throw new Error(`Invalid robots.txt directive: ${line}`);
      }

      return {
        name: line.slice(0, separatorIndex).trim().toLowerCase(),
        value: line.slice(separatorIndex + 1).trim(),
      };
    });
}

function assertHasDirective(directives, name, value) {
  if (!directives.some((directive) => directive.name === name && directive.value === value)) {
    throw new Error(`robots.txt must include "${name}: ${value}".`);
  }
}

function assertNoGlobalDisallow(disallowRules) {
  if (disallowRules.some((rule) => normalizePathRule(rule) === '/')) {
    throw new Error('robots.txt must not contain an accidental "Disallow: /".');
  }
}

function assertSeoRoutesAreAllowed(seoRoutes, disallowRules) {
  const blockingRule = disallowRules.find((rule) => {
    const normalizedRule = normalizePathRule(rule);
    return normalizedRule !== '' && seoRoutes.some((route) => route.startsWith(normalizedRule));
  });

  if (blockingRule) {
    throw new Error(`robots.txt must not block public SEO landings with "Disallow: ${blockingRule}".`);
  }
}

function assertInternalRoutesAreNotBlockedInRobots(disallowRules) {
  const internalRoutePrefixes = [
    '/app',
    '/auth',
    '/cards',
    '/dashboard',
    '/decks',
    '/games',
    '/profile',
    '/rooms',
    '/settings',
    '/table-assistant',
  ];
  const blockingRule = disallowRules.find((rule) => {
    const normalizedRule = normalizePathRule(rule);
    return normalizedRule !== ''
      && internalRoutePrefixes.some((prefix) => prefix.startsWith(normalizedRule) || normalizedRule.startsWith(prefix));
  });

  if (blockingRule) {
    throw new Error(
      `robots.txt must not hide internal/runtime pages with "Disallow: ${blockingRule}". Use route-level noindex instead.`,
    );
  }
}

function normalizePathRule(rule) {
  const trimmedRule = rule.trim();
  if (trimmedRule === '') {
    return '';
  }

  return trimmedRule.startsWith('/') ? trimmedRule : `/${trimmedRule}`;
}
