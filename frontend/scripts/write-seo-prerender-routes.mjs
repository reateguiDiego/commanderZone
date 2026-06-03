import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';

const workspaceRoot = process.cwd();
const localeConfigPath = path.join(workspaceRoot, 'src/app/core/localization/locale-config.ts');
const seoRoutesPath = path.join(workspaceRoot, 'src/app/core/localization/seo-routes.ts');
const outputPath = path.join(workspaceRoot, 'src/seo-prerender-routes.txt');

const localeCodes = extractSupportedLocaleCodes(await readSourceFile(localeConfigPath));
const seoRoutes = extractSeoRoutes(await readSourceFile(seoRoutesPath));
const routes = Object.values(seoRoutes).flatMap((route) =>
  localeCodes.map((locale) => toSeoPath(locale, route.slugs[locale])),
);

validateRoutes(routes, localeCodes.length, Object.keys(seoRoutes).length);

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${routes.join('\n')}\n`, 'utf8');

console.log(`Wrote ${routes.length} SEO prerender routes to ${path.relative(workspaceRoot, outputPath)}.`);

async function readSourceFile(filePath) {
  const sourceText = await readFile(filePath, 'utf8');
  return ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true);
}

function extractSupportedLocaleCodes(sourceFile) {
  const declaration = findVariableDeclaration(sourceFile, 'SUPPORTED_LOCALES');
  const arrayLiteral = unwrapAsConstArray(declaration.initializer);

  return arrayLiteral.elements.map((element) => {
    if (!ts.isObjectLiteralExpression(element)) {
      throw new Error('SUPPORTED_LOCALES must contain object literals.');
    }

    const code = getStringProperty(element, 'code');
    if (!code) {
      throw new Error('Every supported locale must define a code.');
    }

    return code;
  });
}

function extractSeoRoutes(sourceFile) {
  const declaration = findVariableDeclaration(sourceFile, 'SEO_ROUTES');
  const objectLiteral = unwrapSatisfiesObject(declaration.initializer);
  const routes = {};

  for (const routeProperty of objectLiteral.properties) {
    if (!ts.isPropertyAssignment(routeProperty)) {
      continue;
    }

    const routeKey = propertyNameToString(routeProperty.name);
    const routeConfig = unwrapSatisfiesObject(routeProperty.initializer);
    const slugsProperty = routeConfig.properties.find((property) =>
      ts.isPropertyAssignment(property) && propertyNameToString(property.name) === 'slugs'
    );

    if (!slugsProperty || !ts.isPropertyAssignment(slugsProperty)) {
      throw new Error(`SEO route ${routeKey} must define slugs.`);
    }

    const slugsObject = unwrapSatisfiesObject(slugsProperty.initializer);
    routes[routeKey] = { slugs: extractSlugRecord(slugsObject, routeKey) };
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

function toSeoPath(locale, slug) {
  return slug ? `/${locale}/${slug}/` : `/${locale}/`;
}

function validateRoutes(routes, localeCount, routeCount) {
  const expectedCount = localeCount * routeCount;
  const forbiddenRoutes = ['/games/', '/profile/', '/settings/', '/app/', '/table-assistant/'];

  if (routes.length !== expectedCount) {
    throw new Error(`Expected ${expectedCount} prerender routes, got ${routes.length}.`);
  }

  if (new Set(routes).size !== routes.length) {
    throw new Error('SEO prerender routes must be unique.');
  }

  for (const route of routes) {
    if (!route.startsWith('/') || !route.endsWith('/')) {
      throw new Error(`SEO prerender route must be normalized: ${route}`);
    }

    if (forbiddenRoutes.some((forbiddenRoute) => route.includes(forbiddenRoute))) {
      throw new Error(`Internal route must not be prerendered as SEO: ${route}`);
    }
  }
}
