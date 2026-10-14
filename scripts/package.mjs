/**
 * Builds the downloadable artifacts.
 *
 * Run with `npm run package`. What it produces in `release/`:
 *
 *  - `dropforge-pwa-<version>.zip` — the whole web application, ready to be served
 *    by any static host and installed as an application;
 *  - `dropforge-signaling-<version>.zip` — the compiled signaling/relay service, to
 *    run with plain Node (self-hosting the optional server);
 *  - `SHA256SUMS` — the checksums of both archives, in the format every verification
 *    tool understands.
 *
 * The Windows installer is deliberately **not** produced here: it needs a Windows
 * machine with the Rust toolchain. `.github/workflows/release.yml` builds it, signed,
 * from a tag — see `docs/DOWNLOAD.md`.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createZip } from './lib/zip.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const releaseDir = join(root, 'release');
const version = process.env['DROPFORGE_VERSION'] ?? JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const say = (message) => console.log(`[package] ${message}`);

function run(args, env = {}) {
  // Un `.cmd` ne se lance pas directement sous Windows (Node refuse : « spawn EINVAL ») :
  // le shell est requis là, et seulement là.
  execFileSync(npm, args, { cwd: root, stdio: 'inherit', env: { ...process.env, ...env }, shell: process.platform === 'win32' });
}

/** Every file under `directory`, with its path relative to it. */
function walk(directory, prefix = '') {
  const out = [];
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const absolute = join(directory, entry.name);
    const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) out.push(...walk(absolute, path));
    else if (entry.isFile()) out.push({ path, absolute, size: statSync(absolute).size });
    else throw new Error(`unexpected file type in a release input: ${path}`);
  }
  return out;
}

function zipDirectory(directory, output, extra = []) {
  const files = walk(directory).map((file) => ({ path: file.path, data: readFileSync(file.absolute) }));
  const archive = createZip([...files, ...extra]);
  writeFileSync(output, archive);
  const details = files.reduce((sum, file) => sum + file.data.length, 0);
  say(`${relative(root, output)} — ${files.length + extra.length} fichiers, ${(archive.length / 1024).toFixed(0)} Kio (${(details / 1024).toFixed(0)} Kio avant compression)`);
  return archive;
}

const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

/* ------------------------------------------------------------------ *
 * 1. Compile everything that can be compiled here
 * ------------------------------------------------------------------ */

if (!process.argv.includes('--no-build')) {
  say(`compilation des trois cibles (version ${version})`);
  run(['run', 'build:signaling']);
  // The archive is served from an arbitrary folder, so its references must be
  // relative unless the caller asks for a hosted base (Pages, domain root).
  run(['run', 'build:web'], { DROPFORGE_VERSION: version, DROPFORGE_BASE: process.env['DROPFORGE_BASE'] ?? './' });
  run(['run', 'build', '-w', '@dropforge/desktop']);
}

/* ------------------------------------------------------------------ *
 * 2. Assemble the archives
 * ------------------------------------------------------------------ */

rmSync(releaseDir, { recursive: true, force: true });
mkdirSync(releaseDir, { recursive: true });

const pwaZip = join(releaseDir, `dropforge-pwa-${version}.zip`);
zipDirectory(join(root, 'apps', 'web', 'dist'), pwaZip);

// The signaling service is shipped as its compiled output plus the minimum needed to
// run it: no TypeScript, no build step, no workspace on the target machine.
const staging = join(releaseDir, '.signaling');
mkdirSync(staging, { recursive: true });
cpSync(join(root, 'apps', 'signaling', 'dist'), join(staging, 'dist'), { recursive: true });
writeFileSync(
  join(staging, 'package.json'),
  `${JSON.stringify(
    {
      name: 'dropforge-signaling',
      version,
      private: true,
      type: 'module',
      main: 'dist/main.js',
      scripts: { start: 'node dist/main.js' },
      dependencies: { ws: '^8.22.0' },
      engines: { node: '>=22' },
    },
    null,
    2,
  )}\n`,
);
writeFileSync(
  join(staging, 'RUN.md'),
  `# DropForge — service de signalisation ${version}

Serveur optionnel : il permet les transferts **à distance** (entre réseaux
différents). Sur un même réseau local, DropForge fonctionne sans lui.

\`\`\`bash
npm install --omit=dev      # installe ws
npm start                   # écoute sur 0.0.0.0:8787, santé sur /health
\`\`\`

Variables d'environnement : \`PORT\`, \`HOST\`, \`DF_ROOM_TTL_MS\`,
\`DF_MAX_MSG_PER_SEC\`. Ce serveur ne peut **pas** lire les fichiers transférés :
il ne voit que des messages de négociation et des octets déjà chiffrés.

Vérification de l'archive : \`sha256sum -c SHA256SUMS\`.
`,
);
const signalingZip = join(releaseDir, `dropforge-signaling-${version}.zip`);
zipDirectory(staging, signalingZip);
rmSync(staging, { recursive: true, force: true });

/* ------------------------------------------------------------------ *
 * 3. Checksums
 * ------------------------------------------------------------------ */

const sums = [pwaZip, signalingZip].map((file) => `${sha256(file)}  ${relative(releaseDir, file)}`);
writeFileSync(join(releaseDir, 'SHA256SUMS'), `${sums.join('\n')}\n`);
say('SHA256SUMS');
for (const line of sums) console.log(`         ${line}`);

say(`prêt : ${relative(root, releaseDir)}/ — l’installateur Windows est produit par GitHub Actions sur un tag (docs/DOWNLOAD.md)`);
void dirname;
