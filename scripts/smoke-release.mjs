/**
 * Smoke test of the release archives — what a person actually downloads.
 *
 * The unit tests check the code; the integration tests check two real endpoints.
 * This checks the *packages*: it extracts `release/*.zip` with the reader that ships
 * with the repository, then
 *
 *   - serves the web archive over HTTP from a sub-directory (the way a user who
 *     unzips it into a folder does) and verifies that the page, its stylesheet, its
 *     script, the manifest, the icons and the service worker are all reachable with
 *     the relative paths that are written in the HTML;
 *   - installs the signaling archive in a temporary directory with `npm install
 *     --omit=dev` and starts it exactly as its `RUN.md` says, then reads `/health`.
 *
 * It is run by the CI after `npm run package`, and by anyone with
 * `npm run smoke:release`. Failure means the published package is broken — which is
 * precisely the class of bug that no unit test would catch.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readZip } from './lib/unzip.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const releaseDir = join(root, 'release');

let failures = 0;
const check = (ok, label, detail = '') => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
  return ok;
};

/** Relative references written in the HTML: `./x`, `x`, but never a bare `/x`. */
function localReferences(html) {
  const references = new Set();
  for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const value = match[1];
    if (value.startsWith('http') || value.startsWith('data:') || value.startsWith('#')) continue;
    references.add(value);
  }
  return [...references];
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.map': 'application/json',
  '.ico': 'image/x-icon',
};

/** Serves `directory` at the root of the given port, the way a static host would. */
function serve(directory) {
  const server = createServer((request, response) => {
    const requested = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const target = normalize(join(directory, requested));
    if (!target.startsWith(directory)) {
      response.writeHead(403).end('forbidden');
      return;
    }
    const file = requested.endsWith('/') ? join(target, 'index.html') : target;
    try {
      const body = readFileSync(file);
      response.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
      response.end(body);
    } catch {
      response.writeHead(404).end('not found');
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

/** Waits for a condition, up to a deadline. Never sleeps longer than needed. */
async function waitFor(description, probe, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const value = await probe();
      if (value) return value;
    } catch {
      // not ready yet
    }
    if (Date.now() > deadline) throw new Error(`timeout: ${description}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/* ------------------------------------------------------------------ *
 * 1. The web archive
 * ------------------------------------------------------------------ */

async function checkWebArchive(archivePath, workdir) {
  console.log(`\n[smoke] ${archivePath.slice(root.length)}`);
  const files = readZip(readFileSync(archivePath));
  check(files.size > 5, 'archive non vide', `${files.size} fichiers`);

  const directory = join(workdir, 'web');
  mkdirSync(directory, { recursive: true });
  for (const [path, data] of files) {
    const target = join(directory, path);
    mkdirSync(join(target, '..'), { recursive: true });
    writeFileSync(target, data);
  }

  const html = files.get('index.html')?.toString('utf8') ?? '';
  const references = localReferences(html);
  check(references.length > 0, 'la page référence ses fichiers');
  check(
    references.every((value) => !value.startsWith('/')),
    'aucune référence absolue (l’archive fonctionne dans n’importe quel dossier)',
    references.filter((value) => value.startsWith('/')).join(', ') || 'aucune',
  );
  check(
    references.every((value) => files.has(value.replace(/^\.\//, ''))),
    'chaque fichier référencé est présent dans l’archive',
    references.filter((value) => !files.has(value.replace(/^\.\//, ''))).join(', ') || 'tous présents',
  );

  // A manifest that points outside the folder would break the installation.
  const manifest = JSON.parse(files.get('manifest.webmanifest')?.toString('utf8') ?? '{}');
  check(Boolean(manifest.name && manifest.icons?.length), 'manifeste lisible', manifest.name ?? 'sans nom');
  const manifestTargets = [manifest.start_url, manifest.scope, ...(manifest.icons ?? []).map((icon) => icon.src)]
    .filter((value) => typeof value === 'string')
    .map((value) => value.replace(/^\.\//, ''))
    .filter((value) => value !== '' && value !== '.');
  check(
    manifestTargets.every((value) => files.has(value)),
    'les cibles du manifeste existent',
    manifestTargets.filter((value) => !files.has(value)).join(', ') || 'toutes présentes',
  );

  // And then the real thing: served over HTTP, exactly as a static host would.
  const server = await serve(directory);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const index = await fetch(`${base}/`);
    check(index.status === 200, 'la page répond', `HTTP ${index.status}`);
    for (const reference of references) {
      const response = await fetch(`${base}/${reference}`);
      if (!check(response.ok, `fichier servi : ${reference}`, `HTTP ${response.status}`)) continue;
      const body = Buffer.from(await response.arrayBuffer());
      check(
        body.equals(files.get(reference.replace(/^\.\//, '')) ?? Buffer.alloc(0)),
        `octets identiques : ${reference}`,
        `${body.length} octets`,
      );
    }
    const sw = await fetch(`${base}/sw.js`);
    check(sw.ok, 'service worker servi', `HTTP ${sw.status}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

/* ------------------------------------------------------------------ *
 * 2. The signaling archive
 * ------------------------------------------------------------------ */

async function checkSignalingArchive(archivePath, workdir) {
  console.log(`\n[smoke] ${archivePath.slice(root.length)}`);
  const files = readZip(readFileSync(archivePath));
  check(files.has('dist/main.js'), 'le serveur compilé est présent');
  check(files.has('RUN.md'), 'les instructions d’exécution sont présentes');

  const directory = join(workdir, 'signaling');
  mkdirSync(directory, { recursive: true });
  for (const [path, data] of files) {
    const target = join(directory, path);
    mkdirSync(join(target, '..'), { recursive: true });
    writeFileSync(target, data);
  }

  // Exactly what RUN.md tells a user to do.
  await new Promise((resolve, reject) => {
    const install = spawn('npm', ['install', '--omit=dev', '--no-audit', '--no-fund'], {
      cwd: directory,
      stdio: 'ignore',
      shell: process.platform === 'win32',
    });
    install.on('error', reject);
    install.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`npm install failed (${code})`))));
  });
  check(true, 'les dépendances déclarées suffisent (npm install --omit=dev)');

  const child = spawn(process.execPath, ['dist/main.js'], {
    cwd: directory,
    env: { ...process.env, PORT: '0', HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => (output += chunk.toString()));
  child.stderr.on('data', (chunk) => (output += chunk.toString()));

  try {
    const health = await waitFor('le service annonce son port', async () => {
      const match = /listening on http:\/\/[^:]+:(\d+)/.exec(output);
      if (!match) return undefined;
      const response = await fetch(`http://127.0.0.1:${match[1]}/health`);
      return response.ok ? await response.json() : undefined;
    });
    check(health?.ok === true, 'le service démarre et répond sur /health', JSON.stringify(health));
    check(
      typeof health?.rooms === 'number' && typeof health?.limits?.maxPeers === 'number',
      'les limites annoncées sont lisibles',
      JSON.stringify(health?.limits),
    );
    check(!/zod|Cannot find package/.test(output), 'aucun module manquant au démarrage');
  } catch (error) {
    check(false, 'le service démarre', error instanceof Error ? error.message : String(error));
    if (output.trim()) console.log(output.trim().split('\n').slice(0, 8).join('\n'));
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => child.once('exit', resolve));
  }
}

/* ------------------------------------------------------------------ *
 * 3. The archives are the ones that were hashed
 * ------------------------------------------------------------------ */

function checkSums() {
  console.log('\n[smoke] release/SHA256SUMS');
  const text = readFileSync(join(releaseDir, 'SHA256SUMS'), 'utf8').trim().split('\n');
  for (const line of text) {
    const [expected, name] = line.trim().split(/\s+/);
    const actual = createHash('sha256').update(readFileSync(join(releaseDir, name))).digest('hex');
    check(actual === expected, `somme de contrôle : ${name}`, actual.slice(0, 16));
  }
}

/** Reads the version from the archives that are present, without assuming a number. */
function findArchive(prefix) {
  const candidates = readdirSync(releaseDir).filter((name) => name.startsWith(prefix) && name.endsWith('.zip'));
  if (candidates.length !== 1) {
    throw new Error(`expected exactly one ${prefix}*.zip in release/, found ${candidates.length} — run "npm run package" first`);
  }
  return join(releaseDir, candidates[0]);
}

/* ------------------------------------------------------------------ *
 * Run
 * ------------------------------------------------------------------ */

const workdir = mkdtempSync(join(tmpdir(), 'dropforge-smoke-'));
try {
  await checkWebArchive(findArchive('dropforge-pwa-'), workdir);
  await checkSignalingArchive(findArchive('dropforge-signaling-'), workdir);
  checkSums();
} catch (error) {
  check(false, 'le test a échoué', error instanceof Error ? error.message : String(error));
} finally {
  rmSync(workdir, { recursive: true, force: true });
}

console.log(failures === 0 ? '\n[smoke] archives conformes.' : `\n[smoke] ${failures} échec(s).`);
process.exit(failures === 0 ? 0 : 1);
