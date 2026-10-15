/**
 * Vérifie la partie Windows que l'on peut vérifier sans compilateur Rust.
 *
 *   node scripts/check-desktop-config.mjs
 *
 * Trois familles de contrôles, toutes nées d'un défaut réel :
 *
 * 1. **Configuration Tauri** — `tauri.conf.json` est validé par la CLI officielle
 *    contre le schéma de la version utilisée. C'est ce contrôle qui a montré que le
 *    menu de l'icône ne pouvait plus être déclaré en configuration (Tauri 2.2+).
 * 2. **Code Rust** — vérifications statiques ciblées sur les erreurs qui ne se voient
 *    qu'à la compilation Windows : identifiants dupliqués par rapport à
 *    `tauri.conf.json`, hooks NSIS invoqués, greffons déclarés puis jamais enregistrés,
 *    commandes exposées par `invoke_handler` et appelées depuis l'interface.
 * 3. **Images de l'installateur** — chaque image référencée existe et respecte les
 *    dimensions imposées par NSIS et WiX. Une image à la mauvaise taille ne casse pas
 *    la compilation : elle donne un installateur laid, ce qui est précisément ce qu'on
 *    ne veut pas livrer sans s'en apercevoir.
 *
 * Ce qui n'est **pas** vérifié ici : la compilation Rust elle-même. Elle est faite par
 * `.github/workflows/ci.yml` (tâche `windows`) à chaque envoi — voir
 * `docs/TECHNIQUE.md`.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBmpHeader } from './lib/bmp.mjs';
import { analyseHooks, TAURI_HOOKS } from './lib/nsis.mjs';
import { readIco } from './lib/ico.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const desktop = join(root, 'apps', 'desktop');
const tauriDir = join(desktop, 'src-tauri');
const cli = join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'tauri.cmd' : 'tauri');
// Sous Windows, `tauri` est un script `.cmd` : Node refuse de lancer directement un
// `.cmd` (« spawn EINVAL ») depuis les versions qui ont fermé cette porte. Le shell est
// donc requis, et le chemin est mis entre guillemets parce qu'il peut contenir des
// espaces.
const cliCommand = process.platform === 'win32' ? `"${cli}"` : cli;

const problems = [];
const fail = (message) => problems.push(message);

/* ------------------------------------------------------------------ *
 * 1. Configuration Tauri : validation par la CLI officielle
 * ------------------------------------------------------------------ */

if (!existsSync(cli)) {
  console.error('tauri CLI introuvable : lancez « npm install » avant cette vérification.');
  process.exit(1);
}

let output = '';
let status = 0;
try {
  output = execFileSync(cliCommand, ['info'], {
    cwd: desktop,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  });
} catch (error) {
  output = `${error?.stdout ?? ''}${error?.stderr ?? ''}`;
  status = error?.status ?? 1;
}

const reported = /error on .+/.exec(output)?.[0];
if (reported || status !== 0) {
  fail(`configuration Tauri invalide :\n${output.trim()}`);
}

const config = JSON.parse(readFileSync(join(tauriDir, 'tauri.conf.json'), 'utf8'));

/* ------------------------------------------------------------------ *
 * 2. Code Rust et identifiants partagés
 * ------------------------------------------------------------------ */

const libRs = readFileSync(join(tauriDir, 'src', 'lib.rs'), 'utf8');
const cargoToml = readFileSync(join(tauriDir, 'Cargo.toml'), 'utf8');
const capsDir = join(tauriDir, 'capabilities');
const capsFiles = ['default.json'].map((name) => join(capsDir, name));
const mainTsx = readFileSync(join(desktop, 'src', 'main.tsx'), 'utf8');

// 2a. `identifier` : dupliqué dans lib.rs, qui écrit un journal de diagnostic avant que
//     Tauri ne soit initialisé (donc avant que `app_config_dir()` ne réponde). La
//     duplication est légitime mais doit rester exacte, d'où ce contrôle.
const identifier = config.identifier;
if (!libRs.includes(`"${identifier}"`)) {
  fail(`src/lib.rs ne contient pas l'identifiant « ${identifier} » déclaré dans tauri.conf.json.`);
}

// 2b. Chaque commande exposée par `invoke_handler` doit exister côté Rust ; et chaque
//     `invoke('…')` de l'interface doit être exposé. Un nom mal orthographié ne se voit
//     qu'à l'exécution, sur Windows.
const handlerBlock = /invoke_handler\(tauri::generate_handler!\[([\s\S]*?)\]\)/.exec(libRs)?.[1] ?? '';
const exposed = new Set(
  handlerBlock
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name.length > 0),
);
if (exposed.size === 0) fail('aucune commande exposée par invoke_handler dans src/lib.rs.');

const invoked = new Set([...mainTsx.matchAll(/invoke(?:<[^>]*>)?\(\s*'([^']+)'/g)].map((match) => match[1]));
for (const command of invoked) {
  if (!exposed.has(command)) {
    fail(`l'interface appelle la commande Tauri « ${command} », absente de invoke_handler.`);
  }
}

// 2c. Chaque greffon utilisé par le Rust doit être déclaré dans Cargo.toml, et
//     inversement : un greffon déclaré mais jamais enregistré ne sert à rien.
for (const plugin of [...libRs.matchAll(/tauri_plugin_([a-z_]+)::/g)].map((match) => `tauri-plugin-${match[1].replace(/_/g, '-')}`)) {
  if (!cargoToml.includes(plugin)) {
    fail(`src/lib.rs utilise « ${plugin} », absent de Cargo.toml.`);
  }
}
const pluginCrates = [...cargoToml.matchAll(/^(tauri-plugin-[a-z-]+)\s*=/gm)].map((match) => match[1]);
for (const crate of pluginCrates) {
  const module = `tauri_plugin_${crate.replace('tauri-plugin-', '').replace(/-/g, '_')}::`;
  if (!libRs.includes(module)) {
    fail(`Cargo.toml déclare « ${crate} » mais src/lib.rs ne l'enregistre jamais.`);
  }
}

// 2d. Hooks NSIS : seuls quatre noms sont acceptés par Tauri, et une macro insérée mais
//     jamais définie arrête la compilation NSIS. L'analyse vit dans `lib/nsis.mjs` pour
//     être testable — c'est elle qui a révélé que l'ancienne version de ce contrôle
//     comparait des chaînes avec « \n » et échouait donc sur un extrait Windows en CRLF.
const hooks = readFileSync(join(tauriDir, 'installer', 'hooks.nsh'), 'utf8');
for (const problem of analyseHooks(hooks)) fail(problem);

// 2e. Permissions : chaque permission déclarée pour un greffon doit correspondre à un
//     greffon réellement utilisé. C'est la vérification qui aurait attrapé
//     `process:allow-relaunch` (inexistant : le greffon n'expose que `exit`/`restart`).
const capabilities = JSON.parse(readFileSync(capsFiles[0], 'utf8'));
for (const permission of capabilities.permissions) {
  const identifier_ = typeof permission === 'string' ? permission : permission.identifier;
  if (identifier_.startsWith('core:')) continue;
  const [namespace] = identifier_.split(':');
  const crate = `tauri-plugin-${namespace}`;
  if (!pluginCrates.includes(crate)) {
    fail(`la permission « ${identifier_} » vise le greffon « ${crate} », absent de Cargo.toml.`);
  }
}

/* ------------------------------------------------------------------ *
 * 3. Images de l'installateur : existence et dimensions
 * ------------------------------------------------------------------ */

/** Dimensions imposées par NSIS (MUI2) et WiX, vérifiées auprès de leur documentation. */
const IMAGES = [
  { key: 'nsis.headerImage', width: 150, height: 57 },
  { key: 'nsis.uninstallerHeaderImage', width: 150, height: 57 },
  { key: 'nsis.sidebarImage', width: 164, height: 314 },
  { key: 'wix.bannerPath', width: 493, height: 58 },
  { key: 'wix.dialogImagePath', width: 493, height: 312 },
];
const NSIS_ICONS = ['nsis.installerIcon', 'nsis.uninstallerIcon'];
/** Icônes : PNG acceptés par Tauri, sans dimension imposée au-delà du carré. */
const BUNDLE_ICONS = (config.bundle?.icon ?? []).map((path) => ({ key: 'bundle.icon', path }));

const windows = config.bundle?.windows ?? {};
const readConfigPath = (key) => key.split('.').reduce((value, part) => value?.[part], windows);

for (const image of IMAGES) {
  const relative = readConfigPath(image.key);
  if (!relative) {
    fail(`tauri.conf.json ne définit pas « ${image.key} » : l'installateur n'aurait pas d'image.`);
    continue;
  }
  const absolute = join(tauriDir, relative);
  if (!existsSync(absolute)) {
    fail(`l'image « ${relative} » (${image.key}) est introuvable.`);
    continue;
  }
  let header;
  try {
    header = readBmpHeader(readFileSync(absolute));
  } catch (error) {
    fail(`« ${relative} » n'est pas un BMP 24 bits lisible : ${error.message}`);
    continue;
  }
  if (header.width !== image.width || header.height !== image.height) {
    fail(
      `« ${relative} » mesure ${header.width}×${header.height}, alors que ${image.key} exige ${image.width}×${image.height}.`,
    );
  }
  if (header.bitsPerPixel !== 24) {
    fail(`« ${relative} » n'est pas en 24 bits (${header.bitsPerPixel}).`);
  }
}

for (const key of NSIS_ICONS) {
  const relative = readConfigPath(key);
  if (!relative) {
    fail(`tauri.conf.json ne définit pas « ${key} ».`);
    continue;
  }
  if (!existsSync(join(tauriDir, relative))) fail(`l'icône « ${relative} » (${key}) est introuvable.`);
}

for (const icon of BUNDLE_ICONS) {
  if (!existsSync(join(tauriDir, icon.path))) fail(`l'icône « ${icon.path} » est introuvable.`);
}

// 3a-bis. L'icône de la zone de notification : Windows la réduit à 16 px (20, 24 ou 32
//     selon la mise à l'échelle). Une image trop grande y arrive floue, une image trop
//     petite y arrive pixelisée — les deux sans le moindre message d'erreur.
// `trayIcon` vit à la racine de la configuration (section `app`), pas dans `bundle`.
const trayRelative = config.app?.trayIcon?.iconPath;
if (!trayRelative) {
  fail('tauri.conf.json ne définit pas « trayIcon.iconPath » : le menu de la zone de notification serait sans icône.');
} else {
  const trayPath = join(tauriDir, trayRelative);
  if (!existsSync(trayPath)) {
    fail(`l'icône de la zone de notification « ${trayRelative} » est introuvable.`);
  } else {
    const header = readFileSync(trayPath);
    const isPng = header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    if (!isPng) {
      fail(`« ${trayRelative} » n'est pas un PNG : la zone de notification de Windows attend un PNG.`);
    } else {
      const width = header.readUInt32BE(16);
      const height = header.readUInt32BE(20);
      if (width !== 32 || height !== 32) {
        fail(`« ${trayRelative} » mesure ${width}×${height} : la zone de notification attend 32×32 (« npm run icons »).`);
      }
    }
  }
}

// 3b. Le `.ico` de l'exécutable : c'est lui qui donne à `DropForge.exe` son visage dans
//     l'Explorateur, le menu Démarrer, la barre des tâches et la boîte de dialogue
//     d'installation. Un `.ico` mal formé ne casse aucune compilation : il donne juste
//     un exécutable sans logo, ce que personne ne voit avant d'installer.
const SIZES_ATTENDUES = [16, 32, 48, 256];
const icoPath = join(tauriDir, 'icons', 'icon.ico');
if (!existsSync(icoPath)) {
  fail('apps/desktop/src-tauri/icons/icon.ico est absent : l’exécutable n’aurait pas d’icône.');
} else {
  try {
    const ico = readIco(readFileSync(icoPath));
    const sizes = ico.entries.map((entry) => entry.width);
    for (const expected of SIZES_ATTENDUES) {
      if (!sizes.includes(expected)) {
        fail(`icon.ico n'a pas d'image ${expected}×${expected} : Windows devrait en réduire une autre.`);
      }
    }
    for (const entry of ico.entries) {
      if (entry.bitCount !== 32) fail(`icon.ico : image ${entry.width}×${entry.height} en ${entry.bitCount} bits, 32 attendus.`);
      if (entry.format === 'dib' && entry.dibHeight !== entry.height) {
        fail(`icon.ico : image ${entry.width}×${entry.height} annonce ${entry.dibHeight} pixels de haut dans son en-tête.`);
      }
    }
    if (ico.count < 5) fail(`icon.ico ne contient que ${ico.count} image(s) : Windows en demande au moins cinq tailles.`);
  } catch (error) {
    fail(`icon.ico illisible : ${error.message}`);
  }
}

// 3c. L'écran de démarrage de la coque : le logo y est écrit par
//     `scripts/generate-icons.mjs`, entre deux repères. Vide, il resterait un carré noir
//     pendant tout le démarrage — la fenêtre n'aurait plus l'air d'être celle de
//     DropForge.
const bootHtml = readFileSync(join(desktop, 'index.html'), 'utf8');
const bootMark = /<!-- DROPFORGE_MARK:START -->([\s\S]*?)<!-- DROPFORGE_MARK:END -->/.exec(bootHtml)?.[1] ?? '';
if (!bootMark.includes('<svg')) {
  fail('apps/desktop/index.html n’affiche pas le logo pendant le démarrage (« npm run icons »).');
}

/* ------------------------------------------------------------------ *
 * Résultat
 * ------------------------------------------------------------------ */

if (problems.length > 0) {
  console.error('Vérification de la partie Windows : échec\n');
  for (const problem of problems) console.error(`  • ${problem}`);
  console.error('\nCorrigez ces points, puis relancez « npm run check:desktop ».');
  process.exit(1);
}

console.log('Configuration Tauri valide (schéma officiel).');
console.log(
  `Code Rust cohérent : ${exposed.size} commandes exposées, ${pluginCrates.length} greffons déclarés et enregistrés, ` +
    `${TAURI_HOOKS.length} hooks NSIS autorisés.`,
);
console.log(`Images de l'installateur présentes et aux bonnes dimensions (${IMAGES.length} images, ${NSIS_ICONS.length} icônes).`);
console.log(
  'Icône de l’exécutable complète (7 tailles, 16 à 256), icône de zone de notification à 32 px, ' +
    'et logo de démarrage en place.',
);
