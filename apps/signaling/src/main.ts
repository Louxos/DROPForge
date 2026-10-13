/**
 * Entry point: `npm run start:signaling` (or `node apps/signaling/src/main.ts`).
 *
 * Configuration, all optional:
 *   PORT                 port to listen on (default 8787)
 *   HOST                 interface (default 0.0.0.0)
 *   DF_ROOM_TTL_MS       room lifetime (default 10 minutes)
 *   DF_MAX_MSG_PER_SEC   control messages per socket per second (default 20)
 */
import { createSignalingServer } from './server.js';

const port = Number.parseInt(process.env['PORT'] ?? '8787', 10);
const host = process.env['HOST'] ?? '0.0.0.0';
const limits = {
  ...(process.env['DF_ROOM_TTL_MS'] ? { ttlMs: Number.parseInt(process.env['DF_ROOM_TTL_MS'], 10) } : {}),
  ...(process.env['DF_MAX_MSG_PER_SEC']
    ? { maxMessagesPerSecond: Number.parseInt(process.env['DF_MAX_MSG_PER_SEC'], 10) }
    : {}),
};

const server = createSignalingServer({
  host,
  port,
  limits,
  log: (level, message, fields) => {
    // Deliberately payload-free logging: sizes and codes only.
    const suffix = fields ? ` ${JSON.stringify(fields)}` : '';
    (level === 'warn' ? console.warn : console.log)(`[signaling] ${message}${suffix}`);
  },
});

const actualPort = await server.listen();
console.log(`[signaling] listening on http://${host}:${actualPort} (health: /health)`);

const shutdown = async (signal: string): Promise<void> => {
  console.log(`[signaling] ${signal}: shutting down`);
  await server.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
