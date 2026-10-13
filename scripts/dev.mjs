/**
 * Starts the two development services at once: the application (Vite, port 5173)
 * and the signaling service (port 8787). Ctrl-C stops both.
 *
 * The signaling service is optional for real use — local network transfers work
 * without it — but it is what makes two devices on different networks connect, so
 * it is started by default in development.
 */
import { spawn } from 'node:child_process';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const services = [
  { name: 'signaling', args: ['run', 'dev', '-w', '@dropforge/signaling'], color: '\u001b[36m' },
  { name: 'web', args: ['run', 'dev:web'], color: '\u001b[35m' },
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
  const child = spawn(npm, service.args, { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
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
process.stdout.write('\nDropForge : application sur http://localhost:5173 — signalisation sur http://localhost:8787\n\n');
