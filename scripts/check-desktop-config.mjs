/**
 * Checks the Windows application's Tauri configuration.
 *
 * `tauri.conf.json` is the one file of the desktop build that can be verified without
 * Rust: the Tauri CLI validates it against the official schema of the version in use.
 * That check is worth having in the pipeline — it is how the tray menu was found to be
 * declared in a shape Tauri 2.12 no longer accepts (a menu on the tray icon has to be
 * built in Rust), a mistake that would only have appeared on a Windows machine.
 *
 * What it does *not* check: the Rust code itself, which needs cargo. See
 * `docs/PLATFORM-MATRIX.md` for the honest status of that part.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const desktop = join(root, 'apps', 'desktop');
const cli = join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'tauri.cmd' : 'tauri');

if (!existsSync(cli)) {
  console.error('tauri CLI introuvable : lancez « npm install » avant cette vérification.');
  process.exit(1);
}

let output = '';
let status = 0;
try {
  output = execFileSync(cli, ['info'], { cwd: desktop, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
} catch (error) {
  output = `${error?.stdout ?? ''}${error?.stderr ?? ''}`;
  status = error?.status ?? 1;
}

const reported = /error on .+/.exec(output)?.[0];
if (reported || status !== 0) {
  console.error('Configuration invalide :');
  console.error(output.trim());
  process.exit(1);
}

// The environment section reports the missing Rust toolchain; that is expected here and
// is not an error. What matters is that the configuration parsed.
console.log('Configuration Tauri valide (schéma officiel).');
