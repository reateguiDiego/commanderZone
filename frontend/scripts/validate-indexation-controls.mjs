import { readFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import {
  getSeoSitemapEntries,
  loadSeoSitemapConfig,
  toSeoPath,
} from './seo-sitemap-generator.mjs';

const workspaceRoot = process.cwd();
const authPages = [
  { routePath: 'auth/login', normalizedPath: '/auth/login/' },
  { routePath: 'auth/register', normalizedPath: '/auth/register/' },
];

const [
  strategiesSource,
  appRoutesSource,
  serverRoutesSource,
  legalRoutesSource,
  vercelConfigSource,
  robots,
  sitemap,
  seoPrerenderRoutes,
  combinedPrerenderRoutes,
  sitemapConfig,
] = await Promise.all([
  readWorkspaceFile('src/app/core/localization/page-translation-strategy.ts'),
  readWorkspaceFile('src/app/app.routes.ts'),
  readWorkspaceFile('src/app/app.routes.server.ts'),
  readWorkspaceFile('src/app/core/legal/legal-routes.ts'),
  readWorkspaceFile('vercel.json'),
  readWorkspaceFile('public/robots.txt'),
  readWorkspaceFile('public/sitemaps/sitemap-seo.xml'),
  readWorkspaceFile('src/seo-prerender-routes.txt'),
  readWorkspaceFile('src/prerender-routes.txt'),
  loadSeoSitemapConfig(workspaceRoot),
]);

const pageStrategies = extractPageStrategies(strategiesSource);
const appRoutes = extractAppRouteRecords(appRoutesSource);
const seoRouteKeys = sitemapConfig.routes.map((route) => route.routeKey);
const seoStaticPageKeys = pageKeysForStrategy(pageStrategies, 'seo-static');
const noindexPageKeys = pageKeysForStrategy(pageStrategies, 'runtime-i18n');
const sitemapLocs = extractTagValues(sitemap, 'loc');
const legalPrerenderRoutes = extractLegalPrerenderRoutes(legalRoutesSource, sitemapConfig.locales.map((locale) => locale.code));

assertSameSet(seoStaticPageKeys, seoRouteKeys, 'seo-static page keys must match SEO_ROUTES keys');
assertEverySeoStaticPageIsIndexable(seoStaticPageKeys, pageStrategies);
assertEveryNoindexPageIsNoindex(noindexPageKeys, pageStrategies);
assertEveryConfiguredRouteHasNoindexOrIndexableRule(appRoutes, pageStrategies);
assertSitemapContainsOnlySeoStaticPages(sitemapLocs, sitemapConfig);
assertNoNoindexRouteAppearsInSitemap(sitemapLocs, appRoutes, pageStrategies);
assertNoInvalidLocalizedSeoPathAppearsInSitemap(sitemapLocs, sitemapConfig);
assertRobotsDoesNotBlockNoindexPages(robots, appRoutes, pageStrategies);
assertSeoRoutesInSeoPrerenderManifest(seoPrerenderRoutes, sitemapConfig, sitemapLocs);
assertLegalRoutesInCombinedManifestOnly(combinedPrerenderRoutes, sitemapLocs, legalPrerenderRoutes);
assertAuthServerRoutesClient(serverRoutesSource);
assertAuthRoutesOutOfPrerenderAndSitemap(combinedPrerenderRoutes, seoPrerenderRoutes, sitemapLocs);
assertVercelNoindexHeaders(vercelConfigSource);

console.log('Indexation control validation passed.');

async function readWorkspaceFile(relativePath) {
  return readFile(path.join(workspaceRoot, relativePath), 'utf8');
}

function extractPageStrategies(sourceText) {
  const sourceFile = createSourceFile('page-translation-strategy.ts', sourceText);
  const declaration = findVariableDeclaration(sourceFile, 'PAGE_TRANSLATION_STRATEGIES');
  const objectLiteral = unwrapObjectExpression(declaration.initializer);
  const strategies = {};

  for (const property of objectLiteral.properties) {
    if (!ts.isPropertyAssignment(property) || !ts.isStringLiteralLike(property.initializer)) {
      continue;
    }

    strategies[propertyNameToString(property.name)] = property.initializer.text;
  }

  return strategies;
}

function extractAppRouteRecords(sourceText) {
  const sourceFile = createSourceFile('app.routes.ts', sourceText);
  const declaration = findVariableDeclaration(sourceFile, 'routes');
  const arrayLiteral = unwrapArrayExpression(declaration.initializer);
  return extractRouteRecordsFromArray(arrayLiteral, []);
}

function extractLegalPrerenderRoutes(sourceText, localeCodes) {
  const sourceFile = createSourceFile('legal-routes.ts', sourceText);
  const declaration = findVariableDeclaration(sourceFile, 'LEGAL_ROUTE_SLUGS');
  const objectLiteral = unwrapObjectExpression(declaration.initializer);
  const routes = [];

  for (const routeProperty of objectLiteral.properties) {
    if (!ts.isPropertyAssignment(routeProperty)) {
      continue;
    }

    const slugsObject = unwrapObjectExpression(routeProperty.initializer);

    for (const locale of localeCodes) {
      const slug = getStringProperty(slugsObject, locale);
      if (!slug) {
        throw new Error(`Legal route ${propertyNameToString(routeProperty.name)} is missing slug for ${locale}.`);
      }

      routes.push(locale === 'en' ? `/${slug}/` : `/${locale}/${slug}/`);
    }
  }

  return routes;
}

function extractRouteRecordsFromArray(arrayLiteral, parentSegments) {
  return arrayLiteral.elements.flatMap((element) => {
    if (ts.isSpreadElement(element)) {
      return [];
    }

    if (!ts.isObjectLiteralExpression(element)) {
      return [];
    }

    const pathValue = getStringProperty(element, 'path');
    const routeSegments = pathValue === undefined ? parentSegments : [...parentSegments, pathValue];
    const routePath = normalizeRoutePath(routeSegments);
    const children = getArrayProperty(element, 'children');
    const record = {
      path: routePath,
      pageKey: getRoutePageKey(element),
      redirectTo: getStringProperty(element, 'redirectTo'),
      source: element.getText(),
    };
    const childRecords = children ? extractRouteRecordsFromArray(children, routeSegments) : [];

    return record.pageKey ? [record, ...childRecords] : childRecords;
  });
}

function assertEverySeoStaticPageIsIndexable(pageKeys, strategies) {
  for (const pageKey of pageKeys) {
    assertRobotsMeta(pageKey, strategies[pageKey], 'index, follow');
  }
}

function assertEveryNoindexPageIsNoindex(pageKeys, strategies) {
  for (const pageKey of pageKeys) {
    const expectedRobots = pageKey === 'legal' ? 'noindex, follow' : 'noindex, nofollow';
    assertRobotsMeta(pageKey, strategies[pageKey], expectedRobots);
  }
}

function assertEveryConfiguredRouteHasNoindexOrIndexableRule(routes, strategies) {
  for (const route of routes) {
    if (!(route.pageKey in strategies)) {
      throw new Error(`Route ${route.path} uses unknown pageKey ${route.pageKey}.`);
    }

    const strategy = strategies[route.pageKey];
    if (!['seo-static', 'runtime-i18n', 'out-of-scope'].includes(strategy)) {
      throw new Error(`Route ${route.path} uses invalid strategy ${strategy}.`);
    }
  }
}

function assertSitemapContainsOnlySeoStaticPages(locs, config) {
  const expectedLocs = new Set(getSeoSitemapEntries(config).map((entry) => entry.loc));

  if (locs.length !== expectedLocs.size) {
    throw new Error(`SEO sitemap must contain exactly ${expectedLocs.size} indexable URLs, got ${locs.length}.`);
  }

  for (const loc of locs) {
    if (!expectedLocs.has(loc)) {
      throw new Error(`SEO sitemap contains non-indexable or unexpected URL: ${loc}.`);
    }
  }
}

function assertNoNoindexRouteAppearsInSitemap(locs, appRoutes, strategies) {
  const noindexStaticPaths = appRoutes
    .filter((route) => route.pageKey && strategies[route.pageKey] !== 'seo-static')
    .map((route) => route.path)
    .filter((routePath) =>
      routePath !== ''
      && routePath !== '**'
      && !routePath.includes(':')
    );

  for (const loc of locs) {
    const url = new URL(loc);
    const noindexPath = noindexStaticPaths.find((routePath) =>
      url.pathname === `/${routePath}`
      || url.pathname.startsWith(`/${routePath}/`)
    );

    if (noindexPath) {
      throw new Error(`Noindex route /${noindexPath} must not appear in sitemap URL ${loc}.`);
    }
  }
}

function assertNoInvalidLocalizedSeoPathAppearsInSitemap(locs, config) {
  const locSet = new Set(locs.map((loc) => new URL(loc).pathname));
  const invalidLocalizedPaths = [];

  for (const route of config.routes) {
    for (const locale of config.locales) {
      for (const otherLocale of config.locales) {
        if (locale.code === otherLocale.code) {
          continue;
        }

        const otherSlug = route.slugs[otherLocale.code];
        const expectedPath = toSeoPath(locale.code, route.slugs[locale.code], route.routeKey);
        const mixedPath = toSeoPath(locale.code, otherSlug, route.routeKey);

        if (mixedPath !== expectedPath) {
          invalidLocalizedPaths.push(mixedPath);
        }
      }
    }
  }

  const invalidPath = invalidLocalizedPaths.find((mixedPath) => locSet.has(mixedPath));
  if (invalidPath) {
    throw new Error(`Sitemap contains invalid localized SEO path: ${invalidPath}.`);
  }
}

function assertRobotsDoesNotBlockNoindexPages(robotsContent, appRoutes, strategies) {
  const disallowRules = parseRobotsDirectives(robotsContent)
    .filter((directive) => directive.name === 'disallow')
    .map((directive) => normalizeRobotsRule(directive.value))
    .filter(Boolean);
  const noindexPaths = appRoutes
    .filter((route) => route.pageKey && strategies[route.pageKey] !== 'seo-static')
    .map((route) => route.path)
    .filter((routePath) => routePath !== '' && routePath !== '**');

  for (const rule of disallowRules) {
    const blockedPath = noindexPaths.find((routePath) =>
      `/${routePath}`.startsWith(rule) || rule.startsWith(`/${routePath}`)
    );

    if (blockedPath) {
      throw new Error(`robots.txt must not block noindex route /${blockedPath} with Disallow: ${rule}.`);
    }
  }
}

function assertSeoRoutesInSeoPrerenderManifest(seoRoutesText, config, locs) {
  const expectedSeoPaths = getSeoSitemapEntries(config).map((entry) => new URL(entry.loc).pathname);
  const seoPrerenderRoutes = seoRoutesText.split(/\r?\n/).filter(Boolean);
  const sitemapPathSet = new Set(locs.map((loc) => new URL(loc).pathname));

  assertSameSet(seoPrerenderRoutes, expectedSeoPaths, 'SEO prerender manifest must contain exactly the indexable SEO routes');

  for (const routePath of expectedSeoPaths) {
    if (!sitemapPathSet.has(routePath)) {
      throw new Error(`SEO route ${routePath} must appear in the SEO sitemap.`);
    }
  }
}

function assertLegalRoutesInCombinedManifestOnly(combinedRoutesText, locs, legalRoutes) {
  const combinedPrerenderRoutes = combinedRoutesText.split(/\r?\n/).filter(Boolean);
  const sitemapPathSet = new Set(locs.map((loc) => new URL(loc).pathname));

  for (const legalRoute of legalRoutes) {
    if (!combinedPrerenderRoutes.includes(legalRoute)) {
      throw new Error(`Legal route must appear in the combined prerender manifest: ${legalRoute}`);
    }

    if (sitemapPathSet.has(legalRoute)) {
      throw new Error(`Legal route must not appear in the SEO sitemap: ${legalRoute}`);
    }
  }
}

function assertVercelNoindexHeaders(configSource) {
  const config = JSON.parse(configSource);
  const requiredSources = [
    '/auth/:path*',
    '/email-verification/',
    '/dashboard/:path*',
    '/cards/:path*',
    '/decks/:path*',
    '/rooms/:path*',
    '/room/:path*',
    '/games/:path*',
    '/table-assistant/:path*',
    '/welcome/',
  ];

  for (const source of requiredSources) {
    const entry = config.headers?.find((candidate) => candidate.source === source);
    const xRobots = entry?.headers?.find((header) => header.key === 'X-Robots-Tag');

    if (xRobots?.value !== 'noindex, nofollow') {
      throw new Error(`vercel.json must set X-Robots-Tag noindex, nofollow for ${source}.`);
    }
  }
}

function assertAuthServerRoutesClient(sourceText) {
  for (const authPage of authPages) {
    if (!sourceText.includes(`{ path: '${authPage.routePath}', renderMode: RenderMode.Client }`)) {
      throw new Error(`/${authPage.routePath}/ must use RenderMode.Client because auth pages are not SEO prerender routes.`);
    }
  }
}

function assertAuthRoutesOutOfPrerenderAndSitemap(combinedRoutesText, seoRoutesText, sitemapLocs) {
  const combinedPrerenderRoutes = combinedRoutesText.split(/\r?\n/).filter(Boolean);
  const seoPrerenderRoutes = seoRoutesText.split(/\r?\n/).filter(Boolean);

  for (const authPage of authPages) {
    if (combinedPrerenderRoutes.includes(authPage.normalizedPath)) {
      throw new Error(`Auth route must not appear in the combined prerender manifest: ${authPage.normalizedPath}`);
    }

    if (seoPrerenderRoutes.includes(authPage.normalizedPath)) {
      throw new Error(`Auth route must not appear in the SEO prerender manifest: ${authPage.normalizedPath}`);
    }

    if (sitemapLocs.includes(`https://www.commanderzone.com${authPage.normalizedPath}`)) {
      throw new Error(`Auth route must not appear in the SEO sitemap: ${authPage.normalizedPath}`);
    }
  }
}

function assertRobotsMeta(pageKey, strategy, expectedRobots) {
  const actualRobots = robotsForPageKey(pageKey, strategy);
  if (actualRobots !== expectedRobots) {
    throw new Error(`Page ${pageKey} must use ${expectedRobots}, got ${actualRobots}.`);
  }
}

function robotsForPageKey(pageKey, strategy) {
  if (pageKey === 'legal') {
    return 'noindex, follow';
  }

  return robotsForStrategy(strategy);
}

function robotsForStrategy(strategy) {
  if (strategy === 'seo-static') {
    return 'index, follow';
  }

  if (strategy === 'runtime-i18n') {
    return 'noindex, nofollow';
  }

  if (strategy === 'out-of-scope') {
    return 'noindex, nofollow';
  }

  throw new Error(`Unknown page strategy: ${strategy}.`);
}

function pageKeysForStrategy(strategies, strategy) {
  return Object.entries(strategies)
    .filter(([, pageStrategy]) => pageStrategy === strategy)
    .map(([pageKey]) => pageKey);
}

function assertSameSet(actual, expected, message) {
  const actualSorted = [...actual].sort();
  const expectedSorted = [...expected].sort();

  if (actualSorted.join('|') !== expectedSorted.join('|')) {
    throw new Error(`${message}. Expected ${expectedSorted.join(', ')}, got ${actualSorted.join(', ')}.`);
  }
}

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

function normalizeRobotsRule(rule) {
  const trimmedRule = rule.trim();
  if (trimmedRule === '') {
    return '';
  }

  return trimmedRule.startsWith('/') ? trimmedRule : `/${trimmedRule}`;
}

function createSourceFile(fileName, sourceText) {
  return ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true);
}

function findVariableDeclaration(sourceFile, variableName) {
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) {
      continue;
    }

    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === variableName) {
        return declaration;
      }
    }
  }

  throw new Error(`Could not find ${variableName}.`);
}

function unwrapArrayExpression(expression) {
  if (ts.isAsExpression(expression) || ts.isSatisfiesExpression(expression)) {
    return unwrapArrayExpression(expression.expression);
  }

  if (ts.isArrayLiteralExpression(expression)) {
    return expression;
  }

  throw new Error('Expected an array literal.');
}

function unwrapObjectExpression(expression) {
  if (ts.isAsExpression(expression) || ts.isSatisfiesExpression(expression)) {
    return unwrapObjectExpression(expression.expression);
  }

  if (ts.isObjectLiteralExpression(expression)) {
    return expression;
  }

  throw new Error('Expected an object literal.');
}

function getStringProperty(objectLiteral, propertyName) {
  const property = objectLiteral.properties.find((candidate) =>
    ts.isPropertyAssignment(candidate) && propertyNameToString(candidate.name) === propertyName
  );

  if (!property || !ts.isPropertyAssignment(property) || !ts.isStringLiteralLike(property.initializer)) {
    return undefined;
  }

  return property.initializer.text;
}

function getArrayProperty(objectLiteral, propertyName) {
  const property = objectLiteral.properties.find((candidate) =>
    ts.isPropertyAssignment(candidate) && propertyNameToString(candidate.name) === propertyName
  );

  if (!property || !ts.isPropertyAssignment(property) || !ts.isArrayLiteralExpression(property.initializer)) {
    return undefined;
  }

  return property.initializer;
}

function getRoutePageKey(objectLiteral) {
  const dataProperty = objectLiteral.properties.find((candidate) =>
    ts.isPropertyAssignment(candidate) && propertyNameToString(candidate.name) === 'data'
  );

  if (!dataProperty || !ts.isPropertyAssignment(dataProperty) || !ts.isObjectLiteralExpression(dataProperty.initializer)) {
    return undefined;
  }

  return getStringProperty(dataProperty.initializer, 'pageKey');
}

function propertyNameToString(name) {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }

  throw new Error(`Unsupported property name: ${name.getText()}.`);
}

function normalizeRoutePath(segments) {
  return segments
    .filter((segment) => segment !== '')
    .join('/')
    .replace(/\/+/g, '/');
}

function extractTagValues(xml, tagName) {
  return [...xml.matchAll(new RegExp(`<${tagName}>(.*?)</${tagName}>`, 'g'))].map((match) => match[1]);
}
