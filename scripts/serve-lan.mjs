/**
 * Le mode « même réseau Wi‑Fi », en une commande.
 *
 * C'est la façon dont DropForge est **réellement utilisable** aujourd'hui : une
 * machine du réseau lance ce script, et les deux appareils ouvrent l'adresse affichée.
 * Tout reste à l'intérieur du réseau — l'application, le service de signalisation qui
 * les met en relation, et les fichiers eux-mêmes (qui passent en direct d'un appareil
 * à l'autre, sans jamais transiter par un serveur).
 *
 * Pourquoi un script plutôt qu'une phrase dans la documentation : parce que la même
 * promesse, en ligne, ne tient pas. Une page servie en HTTPS n'a pas le droit d'ouvrir
 * une connexion `ws://` vers la machine d'à côté, et un hébergement statique ne peut
 * pas tenir une connexion WebSocket ouverte. Le seul chemin qui marche **vraiment**
 * entre deux appareils du même Wi‑Fi est donc celui-ci : les deux appareils ouvrent
 * l'application depuis la machine qui les met en relation.
 *
 * Ce que ce fichier fait, et rien de plus :
 *   1. vérifie que l'application est compilée (sinon la compile) ;
 *   2. démarre le service de signalisation (`/health` répond, salles et relais) ;
 *   3. démarre l'application compilée, en proxifiant `/ws` vers ce service ;
 *   4. affiche l'adresse à ouvrir sur chaque appareil, et ce qu'on y fait.
 *
 * Options : `--port`, `--signaling-port`, `--no-build`.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const root = fileURLToPath(new URL('..', import.meta.url));

/** Options acceptées, dans l'ordre où elles apparaissent dans le message d'aide. */
function options(argv) {
  const read = (name, fallback) => {
    const index = argv.indexOf(name);
    if (index === -1) return fallback;
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`${name} attend une valeur`);
    return value;
  };
  return {
    port: Number.parseInt(read('--port', '4173'), 10),
    signalingPort: Number.parseInt(read('--signaling-port', '8787'), 10),
    build: !argv.includes('--no-build'),
  };
}

/**
 * Les adresses par lesquelles les autres appareils du réseau peuvent joindre cette
 * machine. Une interface interne (`127.0.0.1`, `::1`) ou une interface sans adresse
 * IPv4 ne sert à rien ici : on ne l'affiche pas plutôt que de proposer une adresse que
 * le téléphone à côté ne pourra pas ouvrir.
 */
function lanAddresses() {
  const found = [];
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family !== 'IPv4' || address.internal) continue;
      found.push(address.address);
    }
  }
  // Les adresses privées d'abord : ce sont celles d'un vrai réseau domestique, et
  // celles que le pare-feu d'un poste laisse passer sans question.
  const isPrivate = (ip) =>
    /^192\.168\./.test(ip) || /^10\./.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip);
  return found.sort((a, b) => Number(isPrivate(b)) - Number(isPrivate(a)));
}

function run(args, env = {}) {
  const child = spawn(npm, args, {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...env },
    // Un `.cmd` ne se lance pas directement sous Windows (Node refuse : « spawn
    // EINVAL ») : le shell est requis là, et seulement là.
    shell: process.platform === 'win32',
  });
  const prefix = `[${args.join(' ').includes('signaling') ? 'relais' : 'app'}] `;
  const forward = (stream) => {
    stream.setEncoding('utf8');
    let buffered = '';
    stream.on('data', (chunk) => {
      buffered += chunk;
      const lines = buffered.split('\n');
      buffered = lines.pop() ?? '';
      for (const line of lines) process.stdout.write(`${prefix}${line}\n`);
    });
  };
  forward(child.stdout);
  forward(child.stderr);
  return child;
}

function stop(children, code = 0) {
  for (const child of children) child.kill('SIGTERM');
  setTimeout(() => process.exit(code), 300).unref();
}

async function main() {
  const { port, signalingPort, build } = options(process.argv.slice(2));

  if (build && !existsSync(new URL('../apps/web/dist/index.html', import.meta.url))) {
    process.stdout.write('\nApplication non compilée : compilation en cours…\n');
    const compile = spawn(npm, ['run', 'build:web'], {
      cwd: root,
      stdio: 'inherit',
      env: process.env,
      shell: process.platform === 'win32',
    });
    const exitCode = await new Promise((resolve) => compile.on('exit', resolve));
    if (exitCode !== 0) {
      process.stderr.write('\nLa compilation a échoué : rien n’a été démarré.\n');
      process.exit(1);
    }
  }

  const children = [];
  process.on('SIGINT', () => stop(children));
  process.on('SIGTERM', () => stop(children));

  // Le service de signalisation : les deux appareils y entrent dans la même « salle »,
  // et n'y échangent que de quoi se trouver. Les fichiers, eux, ne le traversent pas.
  const signaling = run(['run', 'start:signaling'], { PORT: String(signalingPort), HOST: '0.0.0.0' });
  children.push(signaling);

  // L'application compilée, avec `/ws` dirigé vers ce service (voir `vite.config.ts`) :
  // les deux appareils n'ont donc qu'une seule adresse à ouvrir, et aucune
  // configuration à faire.
  const web = run(['run', 'preview', '-w', '@dropforge/web', '--', '--port', String(port)], {
    DROPFORGE_SIGNALING_ORIGIN: `http://127.0.0.1:${signalingPort}`,
  });
  children.push(web);

  const addresses = lanAddresses();
  const pad = (line) => process.stdout.write(`${line}\n`);
  setTimeout(() => {
    pad('');
    pad('  DropForge — réseau local');
    pad('  ───────────────────────────────────────────────────────────');
    pad('  Sur **chacun** des deux appareils, ouvrez :');
    if (addresses.length === 0) {
      pad('    (aucune adresse réseau trouvée : cette machine n’est pas sur un Wi‑Fi ?)');
    }
    for (const address of addresses) pad(`    http://${address}:${port}`);
    pad('');
    pad('  Puis, sur l’un : « Recevoir » → « Recevoir d’un appareil » → lisez le code.');
    pad('  Sur l’autre  : « Recevoir » → saisissez ce code → « Se connecter ».');
    pad('  Ce qui voyage : vos fichiers, directement entre les deux appareils.');
    pad('');
    pad('  Ctrl-C arrête tout.');
    pad('');
  }, 1_200);

  // Si l'un des deux meurt, l'autre ne doit pas rester seul : ce mode n'a aucun sens
  // avec un demi-service.
  for (const child of children) {
    child.on('exit', (code) => {
      if (code !== 0) stop(children, code ?? 1);
    });
  }
}

await main();
