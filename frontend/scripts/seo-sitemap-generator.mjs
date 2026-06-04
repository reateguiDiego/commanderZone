import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';

export const SITEMAP_BASE_URL = 'https://www.commanderzone.com';
export const SITEMAP_INDEX_PUBLIC_PATH = 'sitemap-index.xml';
export const SEO_SITEMAP_PUBLIC_PATH = 'sitemaps/sitemap-seo.xml';

export async function loadSeoSitemapConfig(workspaceRoot = process.cwd()) {
  const localeConfigPath = path.join(workspaceRoot, 'src/app/core/localization/locale-config.ts');
  const seoRoutesPath = path.join(workspaceRoot, 'src/app/core/localization/seo-routes.ts');

  return {
    locales: extractSupportedLocales(await readSourceFile(localeConfigPath)),
    routes: extractSeoRoutes(await readSourceFile(seoRoutesPath)),
  };
}

export function generateSitemapIndexXml() {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    '  <sitemap>',
    `    <loc>${toAbsoluteUrl(`/${SEO_SITEMAP_PUBLIC_PATH}`)}</loc>`,
    '  </sitemap>',
    '</sitemapindex>',
    '',
  ].join('\n');
}

export function generateSeoSitemapXml(config) {
  const entries = getSeoSitemapEntries(config);
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
  ];

  for (const entry of entries) {
    lines.push('  <url>');
    lines.push(`    <loc>${escapeXml(entry.loc)}</loc>`);

    for (const alternate of entry.alternates) {
      lines.push(`    <xhtml:link rel="alternate" hreflang="${escapeXml(alternate.hreflang)}" href="${escapeXml(alternate.href)}"/>`);
    }

    lines.push(`    <xhtml:link rel="alternate" hreflang="x-default" href="${escapeXml(entry.xDefault)}"/>`);
    lines.push('  </url>');
  }

  lines.push('</urlset>', '');
  return lines.join('\n');
}

export async function writeSitemapFiles(workspaceRoot = process.cwd()) {
  const config = await loadSeoSitemapConfig(workspaceRoot);
  const sitemapIndexPath = path.join(workspaceRoot, 'public', SITEMAP_INDEX_PUBLIC_PATH);
  const seoSitemapPath = path.join(workspaceRoot, 'public', SEO_SITEMAP_PUBLIC_PATH);
  const sitemapIndexXml = generateSitemapIndexXml();
  const seoSitemapXml = generateSeoSitemapXml(config);

  await mkdir(path.dirname(seoSitemapPath), { recursive: true });
  await writeFile(sitemapIndexPath, sitemapIndexXml, 'utf8');
  await writeFile(seoSitemapPath, seoSitemapXml, 'utf8');

  return {
    routeCount: config.routes.length,
    localeCount: config.locales.length,
    urlCount: config.routes.length * config.locales.length,
    sitemapIndexPath,
    seoSitemapPath,
  };
}

export function getSeoSitemapEntries(config) {
  assertValidConfig(config);

  return config.routes.flatMap((route) => {
    const alternates = config.locales.map((locale) => ({
      hreflang: locale.hreflang,
      href: toAbsoluteUrl(toSeoPath(locale.code, route.slugs[locale.code])),
    }));
    const xDefaultLocale = config.locales.find((locale) => locale.code === 'en');

    if (!xDefaultLocale) {
      throw new Error('SEO sitemap requires en locale as x-default.');
    }

    return config.locales.map((locale) => ({
      routeKey: route.routeKey,
      locale: locale.code,
      loc: toAbsoluteUrl(toSeoPath(locale.code, route.slugs[locale.code])),
      alternates,
      xDefault: toAbsoluteUrl(toSeoPath(xDefaultLocale.code, route.slugs[xDefaultLocale.code])),
    }));
  });
}

export function toSeoPath(locale, slug) {
  return slug ? `/${locale}/${slug}/` : `/${locale}/`;
}

export function toAbsoluteUrl(publicPath) {
  const normalizedPath = publicPath.startsWith('/') ? publicPath : `/${publicPath}`;
  return `${SITEMAP_BASE_URL}${normalizedPath}`;
}

async function readSourceFile(filePath) {
  const sourceText = await readFile(filePath, 'utf8');
  return ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true);
}

function extractSupportedLocales(sourceFile) {
  const supportedLocalesDeclaration = findVariableDeclaration(sourceFile, 'SUPPORTED_LOCALES');
  const seoLocaleCodesDeclaration = findVariableDeclaration(sourceFile, 'SEO_LOCALE_CODES');
  const supportedLocalesArray = unwrapAsConstArray(supportedLocalesDeclaration.initializer);
  const seoLocaleCodes = unwrapAsConstArray(seoLocaleCodesDeclaration.initializer).elements.map((element) => {
    if (!ts.isStringLiteralLike(element)) {
      throw new Error('SEO_LOCALE_CODES must contain string literals.');
    }

    return element.text;
  });
  const supportedLocales = new Map();

  for (const element of supportedLocalesArray.elements) {
    if (!ts.isObjectLiteralExpression(element)) {
      throw new Error('SUPPORTED_LOCALES must contain object literals.');
    }

    const code = getStringProperty(element, 'code');
    const hreflang = getStringProperty(element, 'hreflang');

    if (!code || !hreflang) {
      throw new Error('Every supported locale must define code and hreflang.');
    }

    supportedLocales.set(code, { code, hreflang });
  }

  return seoLocaleCodes.map((code) => {
    const locale = supportedLocales.get(code);

    if (!locale) {
      throw new Error(`SEO locale ${code} is not defined in SUPPORTED_LOCALES.`);
    }

    return locale;
  });
}

function extractSeoRoutes(sourceFile) {
  const declaration = findVariableDeclaration(sourceFile, 'SEO_ROUTES');
  const objectLiteral = unwrapSatisfiesObject(declaration.initializer);
  const routes = [];

  for (const routeProperty of objectLiteral.properties) {
    if (!ts.isPropertyAssignment(routeProperty)) {
      continue;
    }

    const routeKey = propertyNameToString(routeProperty.name);
    const routeConfig = unwrapSatisfiesObject(routeProperty.initializer);
    const explicitRouteKey = getStringProperty(routeConfig, 'routeKey');
    const slugsProperty = routeConfig.properties.find((property) =>
      ts.isPropertyAssignment(property) && propertyNameToString(property.name) === 'slugs'
    );

    if (explicitRouteKey !== routeKey) {
      throw new Error(`SEO route ${routeKey} must keep routeKey in sync.`);
    }

    if (!slugsProperty || !ts.isPropertyAssignment(slugsProperty)) {
      throw new Error(`SEO route ${routeKey} must define slugs.`);
    }

    const slugsObject = unwrapSatisfiesObject(slugsProperty.initializer);
    routes.push({ routeKey, slugs: extractSlugRecord(slugsObject, routeKey) });
  }

  return routes;
}

function extractSlugRecord(objectLiteral, routeKey) {
  const slugs = {};

  for (const property of objectLiteral.properties) {
    if (!ts.isPropertyAssignment(property)) {
      continue;
    }

    const locale = propertyNameToString(property.name);
    if (!ts.isStringLiteralLike(property.initializer)) {
      throw new Error(`SEO route ${routeKey} slug for ${locale} must be a string literal.`);
    }

    slugs[locale] = property.initializer.text;
  }

  return slugs;
}

function assertValidConfig(config) {
  const localeCodes = config.locales.map((locale) => locale.code);
  const expectedUrlCount = config.locales.length * config.routes.length;
  const urlPaths = [];

  for (const route of config.routes) {
    for (const locale of localeCodes) {
      if (route.slugs[locale] === undefined) {
        throw new Error(`SEO route ${route.routeKey} must define a slug for SEO locale ${locale}.`);
      }

      const path = toSeoPath(locale, route.slugs[locale]);
      urlPaths.push(path);

      if (!path.startsWith(`/${locale}/`)) {
        throw new Error(`SEO route ${route.routeKey} mixes locale and slug in ${path}.`);
      }
    }
  }

  if (urlPaths.length !== expectedUrlCount) {
    throw new Error(`Expected ${expectedUrlCount} sitemap URLs, got ${urlPaths.length}.`);
  }

  if (new Set(urlPaths).size !== urlPaths.length) {
    throw new Error('SEO sitemap URLs must be unique.');
  }
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

function unwrapAsConstArray(expression) {
  if (ts.isSatisfiesExpression(expression)) {
    return unwrapAsConstArray(expression.expression);
  }

  if (ts.isAsExpression(expression) && ts.isArrayLiteralExpression(expression.expression)) {
    return expression.expression;
  }

  if (ts.isArrayLiteralExpression(expression)) {
    return expression;
  }

  throw new Error('Expected an array literal.');
}

function unwrapSatisfiesObject(expression) {
  if (ts.isSatisfiesExpression(expression)) {
    return unwrapSatisfiesObject(expression.expression);
  }

  if (ts.isAsExpression(expression)) {
    return unwrapSatisfiesObject(expression.expression);
  }

  if (ts.isParenthesizedExpression(expression)) {
    return unwrapSatisfiesObject(expression.expression);
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

function propertyNameToString(name) {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) {
    return name.text;
  }

  throw new Error('Only identifier and string literal property names are supported.');
}

function escapeXml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}
