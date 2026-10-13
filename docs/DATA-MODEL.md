# Modèle de données local

Tout est local. Aucun contenu de fichier n'est stocké dans ces modèles : uniquement
des métadonnées. Les schémas sont versionnés (`v`) et les migrations sont additives.

## Collections

| Collection | Clé | Version | Contenu | Où |
| --- | --- | --- | --- | --- |
| `settings` | `preferences` | 2 | Préférences utilisateur | SQLite (Windows) / IndexedDB (PWA) |
| `devices` | identifiant d'appareil | 1 | Appareils connus, confiance, révocation | idem |
| `transfers` | identifiant de transfert | 1 | Historique des transferts | idem |
| `resume` | identifiant de transfert | 1 | Points de reprise (plages durables) | idem |
| `shares` | identifiant de partage | 1 | Liens hébergés créés localement | idem |
| `handles` | `receive-folder` | — | Poignée du dossier de réception (navigateur seulement) | IndexedDB |

## `settings` / `preferences` (v2)

```ts
{
  v: 2,
  language: 'fr' | 'en',
  theme: 'dark' | 'light' | 'system',
  notifications: boolean,
  autostart: boolean,              // Windows uniquement, ignoré ailleurs
  closeBehaviour: 'tray' | 'quit',
  receiveFolder: string,           // '' = demander à chaque fois (navigateur)
  conflictPolicy: 'ask' | 'rename' | 'skip' | 'overwrite',
  maxConcurrentTransfers: number,  // 1..8
  maxTransferBytes: number,        // 0 = aucune limite locale
  historyRetentionDays: number,    // 0 = conserver
  trustedDevicesOnly: boolean,
  diagnostics: boolean,            // journaux locaux plus détaillés
  allowHostedSharing: boolean
}
```

Migration : la version 1 est lue et complétée par les valeurs par défaut ; les clés
inconnues sont **signalées** (`ignored`) et jamais silencieusement réécrites.

## `devices` (v1)

```ts
{
  v: 1,
  id: string,
  displayName: string,
  platform: string,
  sign: 'ed25519' | 'p256',
  agree: 'x25519' | 'p256',
  publicKey: string,          // clé publique, jamais la privée
  fingerprint: string,
  trusted: boolean,
  autoAccept: boolean,
  revokedAt?: number,
  lastSeenAt: number
}
```

Règles : un identifiant connu avec une **empreinte différente** est refusé
(`DEVICE_IDENTITY_MISMATCH`) ; une révocation force une nouvelle approbation
explicite avant tout nouveau transfert.

## `transfers` (v1)

```ts
{
  v: 1,
  id: string,
  direction: 'send' | 'receive',
  peerDeviceId: string,
  peerName: string,
  state: TransferState,        // queued … completed
  startedAt: number,
  updatedAt: number,
  completedAt?: number,        // obligatoire si state === 'completed'
  totalBytes: number,
  bytesDone: number,
  files: Array<{
    index: number, path: string, kind: 'file' | 'directory',
    size: number, bytesDone: number, verified?: boolean
  }>,
  transport?: 'lan' | 'webrtc' | 'relay',
  lastErrorCode?: string
}
```

Invariant vérifié par le magasin : `state === 'completed'` **sans** `completedAt`
lève `INTEGRITY_FAILED`. Un transfert terminé ne peut donc pas être enregistré par
erreur comme réussi.

## `resume` (v1)

```ts
{
  v: 1,
  transferId: string,
  manifestHash: string,        // adopté seulement si identique
  streamIndex: number,
  files: Array<{ index: number, path: string, size: number, ranges: Array<{ start: number, end: number }> }>,
  updatedAt: number
}
```

Aucun octet de fichier : uniquement des plages ([début, fin[) déjà écrites de façon
durable.

## `shares` (v1)

```ts
{
  v: 1,
  id: string,
  url: string,                 // contient la clé dans le fragment
  createdAt: number,
  expiresAt: number,
  totalBytes: number,
  downloads: number            // tel que rapporté par le service de partage
}
```

## Migrations

- **Schéma local** : `IndexedDbMetaStore` ouvre la base en version 2 ; la montée de
  version n'ajoute que les magasins manquants (idempotent). Testé : une base créée en
  version 1 par une version antérieure s'ouvre sans perdre ses données.
- **Windows (SQLite)** : même principe, `user_version` incrémentée, `ALTER TABLE`
  additifs, jamais de `DROP`.
- **Crash-sûreté** : chaque écriture est atomique (transaction IndexedDB, transaction
  SQLite) ; un lot est écrit en une seule transaction, donc jamais à moitié visible.
- **Réglages** : une version inconnue est ignorée avec un avertissement plutôt que
  réinterprétée.

## Suppression

L'utilisateur peut supprimer une entrée d'historique, tout l'historique, un appareil
(oubli), ou réinitialiser l'identité (ce qui oublie aussi les appareils approuvés).
Aucune de ces actions n'envoie quoi que ce soit à un service distant.
