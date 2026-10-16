/**
 * Starts the two development services at once: the application (Vite, port 5173)
 * and the signaling service (port 8787). Ctrl-C stops both.
 *
 * The signaling service is optional for real use — local network transfers work
 * without it — but it is what makes two devices on different networks connect, so
 * it is started by default in development.
 *
 * Served in clear by default, because that is what `http://localhost` is for: it is a
 * secure context, so everything works, and a browser opened from this machine never
 * sees a certificate warning. `--https` serves it with a certificate made for this
 * machine instead, which is what a phone needs: the development server listens on
 * `0.0.0.0` on purpose — that is how a phone is used to test a transfer — and a phone
 * opening `http://192.168.x.x` gets no `crypto.subtle` at all, so a transfer cannot
 * work while everything else looks fine. (For two real devices, `npm run lan` is the
 * path that is documented and tested; this flag is for working on the code.)
 */
import { spawn } from 'node:child_process';
import { hostname, networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureLocalCertificate } from './lib/self-signed.mjs';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const root = fileURLToPath(new URL('..', import.meta.url));

/** Every address another device on this network could use to reach this machine. */
function lanAddresses() {
  const found = [];
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family !== 'IPv4' || address.internal) continue;
      found.push(address.address);
    }
  }
  return found;
}

function certificate() {
  try {
    return ensureLocalCertificate(join(root, '.lan-tls'), {
      hostnames: ['localhost', hostname(), `${hostname()}.local`],
      addresses: lanAddresses(),
    });
  } catch (error) {
    process.stderr.write(`\nCertificat local indisponible : ${String(error)}\n`);
    process.stderr.write('Relancez sans --https pour travailler en clair (localhost seulement).\n');
    process.exit(1);
  }
}

const tls = process.argv.includes('--https') ? certificate() : undefined;
const scheme = tls ? 'https' : 'http';
const webEnv = tls
  ? { DROPFORGE_TLS_KEY: join(root, '.lan-tls', 'key.pem'), DROPFORGE_TLS_CERT: join(root, '.lan-tls', 'cert.pem') }
  : {};

const services = [
  { name: 'signaling', args: ['run', 'dev', '-w', '@dropforge/signaling'], color: '\u001b[36m', env: {} },
  { name: 'web', args: ['run', 'dev:web'], color: '\u001b[35m', env: webEnv },
];

const children = [];
let stopping = false;

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  setTimeout(() => process.exit(code), 300).unref();
}

for (const service of services) {
  // Un `.cmd` ne se lance pas directement sous Windows (Node refuse : « spawn EINVAL ») :
  // le shell est requis là, et seulement là.
  const child = spawn(npm, service.args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...service.env },
    shell: process.platform === 'win32',
  });
  children.push(child);
  const prefix = `${service.color}[${service.name}]\u001b[0m `;
  const forward = (stream, target) => {
    stream.setEncoding('utf8');
    let buffered = '';
    stream.on('data', (chunk) => {
      buffered += chunk;
      const lines = buffered.split('\n');
      buffered = lines.pop() ?? '';
      for (const line of lines) target.write(`${prefix}${line}\n`);
    });
  };
  forward(child.stdout, process.stdout);
  forward(child.stderr, process.stderr);
  child.on('exit', (code) => {
    process.stdout.write(`${prefix}arrêté (code ${code ?? 0})\n`);
    stop(code ?? 0);
  });
}

process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
process.stdout.write(
  `\nDropForge : application sur ${scheme}://localhost:5173 — signalisation sur http://localhost:8787\n`,
);
if (tls) {
  process.stdout.write(
    '  (depuis un autre appareil du réseau, ouvrez l’adresse affichée et acceptez le certificat local une fois)\n',
  );
}
process.stdout.write('\n');
