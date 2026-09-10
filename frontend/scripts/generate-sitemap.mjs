import path from 'node:path';
import { writeSitemapFiles } from './seo-sitemap-generator.mjs';

const workspaceRoot = process.cwd();
const result = await writeSitemapFiles(workspaceRoot);

console.log(
  `Wrote ${result.urlCount} SEO sitemap URLs from ${result.routeCount} routes and ${result.localeCount} locales.`,
);
console.log(`Updated ${path.relative(workspaceRoot, result.sitemapIndexPath)}.`);
console.log(`Updated ${path.relative(workspaceRoot, result.seoSitemapPath)}.`);
