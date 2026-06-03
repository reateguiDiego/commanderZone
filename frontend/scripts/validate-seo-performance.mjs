import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

const workspaceRoot = process.cwd();
const appRoot = join(workspaceRoot, 'src', 'app');
const seoLandingRoot = join(appRoot, 'features', 'seo-landings');
const seoRoutesPath = join(seoLandingRoot, 'seo-landing.routes.ts');
const errors = [];

assertSeoRoutesAreLazyLoaded();
assertSeoLandingSourcesStayLight();

if (errors.length > 0) {
  console.error('SEO performance validation failed:');
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log('SEO performance validation passed.');

function assertSeoRoutesAreLazyLoaded() {
  const routes = readFileSync(seoRoutesPath, 'utf8');

  if (!routes.includes('loadComponent')) {
    errors.push('SEO landing routes must stay lazy-loaded with loadComponent.');
  }

  if (/import\s*\{\s*SeoLandingRouteComponent\s*\}/.test(routes)) {
    errors.push('SEO landing route component must not be eagerly imported by seo-landing.routes.ts.');
  }
}

function assertSeoLandingSourcesStayLight() {
  const files = walkFiles(seoLandingRoot, ['.ts', '.html'])
    .filter((file) => !file.endsWith('.spec.ts'));

  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const normalizedPath = relative(workspaceRoot, file).replaceAll('\\', '/');

    const forbiddenFragments = [
      '@ngx-translate/core',
      'RuntimeTranslatePipe',
      'runtimeTranslate',
      'HttpClient',
      'gsap',
      'lucide-angular',
      'setTimeout',
      'setInterval',
      'requestAnimationFrame',
      'IntersectionObserver',
      'window.',
      'localStorage',
      'sessionStorage',
    ];

    for (const fragment of forbiddenFragments) {
      if (text.includes(fragment)) {
        errors.push(`${normalizedPath} uses performance-sensitive or runtime-only API: ${fragment}.`);
      }
    }

    if (/<script\b(?![^>]*type=["']application\/ld\+json["'])/i.test(text)) {
      errors.push(`${normalizedPath} must not include executable scripts in SEO landing templates.`);
    }
  }
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
