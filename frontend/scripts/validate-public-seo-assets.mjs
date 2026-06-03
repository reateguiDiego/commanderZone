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
  'public/assets/seo/README.md',
];

for (const file of requiredFiles) {
  await assertFileExists(file);
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

for (const fileName of await readdir(path.join(workspaceRoot, 'public', 'assets', 'seo'))) {
  if (!fileName.endsWith('.html')) {
    continue;
  }

  const verificationFile = await readPublicFile(`assets/seo/${fileName}`);
  if (/fake|placeholder|todo/i.test(verificationFile)) {
    throw new Error(`Search Console verification file must contain a real token: ${fileName}`);
  }
}

console.log('Public SEO asset validation passed.');

async function assertFileExists(relativePath) {
  await access(path.join(workspaceRoot, relativePath));
}

async function readPublicFile(relativePath) {
  return readFile(path.join(workspaceRoot, 'public', relativePath), 'utf8');
}
