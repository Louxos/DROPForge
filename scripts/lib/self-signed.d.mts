/**
 * Déclarations pour `self-signed.mjs`, le générateur de certificat du mode local.
 *
 * Le script lui-même reste du JavaScript (c'est un outil, lancé par `npm run lan`,
 * pas une bibliothèque du produit) ; ces quelques lignes suffisent pour que le test
 * qui l'utilise soit vérifié comme le reste.
 */

export interface GeneratedCertificate {
  /** La clé privée, au format PEM (PKCS#1). */
  key: string;
  /** Le certificat, au format PEM. */
  cert: string;
  /** L'empreinte SHA-256, telle qu'un navigateur l'affiche. */
  fingerprint: string;
  /** La fin de validité, au format lisible par `Date`. */
  notAfter: string;
  /** Le sujet du certificat, tel que l'analyseur le rend. */
  subject: string;
  /** Les noms couverts, sous la forme `DNS:…` et `IP Address:…`. */
  altNames: string[];
}

export interface CertificateRequest {
  hostnames?: string[];
  addresses?: string[];
  days?: number;
  organization?: string;
  commonName?: string;
  now?: Date;
}

export function generateSelfSignedCertificate(options?: CertificateRequest): GeneratedCertificate;

export interface KeptCertificate extends GeneratedCertificate {
  /** Vrai quand le certificat déjà présent a été réutilisé tel quel. */
  reused: boolean;
  /** Les noms que le certificat présent ne couvrait pas, quand il a fallu le refaire. */
  missing: string[];
}

export function ensureLocalCertificate(directory: string, wanted?: CertificateRequest): KeptCertificate;
