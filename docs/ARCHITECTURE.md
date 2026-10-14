# Architecture

Ce document décrit ce qui existe réellement dans le dépôt, module par module, et
les décisions techniques prises. Il ne décrit pas une intention : chaque affirmation
correspond à du code présent et testé (voir `docs/TESTING.md` pour savoir ce qui est
testé et ce qui ne l'est pas).

## Vue d'ensemble

```
┌──────────────────────────────┐        ┌──────────────────────────────┐
│  Application Windows          │        │  PWA (mobile / navigateur)   │
│  apps/desktop (Tauri 2)       │        │  apps/web (React + Vite)     │
│  React + TypeScript partagé   │        │  React + TypeScript partagé  │
└──────────────┬───────────────┘        └──────────────┬───────────────┘
               │                                        │
               │  mêmes paquets métier (@dropforge/*)   │
               ▼                                        ▼
        platform-windows                        platform-web
        (SQLite, dossier, tray)                 (IndexedDB, File System Access)
               │                                        │
               └───────────────┬────────────────────────┘
                               ▼
        app-core → device-manager, history, settings, notifications, sharing
                               ▼
        connection-manager  →  transfer-engine  →  protocol  →  security
                               ▼
                    signaling / relais aveugle (apps/signaling)
```

Deux règles structurent tout le reste :

1. **L'interface n'est jamais mélangée au moteur de transfert.** Les paquets
   `packages/*` ne connaissent ni React ni le DOM. Ils exposent des ports
   (`Transport`, `Clock`, `Logger`, `MetaStore`, `FileSystemPort`) que les
   applications implémentent. C'est ce qui permet de tester un transfert complet en
   mémoire, sans navigateur ni Windows.
2. **Aucune donnée n'est inventée pour l'interface.** Une vitesse inconnue n'est pas
   affichée, une progression non fiable devient une barre indéterminée, une
   capacité absente est désactivée avec son explication. Le contrôleur d'application
   est la seule source de vérité, et il ne publie que ce qui s'est réellement produit.

## Paquets

| Module | Rôle | Dépend de |
| --- | --- | --- |
| `protocol` | Format de trame, messages de contrôle (zod), chemins sûrs, intégrité, ports `Transport`/`Clock`/`Logger` | — |
| `security` | Identité (Ed25519/X25519), handshake authentifié, session chiffrée (AES-256-GCM), appairage QR | `protocol` |
| `app-core` | Codes d'erreur, machine à états, ports de stockage, interface `FileSystemPort`, mesure de progression | `protocol` |
| `transfer-engine` | Manifeste, expédition, réception, reprise, file d'attente, orchestration `sendTransfer`/`receiveTransfer` | `protocol`, `app-core`, `security` |
| `connection-manager` | Choix de la meilleure méthode réellement disponible, handshake applicatif, confiance | `protocol`, `security`, `app-core` |

> **Confirmation d'un appareil.** Elle est annoncée (`trust.request`, capacité du hello)
et demandée par un message dédié (`trustRequest`, envoyé avant `auth`). Elle ne dépend plus
du seul code QR : un appareil joint par code est confirmé **des deux côtés**, chacun
comparant le même code à 6 chiffres. Un pair qui ne sait pas demander à son utilisateur
n'en reçoit jamais la demande — il n'attendrait qu'une réponse qui ne viendra pas.
| `device-manager` | Appareils connus, confiance, révocation, cache de découverte | `app-core` |
| `history` | Historique versionné, recherche, export, purge | `app-core` |
| `settings` | Préférences versionnées, validation par liste blanche, migrations | `app-core` |
| `sharing` | Liens hébergés temporaires (chiffrés côté expéditeur) | `protocol`, `app-core` |
| `notifications` | Notifications système, anti-doublon, journal local | `protocol` |
| `design-system` | Jetons, thèmes clair/sombre, formatage, feuille de style `.df-*` | — |

## Applications

### `apps/web` — PWA

| Fichier | Rôle |
| --- | --- |
| `src/app/controller.ts` | Tout l'état et toutes les commandes, sans React ni DOM |
| `src/app/shell.tsx` | Coquille : barre latérale (bureau) / barre basse (mobile), navigation |
| `src/screens/*` | Transfert, Appareils, Historique, Réglages |
| `src/platform/capabilities.ts` | Ce que le navigateur sait *réellement* faire, mesuré une fois |
| `src/platform/browser-fs.ts` | Écriture dans un dossier choisi, ou téléchargement en repli |
| `src/platform/receive-folder.ts` | Dossier de réception mémorisé + permission renouvelée par le navigateur |
| `src/platform/webrtc-transport.ts` | Transport WebRTC, client de signalisation, transport relais |
| `src/platform/webrtc-link.ts` | Fabrique de liens : connexion directe, ou relais aveugle |
| `src/platform/indexed-db-store.ts` | `MetaStore` sur IndexedDB (schéma versionné, migration) |
| `src/platform/identity-store.ts` | Identité persistée localement |
| `src/platform/updater.ts` | Mises à jour : détection, accord de l'utilisateur, jamais d'installation silencieuse |

### `apps/signaling` — relais aveugle

Serveur WebSocket qui met deux appareils en relation et, si nécessaire, relaie des
trames chiffrées. Il ne peut pas lire les fichiers : il ne voit qu'un octet de type,
un nonce et du chiffré. Voir `docs/THREAT-MODEL.md`.

| Contrainte | Valeur |
| --- | --- |
| Salles | 2 pairs, TTL 10 min (prolongé à chaque message), 32 signaux en attente |
| Débit | 20 messages/s par pair, 64 Kio par message de contrôle |
| Trames binaires | relayées telles quelles, seulement après accord des deux pairs (`relay-ready`) |

## Construire, publier, distribuer

| Élément | Rôle |
| --- | --- |
| `npm run dev` (`scripts/dev.mjs`) | Application web + signalisation, un seul Ctrl-C pour tout arrêter |
| `npm run build` | Les trois cibles compilables sans Rust : web, signalisation, interface bureau |
| `npm run build:windows` | Installateur Windows (Rust requis ; la chaîne d'intégration le fait sur `windows-latest`) |
| `scripts/package.mjs` + `scripts/lib/zip.mjs` | Écrit `release/*.zip` (application web, serveur) et `SHA256SUMS` sans aucune dépendance |
| `scripts/smoke-release.mjs` + `scripts/lib/unzip.mjs` | Extrait les archives publiées, les sert, démarre le serveur : vérifie ce qui sera téléchargé |
| `deploy/` | nginx, Dockerfiles et compose : application web + signalisation sur une seule origine |
| `.github/workflows/ci.yml` | Types, tests, compilations, paquets, test des paquets |
| `.github/workflows/pages.yml` | Publication de l'application web sur GitHub Pages |
| `.github/workflows/release.yml` | Sur un tag : installateur Windows, paquets, sommes de contrôle, version publiée |

`DROPFORGE_BASE` choisit la base des chemins de l'application web : `./` (archive
téléchargeable, valeur par défaut de `npm run package`), `/<dépôt>/` (GitHub Pages) ou
`/` (racine d'un domaine).

## Décisions techniques et leurs raisons

| Décision | Raison |
| --- | --- |
| React seulement dans les applications, jamais dans les paquets | Un transfert doit être testable sans DOM ; l'interface ne doit pas pouvoir contourner le moteur |
| WebCrypto comme unique primitive cryptographique (+ `@noble/hashes` en flux) | Aucun algorithme maison ; les clés privées ne quittent pas le stockage non exportable quand la plateforme le permet |
| Une trame = un octet de type + nonce + charge | Le relais ne peut pas confondre contrôle et données, et ne peut rien déchiffrer |
| Le contrôleur d'application ne connaît que des ports | Windows (SQLite, dossier) et le navigateur (IndexedDB, File System Access) partagent exactement la même logique |
| L'état publié par le contrôleur est **remplacé** à chaque changement, jamais muté en place | `useSyncExternalStore` compare les instantanés par identité : un objet muté en place laisserait l'interface figée sur son premier rendu alors que le moteur travaille (défaut trouvé par `ui.test.tsx`, corrigé dans `emit()`) |
| Le relais est un serveur Node autonome | Il peut être hébergé n'importe où (y compris chez le propriétaire) sans dépendre d'une API payante |
| Les alias `@dropforge/*` pointent vers les sources TypeScript | Un seul `tsc` vérifie tout le dépôt ; pas d'étape de construction intermédiaire à maintenir |
| Aucune ressource externe (police, CDN, script) | L'application doit fonctionner hors ligne, installée, sans fuite de requêtes vers un tiers |
| Rust ne fait que ce que le système exige, le menu de l'icône compris | Protocole, chiffrement et transfert restent en TypeScript, testés sans système d'exploitation ; depuis Tauri 2.2 le menu de l'icône ne peut plus être déclaré en configuration, il est donc construit dans `lib.rs` |

## Flux d'un transfert

1. **Découverte / appairage** — découverte locale, code de salle, ou lien `#c=…`
   (le code voyage dans le fragment, donc jamais dans un journal serveur).
2. **Connexion** — `connection-manager` essaie les méthodes disponibles dans l'ordre
   (réseau local → WebRTC direct → relais aveugle), s'arrête à la première qui
   fonctionne réellement, et rapporte les échecs sinon.
3. **Handshake** — échange de clés éphémères, preuve de possession de l'identité,
   code de comparaison à 6 chiffres (`SAS`) affiché des deux côtés. Un nouvel
   appareil n'est jamais approuvé sans réponse explicite de l'utilisateur.
4. **Offre** — manifeste (chemins, tailles, empreintes) + espace nécessaire.
5. **Question** — le récepteur calcule les conflits réels et l'espace libre *avant*
   de demander ; l'utilisateur voit des faits, pas des suppositions.
6. **Transfert** — trames scellées, acquittements après écriture durable, reprise
   possible par plages alignées sur les morceaux.
7. **Vérification** — SHA-256 par fichier ; un transfert ne passe à `completed`
   qu'après vérification (`verifying` est un état obligatoire).
8. **Historique** — l'entrée est écrite avec ce qui s'est réellement passé.

## Où regarder pour comprendre une décision

- Pourquoi un refus est `failed` côté expéditeur et jamais `cancelled` : `packages/transfer-engine/src/transfer.ts`.
- Pourquoi une reprise n'est adoptée que si l'empreinte du manifeste correspond :
  `packages/transfer-engine/src/receiver.ts` (`adoptResumeState`).
- Pourquoi un chemin inutilisable est refusé avant toute écriture :
  `packages/protocol/src/paths.ts` + `receiver.refusedEntries`.
- Pourquoi l'interface n'affiche pas de vitesse pendant les premières secondes :
  `packages/app-core/src/progress.ts` (fiabilité mesurée, pas supposée).
