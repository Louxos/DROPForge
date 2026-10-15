/**
 * Garde-fous du mode « deux appareils sur le même Wi‑Fi », et de son certificat.
 *
 * Ce que ces tests protègent : le mode qui **marche vraiment** aujourd'hui. Une page
 * servie en HTTPS ne peut pas ouvrir une connexion `ws://` vers la machine d'à côté, et
 * un hébergement statique ne garde pas de WebSocket ouverte — donc, en pratique, les
 * deux appareils doivent ouvrir l'application depuis une machine du réseau, celle qui
 * les met en relation. C'est ce que fait `npm run lan`.
 *
 * Et ce mode doit être servi en **HTTPS**, pour une raison qui n'a rien d'esthétique :
 * sur une adresse privée en clair, le navigateur supprime `crypto.subtle`. Les deux
 * appareils se trouvent, puis la remise échoue, sans que rien ne l'explique. Le
 * certificat local lève ce blocage ; le test de poignée de main ci-dessous vérifie
 * qu'il est réellement utilisable (signature, dates, noms, usage serveur), avec la
 * pile TLS de Node comme juge — pas avec nos propres affirmations.
 *
 * Ce que ces tests ne prouvent pas : qu'un navigateur donné acceptera l'avertissement,
 * ni qu'un transfert réel passe (pare-feu, Wi‑Fi « invité », P2P bloqué en entreprise).
 * Cela reste la suite de navigateurs (`e2e/`) et un essai humain, décrits dans
 * `docs/GUIDE.md` § 4.
 */
import { readFileSync, rmSync, statSync } from 'node:fs';
import { request } from 'node:https';
import { createServer } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { X509Certificate } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ensureLocalCertificate, generateSelfSignedCertificate } from '../scripts/lib/self-signed.mjs';

/** `authorized` n'existe que sur une socket TLS : on le lit sans mentir sur le type. */
const authorized = (socket: unknown): boolean => (socket as { authorized?: boolean } | null)?.authorized === true;

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (path: string): string => readFileSync(join(root, path), 'utf8');

const script = read('scripts/serve-lan.mjs');
const library = read('scripts/lib/self-signed.mjs');
const rootManifest = JSON.parse(read('package.json')) as { scripts?: Record<string, string> };
const viteConfig = read('apps/web/vite.config.ts');
const guide = read('docs/GUIDE.md');
const gitignore = read('.gitignore');

describe('mode réseau local', () => {
  it('s’installe par une seule commande', () => {
    expect(rootManifest.scripts?.['lan']).toBe('node scripts/serve-lan.mjs');
    // Le service de mise en relation est déjà exposé par un script du dépôt : le
    // mode local ne doit pas en réinventer un.
    expect(rootManifest.scripts?.['start:signaling']).toContain('signaling');
  });

  it('démarre l’application et le service, et affiche l’adresse à ouvrir', () => {
    // Les deux processus, et l'adresse locale du service donnée à l'application.
    expect(script).toContain("run(['run', 'start:signaling']");
    expect(script).toContain("run(['run', 'preview', '-w', '@dropforge/web'");
    expect(script).toContain('DROPFORGE_SIGNALING_ORIGIN');
    // Les adresses des autres appareils, et l'instruction qui va avec.
    expect(script).toContain('networkInterfaces');
    expect(script).toContain('${scheme}://${address}:${port}');
    expect(script).toContain('Recevoir');
    // Compilation seulement si elle manque : le mode local ne recompile pas pour rien.
    expect(script).toContain('existsSync');
    expect(script).toContain("spawn(npm, ['run', 'build:web']");
  });

  it('sert l’application en HTTPS, parce qu’en clair le chiffrement est interdit', () => {
    // HTTPS est le défaut, `--http` l'exception assumée.
    expect(script).toContain('tls: !argv.includes');
    expect(script).toContain("--http");
    expect(script).toContain('ensureLocalCertificate');
    // Et la raison est écrite là où on la lira : dans le script et dans la
    // bibliothèque, pas seulement dans un ticket perdu.
    expect(script).toMatch(/crypto\.subtle/);
    expect(library).toMatch(/crypto\.subtle/);
    expect(library).toMatch(/contexte sécurisé/);
  });

  it('branche TLS sur les deux serveurs dès qu’un certificat est fourni', () => {
    expect(viteConfig).toContain("process.env['DROPFORGE_TLS_KEY']");
    expect(viteConfig).toContain("process.env['DROPFORGE_TLS_CERT']");
    // Les deux : le serveur de développement et l'aperçu compilé servent le réseau local.
    expect((viteConfig.match(/\.\.\.\(TLS \? \{ https: TLS \} : \{\}\)/g) ?? []).length).toBe(2);
    // La clé est passée par des chemins de fichiers, jamais par la ligne de commande.
    expect(script).toContain("DROPFORGE_TLS_KEY: join(root, '.lan-tls', 'key.pem')");
  });

  it('ne laisse pas un demi-service tourner, et ne laisse pas fuir la clé', () => {
    // Si l'un des deux processus s'arrête en erreur, l'autre est arrêté aussi.
    expect(script).toContain("child.on('exit'");
    expect(script).toContain('stop(children');
    expect(script).toContain("process.on('SIGINT'");
    // Le certificat (donc la clé privée) est local à la machine et n'est pas versionné.
    expect(gitignore).toContain('.lan-tls/');
  });

  it('le proxy `/ws` existe bien des deux côtés', () => {
    // L'application servie par `vite preview` doit diriger `/ws` vers le service : c'est
    // ce qui permet aux deux appareils de n'ouvrir qu'une seule adresse, sans réglage.
    expect(viteConfig).toContain("'/ws': { target: SIGNALING_ORIGIN, ws: true, changeOrigin: true }");
    expect(viteConfig).toContain('preview:');
    // Et le service écoute sur toutes les interfaces en mode local (`HOST` du script).
    expect(script).toContain("HOST: '0.0.0.0'");
  });

  it('le guide dit quoi faire, et ce que ça ne promet pas', () => {
    expect(guide).toContain('npm run lan');
    expect(guide).toContain('même Wi‑Fi');
    // La raison technique, celle qui explique pourquoi une adresse en ligne ne suffit
    // pas : sans elle, quelqu'un finira par « corriger » le script en croyant à un oubli.
    expect(guide).toMatch(/HTTPS/i);
    expect(guide).toMatch(/WebSocket/i);
    // Et l'avertissement du navigateur, expliqué, avec ce qu'il faut faire la première fois.
    expect(guide).toMatch(/Avancé/);
  });
});

describe('certificat du réseau local', () => {
  const hostnames = ['localhost', 'poste.local'];
  const addresses = ['127.0.0.1', '192.168.1.24'];

  it('fabrique un certificat qu’une vraie pile TLS accepte', async () => {
    const generated = generateSelfSignedCertificate({ hostnames, addresses });
    const parsed = new X509Certificate(generated.cert);
    // Les quatre choses qu'un navigateur regarde, vérifiées sur le certificat lui-même.
    expect(parsed.subject).toContain('DropForge');
    expect(new Date(parsed.validTo).getTime()).toBeGreaterThan(Date.now());
    expect(new Date(parsed.validFrom).getTime()).toBeLessThanOrEqual(Date.now());
    const alt = parsed.subjectAltName ?? '';
    for (const host of hostnames) expect(alt).toContain(`DNS:${host}`);
    for (const address of addresses) expect(alt).toContain(`IP Address:${address}`);
    // Le certificat ne sert qu'à chiffrer : il ne prétend pas être une autorité.
    expect(parsed.ca).toBe(false);

    // Le juge : Node lui-même. Le client vérifie la signature, les dates, le nom et
    // l'usage « serveur » ; il refuse tout le reste. `authorized` doit être vrai.
    const server = createServer({ key: generated.key, cert: generated.cert }, (_request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end('ok');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    try {
      const outcome = await new Promise<{ status: number | undefined; body: string; authorized: boolean }>(
        (resolve, reject) => {
          const call = request({ host: '127.0.0.1', port, path: '/', ca: generated.cert }, (response) => {
            let body = '';
            response.on('data', (chunk: Buffer) => (body += chunk.toString()));
            response.on('end', () =>
              resolve({ status: response.statusCode, body, authorized: authorized(call.socket) }),
            );
          });
          call.on('error', reject);
          call.end();
        },
      );
      expect(outcome).toEqual({ status: 200, body: 'ok', authorized: true });

      // Et la même chose par l'adresse LAN, celle qu'on tape sur le téléphone.
      const lan = await new Promise<{ authorized: boolean }>((resolve, reject) => {
        const call = request({ host: '127.0.0.1', port, servername: 'poste.local', ca: generated.cert }, (response) => {
          response.resume();
          response.on('end', () => resolve({ authorized: authorized(call.socket) }));
        });
        call.on('error', reject);
        call.end();
      });
      expect(lan.authorized).toBe(true);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('refuse de fabriquer un certificat qui ne couvrirait rien', () => {
    expect(() => generateSelfSignedCertificate({})).toThrow(/au moins un nom ou une adresse/);
    expect(() => generateSelfSignedCertificate({ addresses: ['192.168.1.999'] })).toThrow(/invalide/);
  });

  it('garde le même certificat, et n’en refait un que si c’est nécessaire', () => {
    const directory = join(tmpdir(), `dropforge-lan-tls-${process.pid}-${Date.now()}`);
    try {
      const first = ensureLocalCertificate(directory, { hostnames, addresses });
      expect(first.reused).toBe(false);
      // Même machine, mêmes adresses : on réutilise. Un certificat neuf à chaque
      // lancement redemanderait l'avertissement du navigateur à chaque lancement.
      const again = ensureLocalCertificate(directory, { hostnames, addresses });
      expect(again.reused).toBe(true);
      expect(again.fingerprint).toBe(first.fingerprint);
      // Une adresse de plus (bail DHCP, VPN, autre Wi‑Fi) : il faut le refaire, sinon le
      // navigateur signale un nom qui ne correspond pas.
      const moved = ensureLocalCertificate(directory, { hostnames, addresses: [...addresses, '10.0.0.7'] });
      expect(moved.reused).toBe(false);
      expect(new X509Certificate(moved.cert).subjectAltName).toContain('IP Address:10.0.0.7');
      // Et on le refait avant l'expiration, pas le jour où il expire.
      const later = ensureLocalCertificate(directory, {
        hostnames,
        addresses: [...addresses, '10.0.0.7'],
        now: new Date(Date.now() + 800 * 24 * 60 * 60 * 1000),
      });
      expect(later.reused).toBe(false);
      // La clé privée n'est lisible que par son propriétaire (là où ça veut dire
      // quelque chose : sous Windows, les droits se règlent autrement).
      if (process.platform !== 'win32') {
        expect(statSync(join(directory, 'key.pem')).mode & 0o777).toBe(0o600);
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
