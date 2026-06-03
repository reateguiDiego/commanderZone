import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

const workspaceRoot = process.cwd();
const seoLandingRoot = join(workspaceRoot, 'src', 'app', 'features', 'seo-landings');
const errors = [];

for (const file of walkFiles(seoLandingRoot, ['.html'])) {
  const text = readFileSync(file, 'utf8');
  const normalizedPath = relative(workspaceRoot, file).replaceAll('\\', '/');

  for (const image of text.matchAll(/<img\b[\s\S]*?>/gi)) {
    const tag = image[0];

    if (!hasAttribute(tag, 'alt') && !hasBoundAttribute(tag, 'alt')) {
      errors.push(`${normalizedPath} contains an image without alt: ${compact(tag)}`);
    }

    if (!hasAttribute(tag, 'width') && !hasBoundAttribute(tag, 'width')) {
      errors.push(`${normalizedPath} contains an image without width: ${compact(tag)}`);
    }

    if (!hasAttribute(tag, 'height') && !hasBoundAttribute(tag, 'height')) {
      errors.push(`${normalizedPath} contains an image without height: ${compact(tag)}`);
    }

    if (/loading\s*=\s*["']lazy["']/i.test(tag) && !/\bdata-below-fold\b/i.test(tag)) {
      errors.push(`${normalizedPath} lazy-loads an image without marking it as below the fold: ${compact(tag)}`);
    }
  }
}

if (errors.length > 0) {
  console.error('SEO image validation failed:');
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log('SEO image validation passed.');

function hasAttribute(tag, attribute) {
  return new RegExp(`\\s${attribute}\\s*=`, 'i').test(tag);
}

function hasBoundAttribute(tag, attribute) {
  return new RegExp(`\\s(?:\\[attr\\.${attribute}\\]|\\[${attribute}\\])\\s*=`, 'i').test(tag);
}

function compact(value) {
  return value.replace(/\s+/g, ' ').trim();
}

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
