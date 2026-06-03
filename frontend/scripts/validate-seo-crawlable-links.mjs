import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

const workspaceRoot = process.cwd();
const seoLandingRoot = join(workspaceRoot, 'src', 'app', 'features', 'seo-landings');
const errors = [];

for (const file of walkFiles(seoLandingRoot, ['.html'])) {
  const text = readFileSync(file, 'utf8');
  const normalizedPath = relative(workspaceRoot, file).replaceAll('\\', '/');

  if (/\brouterLink\b/.test(text)) {
    errors.push(`${normalizedPath} must not use routerLink for SEO discovery links.`);
  }

  if (/<button\b/i.test(text)) {
    errors.push(`${normalizedPath} must not use buttons for SEO landing navigation or CTA links.`);
  }

  for (const anchor of text.matchAll(/<a\b[^>]*>/gi)) {
    if (!/\s(?:\[href\]|href|attr\.href)=/i.test(anchor[0])) {
      errors.push(`${normalizedPath} contains an anchor without href: ${anchor[0]}`);
    }
  }
}

if (errors.length > 0) {
  console.error('SEO crawlable link validation failed:');
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log('SEO crawlable link validation passed.');

function walkFiles(dir, extensions, out = []) {
  if (!existsSync(dir)) {
    return out;
  }

  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      walkFiles(fullPath, extensions, out);
      continue;
    }

    if (extensions.includes(extname(fullPath))) {
      out.push(fullPath);
    }
  }

  return out;
}
