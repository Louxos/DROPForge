/**
 * Écrit l'annexe « dépendances » de docs/TECHNIQUE.md : l'inventaire complet.
 *
 *   node scripts/list-dependencies.mjs
 *
 * Pourquoi le fichier de verrouillage plutôt qu'un parcours de `node_modules` : c'est
 * lui qui décrit exactement ce qui sera installé, y compris les dépendances
 * transitives, et il est déjà versionné. Le document produit répond aux questions
 * qu'on se pose avant d'adopter un projet :
 *
 *   - quelles dépendances directes, à quelle version, et sous quelle licence ?
 *   - combien de dépendances transitives, et sous quelles licences ?
 *   - y a-t-il une seule dépendance qui n'est pas sous une licence permissive ?
 *
 * Aucun accès réseau, aucune supposition : les champs absents sont écrits « non
 * renseignée » au lieu d'être devinés.
 */
import { readFileSync } from 'node:fs';
import { demoteHeadings, writeSection } from './lib/generated-section.mjs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
const WORKSPACE_PACKAGES = [
  'app-core',
  'connection-manager',
  'design-system',
  'device-manager',
  'history',
  'notifications',
  'protocol',
  'security',
  'settings',
  'sharing',
  'transfer-engine',
];
const manifests = [
  'package.json',
  'apps/web/package.json',
  'apps/signaling/package.json',
  ...WORKSPACE_PACKAGES.map((name) => `packages/${name}/package.json`),
];

/** Qui déclare quoi : un même paquet peut être direct pour deux espaces de travail. */
const declaredBy = new Map();
for (const relative of manifests) {
  const manifest = JSON.parse(readFileSync(join(root, relative), 'utf8'));
  for (const [section, dependencies] of Object.entries({
    dependencies: manifest.dependencies ?? {},
    devDependencies: manifest.devDependencies ?? {},
    optionalDependencies: manifest.optionalDependencies ?? {},
  })) {
    for (const [name, range] of Object.entries(dependencies)) {
      const key = name.startsWith('@dropforge/') ? `${name} (espace de travail)` : name;
      if (!declaredBy.has(key)) declaredBy.set(key, []);
      declaredBy.get(key).push({ where: relative, section, range });
    }
  }
}

/** Les paquets installés, d'après le fichier de verrouillage. */
const installed = [];
for (const [path, entry] of Object.entries(lock.packages ?? {})) {
  if (path === '') continue; // le projet lui-même n'est pas une dépendance
  if (!entry.version) continue;
  if (entry.link === true || path.startsWith('packages/') || path.startsWith('apps/')) continue;
  // `node_modules/foo`, `node_modules/foo/node_modules/bar`… : le nom est le dernier
  // segment après le dernier `node_modules/`.
  const name = entry.name ?? path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length);
  installed.push({ name, version: entry.version, license: entry.license ?? '', path });
}

const direct = [];
const transitive = [];
for (const dependency of installed) {
  const isDirect = declaredBy.has(dependency.name);
  (isDirect ? direct : transitive).push(dependency);
}

const byLicense = (list) => {
  const groups = new Map();
  for (const dependency of list) {
    const license = dependency.license || 'non renseignée';
    if (!groups.has(license)) groups.set(license, []);
    groups.get(license).push(`${dependency.name}@${dependency.version}`);
  }
  return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
};

const rows = (list) =>
  [...list]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((dependency) => {
      const declarations = (declaredBy.get(dependency.name) ?? [])
        .map((declaration) => `${declaration.where} (${declaration.section}, ${declaration.range})`)
        .join(' ; ');
      return `| \`${dependency.name}\` | ${dependency.version} | ${dependency.license || 'non renseignée'} | ${declarations || '—'} |`;
    })
    .join('\n');

const licences = [...new Set(installed.map((dependency) => dependency.license || 'non renseignée'))].sort();

/**
 * Licences qui ne sont pas de simples permissions : elles demandent quelque chose de
 * précis à qui redistribue le logiciel. Elles ne sont pas un problème en soi — elles
 * doivent simplement être **connues**, et c'est ce que cette section existe pour faire.
 */
const ATTENTION = [
  {
    match: /^MPL-2\.0$/,
    what: 'copyleft au niveau du fichier',
    detail:
      "Réutiliser le paquet tel quel n'impose rien. Modifier ses fichiers **et** redistribuer le résultat oblige à publier ces fichiers modifiés sous la même licence. Aucun paquet MPL n'est modifié par DropForge.",
  },
  {
    match: /^CC-BY-4\.0$/,
    what: 'attribution',
    detail:
      "Utilisation libre, y compris commerciale, à condition de citer la source. Concerne ici des données (compatibilité des navigateurs), pas du code exécuté.",
  },
  {
    match: /^\/|^\/|CC0/i,
    what: 'domaine public',
    detail: "Aucune obligation : la licence la plus permissive possible.",
  },
  {
    match: /GPL|AGPL|SSPL|EUPL|CDDL|BUSL/i,
    what: 'copyleft fort',
    detail: "À éviter dans un produit distribué sous une autre licence : à traiter comme un blocage.",
  },
];

const attention = ATTENTION.map((rule) => ({
  ...rule,
  packages: installed.filter((dependency) => rule.match.test(dependency.license || '')).map((dependency) => dependency.name),
})).filter((rule) => rule.packages.length > 0);

const document = `# Inventaire des dépendances

> Document **généré** : \`node scripts/list-dependencies.mjs\`. Ne pas modifier à la main.

Ce document décrit **ce qui sera réellement installé** par \`npm ci\`, lu depuis
\`package-lock.json\` : dépendances directes, dépendances transitives, versions et
licences. Les licences des dépendances directes sont détaillées dans l'annexe B de ce
même document ; ici, la question posée est différente : que contient l'installation, et
y a-t-il quelque chose de problématique dedans ?

## Résumé

| Mesure | Valeur |
| --- | --- |
| Dépendances directes | ${direct.length} |
| Dépendances transitives | ${transitive.length} |
| Total installé | ${installed.length} |
| Licences distinctes | ${licences.length} |
| Licences copyleft fortes détectées | ${attention.some((rule) => rule.what === 'copyleft fort') ? attention.find((rule) => rule.what === 'copyleft fort').packages.join(', ') : 'aucune'} |

Les paquets internes (\`@dropforge/*\`) ne figurent pas ici : ce sont des sources
TypeScript du dépôt, reliées par des alias, jamais publiées ni installées.

## Licences, par nombre de paquets

| Licence | Paquets |
| --- | --- |
${byLicense(installed)
  .map(([license, packages]) => `| ${license} | ${packages.length} |`)
  .join('\n')}

## Licences qui demandent quelque chose

${attention.length === 0 ? "Aucune : tout est sous licence permissive." : attention
  .map(
    (rule) =>
      `### ${rule.what} — ${rule.packages.length} paquet(s)\n\n${rule.detail}\n\nPaquets : ${rule.packages
        .map((name) => `\`${name}\``)
        .join(', ')}\n`,
  )
  .join('\n')}
## Dépendances directes

| Paquet | Version | Licence | Déclaré par |
| --- | --- | --- | --- |
${rows(direct)}

## Dépendances transitives

Ces paquets ne sont pas choisis directement : ils viennent des précédents. Ils sont
listés parce qu'ils font partie de l'installation et que leur licence compte autant.

| Paquet | Version | Licence | Déclaré par |
| --- | --- | --- | --- |
${rows(transitive)}

## Comment vérifier soi-même

\`\`\`bash
npm ci                     # installe exactement ces versions
npm run licences                     # régénère l'annexe B (licences directes)
node scripts/list-dependencies.mjs   # régénère l'annexe A (ce document)
npm ls --all               # l'arbre complet, tel que npm le voit
\`\`\`
`;

// Le contenu vit dans `docs/TECHNIQUE.md` (§ 12, annexe A) : les titres descendent de
// deux niveaux pour se placer sous le titre de l'annexe.
const { bytes } = writeSection(
  join(root, 'docs', 'TECHNIQUE.md'),
  'DEPENDANCES',
  demoteHeadings(document, 2),
);
const strongCopyleft = attention.find((rule) => rule.what === 'copyleft fort');
console.log(
  `docs/TECHNIQUE.md — annexe « dépendances » écrite (${bytes} octets) : ` +
    `${direct.length} directes, ${transitive.length} transitives, ${licences.length} licences` +
    (strongCopyleft ? `, copyleft forte : ${strongCopyleft.packages.join(', ')}` : ', aucune copyleft forte'),
);
