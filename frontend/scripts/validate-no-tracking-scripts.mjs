import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const workspaceRoot = process.cwd();
const scanRoots = [
  'src',
  'public',
  'dist/frontend/browser',
];
const forbiddenPatterns = [
  /googletagmanager\.com\/gtag\/js/i,
  /googletagmanager\.com\/gtm\.js/i,
  /google-analytics\.com\/analytics\.js/i,
  /google-analytics\.com\/g\/collect/i,
  /googleads\.g\.doubleclick\.net/i,
  /stats\.g\.doubleclick\.net/i,
  /connect\.facebook\.net/i,
  /facebook\.com\/tr/i,
  /static\.hotjar\.com/i,
  /clarity\.ms\/tag/i,
  /matomo\.js/i,
  /plausible\.io\/js/i,
];
const adsensePatterns = [
  /pagead2\.googlesyndication\.com/i,
  /googlesyndication\.com\/pagead/i,
];
const managedAdsenseSource = 'src/app/core/ads/adsense-loader.ts';
const managedAdsenseScriptId = 'cz-google-adsense-script';
const skippedExtensions = new Set([
  '.avif',
  '.gif',
  '.ico',
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.woff',
  '.woff2',
]);
const errors = [];

for (const root of scanRoots) {
  const absoluteRoot = join(workspaceRoot, root);
  if (!existsSync(absoluteRoot)) {
    continue;
  }

  scanPath(absoluteRoot);
}

if (errors.length > 0) {
  console.error('Tracking script validation failed:');
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log('Tracking script validation passed.');

function scanPath(path) {
  const stats = statSync(path);
  if (stats.isDirectory()) {
    for (const entry of readdirSync(path)) {
      scanPath(join(path, entry));
    }
    return;
  }

  if (!stats.isFile() || skippedExtensions.has(extension(path))) {
    return;
  }

  const content = readFileSync(path, 'utf8');
  const relativePath = normalizePath(relative(workspaceRoot, path));

  for (const pattern of adsensePatterns) {
    if (pattern.test(content) && !isManagedAdsenseOccurrence(relativePath, content)) {
      errors.push(`${relativePath} contains unmanaged AdSense pattern ${pattern}`);
    }
  }

  for (const pattern of forbiddenPatterns) {
    if (pattern.test(content)) {
      errors.push(`${relativePath} contains ${pattern}`);
    }
  }
}

function isManagedAdsenseOccurrence(relativePath, content) {
  if (relativePath === managedAdsenseSource) {
    return true;
  }

  return relativePath.startsWith('dist/frontend/browser/')
    && (relativePath.endsWith('.js') || relativePath.endsWith('.js.map'))
    && content.includes(managedAdsenseScriptId);
}

function normalizePath(path) {
  return path.replaceAll('\\', '/');
}

function extension(path) {
  const match = path.match(/\.[^.]+$/);
  return match?.[0].toLowerCase() ?? '';
}
