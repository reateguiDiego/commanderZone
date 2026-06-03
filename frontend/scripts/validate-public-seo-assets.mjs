import { access, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const workspaceRoot = process.cwd();
const requiredFiles = [
  'public/robots.txt',
  'public/sitemap-index.xml',
  'public/favicon.ico',
  'public/favicon.svg',
  'public/apple-touch-icon.png',
  'public/manifest.webmanifest',
  'public/assets/og/default-og.png',
  'public/assets/og/home-og.png',
  'public/assets/og/play-commander-og.png',
  'public/assets/og/table-assistant-og.png',
  'public/assets/og/faq-og.png',
  'public/assets/og/ways-to-play-og.png',
  'public/assets/seo/README.md',
];

for (const file of requiredFiles) {
  await assertFileExists(file);
}

for (const file of requiredFiles.filter((requiredFile) => requiredFile.startsWith('public/assets/og/'))) {
  await assertPngDimensions(file, 1200, 630);
  await assertMaxFileSize(file, 150_000);
}

const robots = await readPublicFile('robots.txt');
if (!robots.includes('Sitemap: https://commanderzone.com/sitemap-index.xml')) {
  throw new Error('robots.txt must reference the absolute production sitemap index URL.');
}

const sitemapIndex = await readPublicFile('sitemap-index.xml');
if (!sitemapIndex.includes('<loc>https://commanderzone.com/sitemaps/sitemap-seo.xml</loc>')) {
  throw new Error('sitemap-index.xml must reference the production SEO sitemap URL.');
}

const manifest = JSON.parse(await readPublicFile('manifest.webmanifest'));
if (manifest.name !== 'CommanderZone' || manifest.icons?.length < 2) {
  throw new Error('manifest.webmanifest must define CommanderZone icons.');
}

await assertSearchConsoleVerificationFiles('public', await readdir(path.join(workspaceRoot, 'public')));
await assertSearchConsoleVerificationFiles(
  'public/assets/seo',
  await readdir(path.join(workspaceRoot, 'public', 'assets', 'seo')),
);

console.log('Public SEO asset validation passed.');

async function assertFileExists(relativePath) {
  await access(path.join(workspaceRoot, relativePath));
}

async function readPublicFile(relativePath) {
  return readFile(path.join(workspaceRoot, 'public', relativePath), 'utf8');
}

async function assertPngDimensions(relativePath, expectedWidth, expectedHeight) {
  const bytes = await readFile(path.join(workspaceRoot, relativePath));
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);

  if (width !== expectedWidth || height !== expectedHeight) {
    throw new Error(`${relativePath} must be ${expectedWidth}x${expectedHeight}, got ${width}x${height}.`);
  }
}

async function assertMaxFileSize(relativePath, maxBytes) {
  const bytes = await readFile(path.join(workspaceRoot, relativePath));

  if (bytes.length > maxBytes) {
    throw new Error(`${relativePath} must be optimized below ${maxBytes} bytes, got ${bytes.length}.`);
  }
}

async function assertSearchConsoleVerificationFiles(publicDirectory, fileNames) {
  for (const fileName of fileNames) {
    if (!isSearchConsoleVerificationFile(fileName)) {
      continue;
    }

    const publicRelativePath = path.posix.join(publicDirectory.replace(/^public\/?/, ''), fileName);
    const verificationFile = await readPublicFile(publicRelativePath);
    if (/fake|placeholder|todo|replace|google-site-verification:\s*$/i.test(verificationFile)) {
      throw new Error(`Search Console verification file must contain a real token: ${path.posix.join(publicDirectory, fileName)}`);
    }
  }
}

function isSearchConsoleVerificationFile(fileName) {
  return /^google[a-z0-9_-]+\.html$/i.test(fileName);
}
