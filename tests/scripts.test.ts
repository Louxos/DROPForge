/**
 * Guard against a class of bug that has bitten this project twice, always the same
 * way: an npm script invoked with its workspace flag glued into one argument.
 *
 *   spawn('npm', ['run', 'dev -w', '@dropforge/signaling'])   // "Missing script: dev -w"
 *
 * The process starts, prints "Missing script", and the feature is dead — while the
 * unit tests stay green. These tests read the scripts themselves and refuse that
 * shape, plus any `npm run <name>` pointing at a script that does not exist.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// `new URL(...).pathname` donne « /D:/… » sous Windows, ce qui n'est pas un chemin
// utilisable : le dépôt doit se lire de la même façon sur les trois systèmes.
const root = fileURLToPath(new URL('..', import.meta.url));

interface Manifest {
  name: string;
  scripts?: Record<string, string>;
  workspaces?: string[];
}

const readJson = <T>(path: string): T => JSON.parse(readFileSync(join(root, path), 'utf8'));

const rootManifest = readJson<Manifest>('package.json');
interface WorkspacePackage {
  path: string;
  manifest: Manifest;
}

/** Every workspace package, whether its pattern names one directory or a family. */
const workspacePackages: WorkspacePackage[] = (rootManifest.workspaces ?? []).flatMap((pattern) => {
  if (!pattern.endsWith('/*')) {
    return [{ path: pattern, manifest: readJson<Manifest>(join(pattern, 'package.json')) }];
  }
  const directory = pattern.slice(0, -2);
  return readdirSync(join(root, directory), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      path: join(directory, entry.name),
      manifest: readJson<Manifest>(join(directory, entry.name, 'package.json')),
    }));
});

/** The script sources that start other processes. */
const scripts = readdirSync(join(root, 'scripts'))
  .filter((name) => name.endsWith('.mjs'))
  .map((name) => ({ name, source: readFileSync(join(root, 'scripts', name), 'utf8') }));

describe('scripts npm', () => {
  it('chaque « npm run X » d’un script désigne un script qui existe', () => {
    const missing: string[] = [];
    for (const [name, command] of Object.entries(rootManifest.scripts ?? {})) {
      // `npm run start -w @dropforge/signaling` is valid: the script is looked up in
      // the named workspace, not at the root.
      // The shape is `npm run <script> [arguments] [-w <package>]`: the script is
      // looked up in the workspace when one is named, at the root otherwise.
      for (const match of command.matchAll(/npm run ([^\s&|]+)([^\n]*)/g)) {
        const workspace = /-w\s+([^\s&|]+)/.exec(match[2] ?? '')?.[1];
        const target = workspace
          ? workspacePackages.find((entry) => entry.manifest.name === workspace)?.manifest
          : rootManifest;
        if (!target) missing.push(`${name} → paquet inconnu ${workspace}`);
        else if (!Object.keys(target.scripts ?? {}).includes(match[1]!)) {
          missing.push(`${name} → ${match[1]}${workspace ? ` (${workspace})` : ''}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('aucun argument de commande ne colle deux mots ensemble', () => {
    // `'dev -w'` is the shape that silently kills a service: npm looks for a script
    // whose name contains a space, finds nothing, and the process exits 1.
    const offenders: string[] = [];
    for (const { name, source } of scripts) {
      for (const match of source.matchAll(/'(?:run|dev|build|start|test)[^']*\s-[^']*'/g)) {
        offenders.push(`${name}: ${match[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('le lanceur de développement démarre des scripts réels du bon paquet', () => {
    const dev = scripts.find((entry) => entry.name === 'dev.mjs');
    expect(dev).toBeDefined();

    // Every `{ name: '…', args: [...] }` entry is checked against the workspace it
    // names, so a renamed script is caught here rather than in front of the user.
    const entries = [...dev!.source.matchAll(/args: (\[[^\]]*\])/g)].map((match) => JSON.parse(match[1]!.replace(/'/g, '"')) as string[]);
    expect(entries.length).toBeGreaterThanOrEqual(2);

    for (const args of entries) {
      expect(args.every((argument) => !argument.includes(' '))).toBe(true);
      const workspaceIndex = args.indexOf('-w');
      const manifest = workspaceIndex === -1
        ? rootManifest
        : workspacePackages.find((entry) => entry.manifest.name === args[workspaceIndex + 1])?.manifest;
      expect(manifest, `paquet inconnu : ${args.join(' ')}`).toBeDefined();
      const scriptName = args[1];
      expect(Object.keys(manifest!.scripts ?? {})).toContain(scriptName);
    }
  });

  it('aucun script ne construit un paquet qui n’existe plus', () => {
    // Un espace de travail supprimé laisse derrière lui un `-w @dropforge/…` qui ne
    // résout plus — et le défaut s'est déjà produit : `npm run package` échouait alors
    // **uniquement sur un tag**, parce que la chaîne d'intégration appelait
    // `package --no-build`. Le lancement d'une version est le pire endroit pour
    // découvrir ce genre d'oubli : ce contrôle le fait ici, à chaque `npm run test`.
    const names = new Set(workspacePackages.map((entry) => entry.manifest.name));
    const offenders: string[] = [];
    for (const { name, source } of scripts) {
      for (const match of source.matchAll(/'(-w|--workspace)',\s*'([^']+)'/g)) {
        if (!names.has(match[2]!)) offenders.push(`${name} : ${match[2]} (espace de travail inconnu)`);
      }
      for (const match of source.matchAll(/'--workspace=([^']+)'/g)) {
        if (!names.has(match[1]!)) offenders.push(`${name} : ${match[1]} (espace de travail inconnu)`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('les paquets du dépôt déclarent tous un nom et des scripts cohérents', () => {
    for (const { path, manifest } of workspacePackages) {
      expect(manifest.name, path).toMatch(/^@dropforge\//);
      const known = new Set(Object.keys(manifest.scripts ?? {}));
      for (const [name, command] of Object.entries(manifest.scripts ?? {})) {
        for (const match of command.matchAll(/npm run ([^\s&|]+)/g)) {
          expect(known.has(match[1]!), `${path} : ${name} → ${match[1]}`).toBe(true);
        }
      }
    }
  });
});

describe('processus externes', () => {
  it('un exécutable Windows (.cmd) n’est jamais lancé sans shell', () => {
    // Sous Windows, `npm` n'est pas un exécutable mais un script `.cmd`. Node refuse de
    // le lancer directement (« spawn EINVAL ») : il faut passer par un shell, sinon la
    // commande échoue à l'exécution alors que tout va bien en développement sous
    // Linux ou macOS. Ce défaut a été trouvé par la tâche Windows de la chaîne
    // d'intégration ; ce test l'empêche de revenir.
    const offenders: string[] = [];
    for (const { name, source } of scripts) {
      const launchesCmd = /['"][^'"]*\.cmd['"]/.test(source) || /npm\.cmd/.test(source);
      if (!launchesCmd) continue;
      if (!/execFileSync|spawn|execSync/.test(source)) continue;
      if (!/shell:/.test(source)) offenders.push(name);
    }
    expect(offenders).toEqual([]);
  });
});
