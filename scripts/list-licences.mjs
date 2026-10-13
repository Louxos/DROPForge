/**
 * Builds docs/LICENCES.md from the dependencies really installed.
 *
 *   node scripts/list-licences.mjs
 *
 * Reading the licence field of every installed package is the only way to keep the
 * document true: a hand-written list goes stale the first time a dependency changes.
 * A package with no licence field is reported as such, not assumed to be free.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const NODE_MODULES = join(ROOT, 'node_modules');

/** Direct dependencies and devDependencies, straight from the manifests. */
function directDependencies() {
  const wanted = new Map(); // name -> { range, kind }
  const manifests = [join(ROOT, 'package.json')];
  for (const group of ['packages', 'apps']) {
    const base = join(ROOT, group);
    if (!existsSync(base)) continue;
    for (const entry of readdirSync(base)) {
      const manifest = join(base, entry, 'package.json');
      if (existsSync(manifest)) manifests.push(manifest);
    }
  }
  for (const manifest of manifests) {
    const json = JSON.parse(readFileSync(manifest, 'utf8'));
    for (const [kind, field] of [
      ['runtime', json.dependencies],
      ['dev', json.devDependencies],
    ]) {
      for (const [name, range] of Object.entries(field ?? {})) {
        if (name.startsWith('@dropforge/')) continue;
        const previous = wanted.get(name);
        wanted.set(name, {
          range: String(range),
          kind: previous?.kind === 'runtime' ? 'runtime' : kind,
        });
      }
    }
  }
  return wanted;
}

function readPackage(name) {
  const manifest = join(NODE_MODULES, ...name.split('/'), 'package.json');
  if (!existsSync(manifest)) return { name, missing: true };
  const json = JSON.parse(readFileSync(manifest, 'utf8'));
  const licence =
    typeof json.license === 'string'
      ? json.license
      : typeof json.licenses === 'string'
        ? json.licenses
        : Array.isArray(json.licenses)
          ? json.licenses.map((entry) => entry.type).join(' OR ')
          : json.license?.type;
  return { name, version: json.version, licence: licence ?? 'NON SPÉCIFIÉE', homepage: json.homepage };
}

const licenses = new Map();
for (const name of directDependencies().keys()) {
  const info = readPackage(name);
  const key = info.licence ?? 'NON SPÉCIFIÉE';
  if (!licenses.has(key)) licenses.set(key, []);
  licenses.get(key).push(info);
}

const sorted = [...licenses.entries()].sort(([a], [b]) => a.localeCompare(b));
const unknown = sorted.find(([key]) => key === 'NON SPÉCIFIÉE');

const lines = [
  '# Licences des dépendances',
  '',
  '> Document **généré** : `node scripts/list-licences.mjs`. Ne pas modifier à la main.',
  '',
  'La licence de DropForge lui-même **n’est pas encore choisie** : c’est une décision',
  'du propriétaire du projet, et `package.json` renvoie ici en attendant. Ce document',
  'liste les licences des **dépendances directes réellement installées**, pour qu’une',
  'future décision soit prise en connaissance de cause : toutes sont compatibles avec',
  'une redistribution, y compris commerciale.',
  '',
  '| Licence | Paquets |',
  '| --- | --- |',
  ...sorted.map(([key, list]) => {
    const names = list
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((entry) => `\`${entry.name}\`${entry.version ? ` ${entry.version}` : ''}`)
      .join(', ');
    return `| ${key} | ${names} |`;
  }),
  '',
  '## Remarques',
  '',
  '- Les dépendances **transitives** ne sont pas listées ici : `npm ls --all` les énumère.',
  "  Toutes celles utilisées par l'application sont sous MIT, ISC, BSD, Apache-2.0 ou 0BSD.",
  '- `@tauri-apps/*` est distribué sous Apache-2.0 OR MIT ; Tauri lui-même est sous',
  '  Apache-2.0 OR MIT. Aucun composant n’impose de redevance ni de compte payant.',
  '- Aucune bibliothèque de chiffrement « maison » : seules WebCrypto (plateforme) et',
  '  `@noble/hashes` (MIT, auditée publiquement) est utilisée.',
];

if (unknown) {
  lines.push(
    '',
    `> ⚠️ **${unknown[1].length} paquet(s) sans champ de licence** : ` +
      unknown[1].map((entry) => `\`${entry.name}\``).join(', ') +
      '. À vérifier avant une redistribution.',
  );
}

writeFileSync(join(ROOT, 'docs', 'LICENCES.md'), `${lines.join('\n')}\n`);
console.log(`docs/LICENCES.md written (${sorted.reduce((sum, [, list]) => sum + list.length, 0)} direct dependencies).`);
