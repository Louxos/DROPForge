#!/usr/bin/env node
/**
 * Serves the assembled GitHub Pages site locally, **under its real base path**, so the
 * site can be opened and clicked through exactly as it will be published:
 *
 *   npm run preview:pages      →  http://localhost:4174/DROPForge/
 *
 * `/` redirects to the base path, because that is the address a preview gives you and
 * the site would otherwise answer 404 — the same 404 it must answer on GitHub Pages for
 * an address that does not exist.
 *
 * This is a preview, not a second way to publish: GitHub Pages stays the only host.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStaticServer } from './lib/static-server.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = join(root, '_site');
const metadata = join(root, '.pages-build.json');

if (!existsSync(join(out, 'index.html'))) {
  console.error('_site/ est absent : lancez « npm run build:pages » d’abord.');
  process.exit(2);
}

const base = process.env['DROPFORGE_PAGES_BASE'] ?? (existsSync(metadata) ? JSON.parse(readFileSync(metadata, 'utf8')).base : '/DROPForge/');
const port = Number(process.env['PORT'] ?? 4174);
const host = process.env['HOST'] ?? '0.0.0.0';

const site = await startStaticServer({ directory: out, basePath: base, notFoundFile: '404.html', redirectRootToBase: true, host, port });
console.log(`DropForge (site GitHub Pages) : ${site.origin}${base}`);
console.log(`  page d'accueil : ${site.origin}${base}`);
console.log(`  application    : ${site.origin}${base}app/`);
