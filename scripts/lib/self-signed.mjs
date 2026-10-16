/**
 * Un certificat « auto-signé » pour le réseau local, fabriqué par Node seul.
 *
 * Pourquoi ce fichier existe. Le chiffrement de bout en bout de DropForge passe par
 * `crypto.subtle`, que les navigateurs **refusent hors contexte sécurisé**. Or un
 * contexte sécurisé, c'est `https://`, `http://localhost`, `http://127.0.0.1` — et
 * rien d'autre : une adresse privée en clair (`http://192.168.1.24:4173`) **n'est pas**
 * un contexte sécurisé, ni dans Chrome, ni dans Safari, ni dans Firefox. Le mode
 * « deux appareils sur le même Wi‑Fi » servait donc l'application par-dessus une
 * connexion sur laquelle le navigateur interdit le chiffrement : les deux appareils se
 * trouvaient, puis la remise échouait. Servir en HTTPS n'est pas un confort, c'est la
 * condition pour que la remise ait lieu.
 *
 * D'où un certificat, et d'où ce fichier plutôt qu'une dépendance : une autorité
 * publique ne peut pas émettre de certificat pour une adresse privée, et ajouter une
 * bibliothèque d'ASN.1 pour ~150 lignes de DER serait payer cher une dépendance de
 * plus. Ici, tout tient dans `node:crypto` (clé RSA, signature SHA-256) et dans
 * l'encodage DER écrit à la main, testé par une vraie poignée de main TLS.
 *
 * Ce que ce certificat garantit, et ce qu'il ne garantit pas. Il **chiffre** la
 * connexion : c'est ce dont le navigateur a besoin pour autoriser `crypto.subtle`. Il
 * ne **prouve rien** sur l'identité du serveur (il est signé par lui-même, donc
 * n'importe qui peut en fabriquer un identique). Ce n'est pas grave ici, et il faut le
 * dire clairement : l'identité, dans DropForge, ne vient jamais du transport mais du
 * **code à comparer** affiché sur les deux appareils, et le contenu est scellé de bout
 * en bout par les clés des deux appareils — pas par le TLS.
 */
import { X509Certificate, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/* ------------------------------------------------------------------ *
 * Encodage DER (la notation binaire que tout certificat utilise)
 * ------------------------------------------------------------------ */

/** Longueur DER : courte en dessous de 128, sinon en base 128 sur les octets utiles. */
function encodeLength(length) {
  if (length < 0x80) return Buffer.from([length]);
  const bytes = [];
  let remaining = length;
  while (remaining > 0) {
    bytes.unshift(remaining & 0xff);
    remaining = Math.floor(remaining / 256);
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

/** Un élément « étiquette + longueur + contenu ». */
function tlv(tag, content) {
  return Buffer.concat([Buffer.from([tag]), encodeLength(content.length), content]);
}

const sequence = (...parts) => tlv(0x30, Buffer.concat(parts));
const set = (...parts) => tlv(0x31, Buffer.concat(parts));
const utf8 = (value) => tlv(0x0c, Buffer.from(value, 'utf8'));
const ia5 = (value) => tlv(0x16, Buffer.from(value, 'ascii'));
const nullValue = () => tlv(0x05, Buffer.alloc(0));

/** Entier positif, en retirant les zéros inutiles et en gardant le signe. */
function integer(bytes) {
  let value = Buffer.from(bytes);
  while (value.length > 1 && value[0] === 0 && (value[1] & 0x80) === 0) value = value.subarray(1);
  if (value.length === 0) value = Buffer.from([0]);
  return tlv(0x02, value[0] & 0x80 ? Buffer.concat([Buffer.from([0]), value]) : value);
}

function oid(dotted) {
  const arcs = dotted.split('.').map((part) => Number.parseInt(part, 10));
  const out = [40 * arcs[0] + arcs[1]];
  for (const arc of arcs.slice(2)) {
    const groups = [];
    let value = arc;
    do {
      groups.unshift(value & 0x7f);
      value = Math.floor(value / 128);
    } while (value > 0);
    groups.forEach((group, index) => out.push(index === groups.length - 1 ? group : group | 0x80));
  }
  return tlv(0x06, Buffer.from(out));
}

/** UTCTime jusqu'à 2049, GeneralizedTime ensuite : c'est ce que dit la RFC 5280. */
function time(date) {
  const pad = (value) => String(value).padStart(2, '0');
  if (date.getUTCFullYear() < 2050) {
    const text =
      `${pad(date.getUTCFullYear() % 100)}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
      `${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
    return tlv(0x17, Buffer.from(text, 'ascii'));
  }
  const text =
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
  return tlv(0x18, Buffer.from(text, 'ascii'));
}

/** Un attribut de nom : « CN=DropForge » par exemple. */
const attribute = (type, value) => set(sequence(oid(type), utf8(value)));

/** Les noms OID dont ce certificat a besoin, écrits une fois. */
const OIDS = {
  commonName: '2.5.4.3',
  organization: '2.5.4.10',
  basicConstraints: '2.5.29.19',
  keyUsage: '2.5.29.15',
  extKeyUsage: '2.5.29.37',
  subjectAltName: '2.5.29.17',
  serverAuth: '1.3.6.1.5.5.7.3.1',
  sha256WithRsa: '1.2.840.113549.1.1.11',
  rsaEncryption: '1.2.840.113549.1.1.1',
};

/** `192.168.1.24` → quatre octets ; une adresse IPv6 en donne seize. */
function ipBytes(address) {
  if (address.includes('.')) {
    const parts = address.split('.').map((part) => Number.parseInt(part, 10));
    if (parts.length !== 4 || parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)) {
      throw new Error(`adresse IPv4 invalide : ${address}`);
    }
    return Buffer.from(parts);
  }
  // IPv6 : deux octets par groupe, `::` comble les groupes manquants.
  const [head, tail] = address.split('::');
  const groupsOf = (text) => (text && text.length > 0 ? text.split(':') : []);
  const headGroups = groupsOf(head);
  const tailGroups = address.includes('::') ? groupsOf(tail) : [];
  const missing = 8 - headGroups.length - tailGroups.length;
  if (!address.includes('::') && headGroups.length !== 8) throw new Error(`adresse IPv6 invalide : ${address}`);
  if (missing < 0) throw new Error(`adresse IPv6 invalide : ${address}`);
  const groups = [...headGroups, ...Array.from({ length: missing }, () => '0'), ...tailGroups];
  const bytes = [];
  for (const group of groups) {
    const value = Number.parseInt(group === '' ? '0' : group, 16);
    bytes.push((value >> 8) & 0xff, value & 0xff);
  }
  return Buffer.from(bytes);
}

function sanExtension(hostnames, addresses) {
  const names = [
    ...hostnames.map((host) => tlv(0x82, Buffer.from(host, 'ascii'))), // dNSName
    ...addresses.map((address) => tlv(0x87, ipBytes(address))), // iPAddress
  ];
  return sequence(...names);
}

/** Une extension : un OID, une marque « critique » optionnelle, et sa valeur. */
function extension(type, value, critical = false) {
  return sequence(
    oid(type),
    ...(critical ? [tlv(0x01, Buffer.from([0xff]))] : []),
    tlv(0x04, value),
  );
}

/* ------------------------------------------------------------------ *
 * Le certificat
 * ------------------------------------------------------------------ */

const pem = (label, der) =>
  `-----BEGIN ${label}-----\n${(der.toString('base64').match(/.{1,64}/g) ?? []).join('\n')}\n-----END ${label}-----\n`;

/**
 * Fabrique une clé RSA et un certificat auto-signé qui couvre les noms et adresses
 * donnés.
 *
 * @param {{ hostnames?: string[], addresses?: string[], days?: number, organization?: string, commonName?: string, now?: Date }} options
 * @returns {{ key: string, cert: string, fingerprint: string, notAfter: string, subject: string, altNames: string[] }}
 */
export function generateSelfSignedCertificate(options = {}) {
  const hostnames = [...new Set(options.hostnames ?? [])].filter((host) => host.length > 0);
  const addresses = [...new Set(options.addresses ?? [])].filter((address) => address.length > 0);
  if (hostnames.length === 0 && addresses.length === 0) {
    throw new Error('un certificat doit couvrir au moins un nom ou une adresse');
  }
  const commonName = options.commonName ?? 'DropForge';
  const organization = options.organization ?? 'DropForge';
  const days = options.days ?? 825;
  const now = options.now ?? new Date();
  // Une journée de marge avant : une horloge d'appareil un peu en retard ne doit pas
  // faire passer un certificat valide pour expiré.
  const notBefore = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const notAfter = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const spki = publicKey.export({ type: 'spki', format: 'der' });
  const signatureAlgorithm = sequence(oid(OIDS.sha256WithRsa), nullValue());
  const name = sequence(attribute(OIDS.commonName, commonName), attribute(OIDS.organization, organization));

  const extensions = tlv(
    0xa3, // [3] EXPLICIT Extensions
    sequence(
      extension(OIDS.basicConstraints, sequence(), true),
      // digitalSignature (bit 0) et keyEncipherment (bit 2) : ce que fait un serveur TLS.
      extension(OIDS.keyUsage, tlv(0x03, Buffer.from([0x05, 0xa0])), true),
      extension(OIDS.extKeyUsage, sequence(oid(OIDS.serverAuth))),
      extension(OIDS.subjectAltName, sanExtension(hostnames, addresses)),
    ),
  );

  const tbs = sequence(
    tlv(0xa0, integer(Buffer.from([2]))), // version v3
    integer(randomBytes(16)),
    signatureAlgorithm,
    name, // issuer : lui-même, puisqu'il est auto-signé
    sequence(time(notBefore), time(notAfter)),
    name, // subject
    spki,
    extensions,
  );

  const signature = sign('sha256', tbs, privateKey);
  const der = sequence(tbs, signatureAlgorithm, tlv(0x03, Buffer.concat([Buffer.from([0]), signature])));
  const cert = pem('CERTIFICATE', der);
  const key = pem('RSA PRIVATE KEY', privateKey.export({ type: 'pkcs1', format: 'der' }));

  const parsed = new X509Certificate(cert);
  return {
    key,
    cert,
    fingerprint: parsed.fingerprint256,
    notAfter: parsed.validTo,
    subject: parsed.subject,
    altNames: [
      ...hostnames.map((host) => `DNS:${host}`),
      ...addresses.map((address) => `IP Address:${address}`),
    ],
  };
}

/* ------------------------------------------------------------------ *
 * Le certificat du réseau local, gardé d'une exécution à l'autre
 * ------------------------------------------------------------------ */

/**
 * Le certificat à utiliser pour le réseau local, réutilisé si celui déjà présent fait
 * l'affaire.
 *
 * Pourquoi le garder sur disque plutôt que d'en fabriquer un à chaque démarrage : un
 * navigateur retient l'exception accordée à un certificat donné. Un certificat neuf à
 * chaque lancement redemanderait l'avertissement à chaque fois — sur le téléphone, à
 * chaque transfert. On en fabrique donc un, une fois, et on ne le refait que s'il ne
 * couvre plus les adresses de la machine (elle en change souvent : bail DHCP, VPN,
 * changement de Wi‑Fi) ou s'il approche de son expiration.
 *
 * Le fichier reste sur la machine qui lance `npm run lan`; il ne part nulle part.
 * Comme la clé est privée, elle est écrite en lecture seule pour son propriétaire.
 *
 * @param {string} directory
 * @param {{ hostnames?: string[], addresses?: string[], days?: number, now?: Date }} wanted
 * @returns {{ key: string, cert: string, fingerprint: string, notAfter: string, reused: boolean, missing: string[] }}
 */
export function ensureLocalCertificate(directory, wanted = {}) {
  const hostnames = [...new Set(wanted.hostnames ?? [])].filter((host) => host.length > 0);
  const addresses = [...new Set(wanted.addresses ?? [])].filter((address) => address.length > 0);
  const now = wanted.now ?? new Date();
  const keyPath = join(directory, 'key.pem');
  const certPath = join(directory, 'cert.pem');

  /** Les noms que le certificat doit couvrir, sous la forme où on les cherche. */
  const required = [
    ...hostnames.filter((host) => host !== 'localhost').map((host) => `DNS:${host}`),
    ...addresses.map((address) => `IP Address:${address}`),
  ];

  if (existsSync(keyPath) && existsSync(certPath)) {
    try {
      const kept = readFileSync(certPath, 'utf8');
      const parsed = new X509Certificate(kept);
      const alt = parsed.subjectAltName ?? '';
      const remaining = new Date(parsed.validTo).getTime() - now.getTime();
      const month = 30 * 24 * 60 * 60 * 1000;
      // Une adresse IPv6 est écrite sous sa forme longue par l'analyseur, pas comme on
      // la tape : on ne s'en sert pas pour décider, `127.0.0.1` couvre déjà le local.
      const missing = required.filter((name) => {
        // « IP Address: » contient déjà deux points : on regarde l'adresse elle-même.
        const value = name.startsWith('IP Address:') ? name.slice('IP Address:'.length) : name;
        if (name.startsWith('IP Address:') && value.includes(':')) return false;
        return !alt.includes(name);
      });
      if (remaining > month && missing.length === 0) {
        return {
          key: readFileSync(keyPath, 'utf8'),
          cert: kept,
          fingerprint: parsed.fingerprint256,
          notAfter: parsed.validTo,
          reused: true,
          missing: [],
        };
      }
    } catch {
      // Un fichier illisible ou bricolé à la main n'est pas une raison de s'arrêter :
      // on en fabrique simplement un autre, juste en dessous.
    }
  }

  const generated = generateSelfSignedCertificate({
    hostnames: [...new Set(['localhost', ...hostnames])],
    addresses: [...new Set(['127.0.0.1', ...addresses])],
    ...(wanted.days === undefined ? {} : { days: wanted.days }),
    now,
  });
  mkdirSync(directory, { recursive: true });
  writeFileSync(certPath, generated.cert, { mode: 0o644 });
  writeFileSync(keyPath, generated.key, { mode: 0o600 });
  return { ...generated, reused: false, missing: [] };
}
