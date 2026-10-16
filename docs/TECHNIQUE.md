# DropForge — documentation technique

Ce document décrit **ce qui existe réellement dans le dépôt** : architecture,
comportement, données, sécurité, plateformes, tests, et l'état honnête du projet
exigence par exigence. Chaque affirmation correspond à du code présent et testé ; quand
ce n'est pas le cas, c'est écrit.

Pour l'usage — installer, se servir, réparer, publier — voir [`GUIDE.md`](GUIDE.md).
Historique des versions : [`../CHANGELOG.md`](../CHANGELOG.md).

**Sommaire** — [1. Vue d'ensemble](#1-vue-densemble) ·
[2. Flux d'un transfert](#2-flux-dun-transfert) ·
[3. Comportement précis](#3-comportement-précis) ·
[4. Données locales](#4-données-locales) ·
[5. Sécurité](#5-sécurité) ·
[6. Vie privée](#6-vie-privée) ·
[7. Partage hébergé](#7-partage-hébergé-optionnel) ·
[8. Plateformes](#8-plateformes-ce-qui-marche-où) ·
[9. Tests](#9-tests) ·
[10. État réel du projet](#10-état-réel-du-projet) ·
[11. Infrastructure 100 % gratuite](#11-infrastructure-100--gratuite) ·
[12. Annexes générées](#12-annexes-générées)

---

## 1. Vue d'ensemble

```
┌──────────────────────────────┐        ┌──────────────────────────────┐
│  Application Windows          │        │  PWA (mobile / navigateur)   │
│  apps/desktop (Tauri 2)       │        │  apps/web (React + Vite)     │
│  React + TypeScript partagé   │        │  React + TypeScript partagé  │
└──────────────┬───────────────┘        └──────────────┬───────────────┘
               │        mêmes paquets métier (@dropforge/*)              │
               ▼                                        ▼
        platform-windows                        platform-web
        (SQLite, dossier, tray)                 (IndexedDB, File System Access)
               └───────────────┬────────────────────────┘
                               ▼
        app-core → device-manager, history, settings, notifications, sharing
                               ▼
        connection-manager  →  transfer-engine  →  protocol  →  security
                               ▼
                    signaling / relais aveugle (apps/signaling)
```

Deux règles structurent tout le reste :

1. **L'interface n'est jamais mélangée au moteur de transfert.** Les paquets `packages/*`
   ne connaissent ni React ni le DOM : ils exposent des ports (`Transport`, `Clock`,
   `Logger`, `MetaStore`, `FileSystemPort`) que les applications implémentent. C'est ce
   qui permet de tester un transfert complet en mémoire, sans navigateur ni Windows.
2. **Aucune donnée n'est inventée pour l'interface.** Une vitesse inconnue n'est pas
   affichée, une progression non fiable devient une barre indéterminée, une capacité
   absente est désactivée avec son explication. Le contrôleur d'application est la seule
   source de vérité et ne publie que ce qui s'est réellement produit.

### Paquets

| Module | Rôle | Dépend de |
| --- | --- | --- |
| `protocol` | Format de trame, messages de contrôle (zod), chemins sûrs, intégrité, ports `Transport`/`Clock`/`Logger` | — |
| `security` | Identité (Ed25519/X25519), handshake authentifié, session chiffrée (AES-256-GCM), appairage QR | `protocol` |
| `app-core` | Codes d'erreur, machine à états, ports de stockage, `FileSystemPort`, mesure de progression | `protocol` |
| `transfer-engine` | Manifeste, expédition, réception, reprise, file d'attente, `sendTransfer`/`receiveTransfer` | `protocol`, `app-core`, `security` |
| `connection-manager` | Choix de la meilleure méthode réellement disponible, handshake applicatif, confiance | `protocol`, `security`, `app-core` |
| `device-manager` | Appareils connus, confiance, révocation, cache de découverte | `app-core` |
| `history` | Historique versionné, recherche, export, purge | `app-core` |
| `settings` | Préférences versionnées, validation par liste blanche, migrations | `app-core` |
| `sharing` | Liens hébergés temporaires (chiffrés côté expéditeur) | `protocol`, `app-core` |
| `notifications` | Notifications système, anti-doublon, journal local | `protocol` |
| `design-system` | Jetons, thèmes clair/sombre, formatage, feuille de style `.df-*` | — |

### Applications

| Emplacement | Rôle |
| --- | --- |
| `apps/web/src/app/controller.ts` | Tout l'état et toutes les commandes, sans React ni DOM |
| `apps/web/src/app/shell.tsx` | Barre latérale (bureau) / barre basse (mobile), navigation |
| `apps/web/src/screens/*` | Transfert, Appareils, Historique, Réglages |
| `apps/web/src/platform/capabilities.ts` | Ce que le navigateur sait *réellement* faire, mesuré une fois |
| `apps/web/src/platform/browser-fs.ts` | Écriture dans un dossier choisi, ou téléchargement en repli |
| `apps/web/src/platform/webrtc-*.ts` | Transport WebRTC, client de signalisation, fabrique de liens (direct ou relais) |
| `apps/web/src/platform/signaling.ts` | Où vit le relais : réglage, adresse du déploiement, ou **rien** — décidé en un seul endroit |
| `apps/web/src/platform/indexed-db-store.ts` | `MetaStore` sur IndexedDB (schéma versionné, migration) |
| `apps/desktop/src-tauri/src/lib.rs` | Fenêtre, zone de notification, dossier de réception, espace libre, journal de diagnostic |
| `apps/desktop/index.html` | Écran de démarrage + contrôle de secours qui affiche la cause réelle d'un échec |
| `apps/desktop/src-tauri/installer/hooks.nsh` | Hooks NSIS : fermeture de l'instance, mise à l'écart de l'exécutable (§ voir `GUIDE.md` § 7) |
| `apps/signaling` | Serveur WebSocket : salles, mise en relation, relais aveugle |

`apps/signaling` : 2 pairs par salle, TTL 10 min (prolongé à chaque message), 32 signaux
en attente, 20 messages/s par pair, 64 Kio par message de contrôle. Les trames binaires
ne sont relayées qu'après accord des **deux** pairs (`relay-ready`).

### Décisions techniques et leurs raisons

| Décision | Raison |
| --- | --- |
| React seulement dans les applications, jamais dans les paquets | Un transfert doit être testable sans DOM ; l'interface ne doit pas pouvoir contourner le moteur |
| WebCrypto comme unique primitive (+ `@noble/hashes` en flux) | Aucun algorithme maison ; clés privées non exportables quand la plateforme le permet |
| Une trame = un octet de type + nonce + charge | Le relais ne peut pas confondre contrôle et données, et ne peut rien déchiffrer |
| Le contrôleur ne connaît que des ports | Windows (SQLite) et le navigateur (IndexedDB, File System Access) partagent la même logique |
| L'état publié est **remplacé** à chaque changement, jamais muté en place | `useSyncExternalStore` compare par identité : un objet muté laisserait l'interface figée (défaut trouvé par un test d'interface, corrigé dans `emit()`) |
| Le relais est un serveur Node autonome | Il peut être hébergé n'importe où sans dépendre d'une API payante |
| Alias `@dropforge/*` vers les sources TypeScript | Un seul `tsc` vérifie tout le dépôt, aucune étape de construction intermédiaire |
| Aucune ressource externe (police, CDN, script) | L'application doit fonctionner hors ligne, installée, sans requête vers un tiers |
| Rust ne fait que ce que le système exige | Protocole, chiffrement et transfert restent en TypeScript, testés sans système d'exploitation |
| L'écran de démarrage porte un contrôle écrit dans la page | Un écran d'attente éternel ne dit rien : celui-ci n'importe rien (il ne peut pas échouer comme ce qu'il surveille) et affiche la cause réelle au bout de 15 s |
| L'installateur écarte l'exécutable au lieu d'insister | Le contrôle du modèle NSIS (Windows **Restart Manager**, `CheckIfAppIsRunning`) interroge un **chemin** (`$INSTDIR\DropForge.exe`), pas des processus : le hook `DROPFORGE_RELEASE_MAIN_BINARY` renomme le fichier que ce contrôle enregistre, donc il n'a plus d'utilisateurs. Un renommage impossible est écrit dans le journal d'installation, jamais avalé |

## 2. Flux d'un transfert

1. **Découverte / appairage** — découverte locale, code de salle, ou lien `#c=…` (le code
   voyage dans le fragment, donc jamais dans un journal serveur).
2. **Connexion** — `connection-manager` essaie les méthodes dans l'ordre (réseau local →
   WebRTC direct → relais aveugle), s'arrête à la première qui fonctionne réellement, et
   rapporte les échecs sinon.
3. **Handshake** — clés éphémères, preuve de possession de l'identité, code de
   comparaison (SAS) à 6 chiffres affiché des deux côtés. Un nouvel appareil est annoncé
   (`trust.request` / capacité du hello) et **attend une réponse** ; un pair qui ne sait
   pas demander à son utilisateur n'en reçoit jamais la demande.
4. **Offre** — manifeste (chemins, tailles, empreintes) + espace nécessaire.
5. **Question** — le récepteur calcule les conflits réels et l'espace libre *avant* de
   demander : l'utilisateur voit des faits, pas des suppositions.
6. **Transfert** — trames scellées, acquittements après écriture durable, reprise par
   plages alignées sur les morceaux.
7. **Vérification** — SHA-256 par fichier ; `completed` n'est atteint qu'après `verifying`.
8. **Historique** — l'entrée est écrite avec ce qui s'est réellement passé.

## 3. Comportement précis

### États d'un transfert

```
queued → connecting → transferring → verifying → completed
             │             │  │            │
             │             │  └── annulation ─→ cancelled
             │             └── pause / reprise
             └── interruption → interrupted → (reprise) → transferring
                                                └── échec → failed
```

Règles non négociables :

- **Aucun transfert ne passe à `completed` sans être passé par `verifying`** (SHA-256 par
  fichier).
- **Un état terminal n'est écrit que par `finishRecord`** : une mesure de progression
  tardive ne peut ni rouvrir ni rétrograder un transfert terminé.
- **Un refus est un échec, pas une annulation** : côté expéditeur, un refus donne
  `failed` avec le code du refus (`TRANSFER_DECLINED`, `NO_SPACE_LEFT`, `BUSY`,
  `TOO_LARGE`), jamais `cancelled`.
- **`partial` se dégrade en `failed`** : une partie manquante n'est jamais un succès.
- **États transitoires finis** : 30 s de handshake, 45 s d'inactivité ; un dépassement
  produit `interrupted` ou `failed` avec un code explicite.

### Erreurs

Toute erreur porte un **code stable** (`packages/app-core/src/errors.ts`, 42 codes), un
message compréhensible, une sévérité et un indicateur `retryable`. L'interface affiche la
traduction du code, jamais le message brut d'une exception.

| Situation | Code | Reprise proposée |
| --- | --- | --- |
| Réseau coupé pendant l'envoi | `CONNECTION_LOST` | Oui |
| Aucune méthode commune | `NO_COMMON_TRANSPORT` | Non (explication affichée) |
| Périphérique non approuvé | `DEVICE_NOT_TRUSTED` | Non |
| Clé différente du souvenir | `DEVICE_IDENTITY_MISMATCH` | Non, et aucune tentative sur un autre chemin |
| Appareil révoqué | `DEVICE_REVOKED` | Non |
| Chemin refusé (traversée, absolu) | `PATH_ESCAPE` / `UNSAFE_PATH` | Non |
| Conflit de nom non tranché | `NAME_CONFLICT` | Oui, après décision |
| Disque plein | `NO_SPACE_LEFT` | Oui |
| Fichier modifié pendant l'envoi | `FILE_CHANGED` | Oui |
| Anti-rejeu / trame inattendue | `SESSION_REPLAY` | Non |
| Stockage local indisponible | `STORAGE_UNAVAILABLE` | Non |

### Fichiers et chemins

- Aucun écrasement silencieux : `create-new`, `replace` (décision explicite) ou `resume`
  (fichier partiel au bon gabarit, taille vérifiée).
- Chemins normalisés et restreints (relatifs, sans `..`, sans absolu, ≤ 1024 octets) ; un
  chemin inutilisable est **refusé et signalé** sans faire échouer tout le transfert.
- Un conflit découvert *après* la décision (fichier créé entre-temps) n'écrase jamais :
  DropForge renomme (au plus 5 essais) et le dit.
- Limites réelles : 256 Kio par morceau, 10 000 fichiers, 2 Tio par transfert, 50 000
  entrées par dossier, 32 niveaux de profondeur (navigateur).

### File d'attente

- Concurrence de 1 à 8 (défaut 2), `pause`, `resume`, `cancel`, `retry`,
  réordonnancement par priorité.
- `retry` ne ré-enqueue que les échecs réellement réessayables (3 essais maximum) : un
  refus n'est jamais rejoué.
- Annuler un élément qui n'a pas démarré **termine son enregistrement** (`cancelled`) au
  lieu de le laisser indéfiniment « en file d'attente ».

### Progression, vitesse, temps restant

- La vitesse n'est affichée que si elle est **mesurée et fiable** (fenêtre glissante avec
  un minimum d'échantillons et de durée) ; sinon la barre est indéterminée.
- Le pourcentage est plafonné à 99 % jusqu'à la vérification finale.
- Le temps restant n'est affiché que si la vitesse est fiable.

### Reprise

- Une reprise n'est adoptée que si l'empreinte du manifeste est **identique** ; les plages
  déjà écrites sont alignées sur les morceaux et re-hachées avant d'être conservées.
- L'état de reprise est persisté localement, sans aucun contenu de fichier.
- Limite documentée : dans un navigateur, la reprise après fermeture de l'onglet suppose
  l'écriture dans un dossier choisi (File System Access) ; sinon le fichier est renvoyé
  du début, et l'interface le dit.

### Notifications

Une notification n'est envoyée que pour une conclusion qui mérite d'interrompre la
personne : envoi terminé (avec le nombre de fichiers et le destinataire), réception
terminée, échec (**avec la raison** tirée du code réel), connexion perdue. Une annulation
volontaire ne notifie **rien** — la personne vient de le faire. Si le moteur ne rapporte
aucune raison, la notification le dit au lieu d'inventer une cause.

### Réglages

Langue (fr/en), thème (système/sombre/clair), notifications, démarrage automatique
Windows, comportement à la fermeture, dossier de réception, politique de conflit,
concurrence, limite de taille locale, appareils approuvés uniquement, ports locaux
optionnels, conservation de l'historique, partage hébergé, journaux de diagnostic. Une
valeur inventée est **refusée** (`UNSUPPORTED_OPERATION`), les valeurs numériques sont
bornées, et un réglage non applicable à la plateforme est désactivé avec son explication.

### Mises à jour

- Vérification à la demande, jamais d'installation silencieuse.
- Windows : seules les mises à jour **signées**, vérifiées contre la clé publique
  intégrée ; cette vérification ne peut pas être désactivée.
- Navigateur : le service worker signale qu'une nouvelle version est prête et n'active
  qu'après accord.
- **La compilation de l'installateur ne dépend plus de `zip`.** Le greffon officiel de
  mise à jour demande `zip ^4` ; l'auteur de `zip` a retiré du registre toutes les versions
  antérieures à 9.0 le **16 octobre 2026** (2.x à 8.x). La résolution s'arrêtait donc net
  — `failed to select a version for the requirement zip = "^2"` — avant la moindre ligne
  compilée, sur le dépôt comme dans la chaîne d'intégration, et **aucune version ne
  pouvait plus être publiée**. `apps/desktop/src-tauri/Cargo.toml` désactive maintenant la
  fonction optionnelle `zip` du greffon (le reste est inchangé : `rustls-tls`,
  `system-proxy`). Conséquence à connaître : une mise à jour Windows publiée en `.nsis.zip`
  ne pourrait pas être décompressée par l'application. Comme aucune clé de signature n'est
  configurée, aucune mise à jour de ce genre n'existe aujourd'hui — **à rouvrir en même
  temps que les clés**, quand le greffon acceptera `zip 9`.

## 4. Données locales

Tout est local. Aucun contenu de fichier dans ces modèles : uniquement des métadonnées,
versionnées (`v`), avec des migrations additives.

| Collection | Clé | Contenu | Où |
| --- | --- | --- | --- |
| `settings` (v2) | `preferences` | Préférences utilisateur | SQLite (Windows) / IndexedDB (PWA) |
| `devices` (v1) | identifiant d'appareil | Appareils connus, confiance, révocation | idem |
| `transfers` (v1) | identifiant de transfert | Historique | idem |
| `resume` (v1) | identifiant de transfert | Points de reprise (plages durables) | idem |
| `shares` (v1) | identifiant de partage | Liens hébergés créés localement | idem |
| `handles` | `receive-folder` | Poignée du dossier de réception | IndexedDB (navigateur seulement) |

**Invariants vérifiés par les magasins** :

- `transfers.state === 'completed'` **sans** `completedAt` lève `INTEGRITY_FAILED` : un
  transfert terminé ne peut pas être enregistré comme réussi par erreur.
- Un appareil connu avec une **empreinte différente** est refusé
  (`DEVICE_IDENTITY_MISMATCH`) ; une révocation force une nouvelle approbation explicite.
- Chaque écriture est atomique (transaction IndexedDB, transaction SQLite) : un lot est
  écrit en une seule transaction, donc jamais à moitié visible.

**Migrations** : IndexedDB s'ouvre en version 2 et n'ajoute que les magasins manquants
(idempotent — testé avec une base créée par une version antérieure) ; côté Windows,
`user_version` incrémentée, `ALTER TABLE` additifs, jamais de `DROP`. Une préférence de
version inconnue est ignorée avec un avertissement plutôt que réinterprétée.

**Suppression** : une entrée d'historique, tout l'historique, un appareil (oubli), ou
l'identité entière (ce qui oublie les appareils approuvés). Aucune de ces actions
n'envoie quoi que ce soit à un service distant.

## 5. Sécurité

### Ce qui a de la valeur, et contre qui

| Actif | Où il vit | Ce qu'une fuite permettrait |
| --- | --- | --- |
| Contenu des fichiers | Appareils de l'utilisateur | Lecture des documents transférés |
| Clés privées d'identité | Stockage local non exportable (WebCrypto) | Usurpation de l'appareil |
| Clés de session | Mémoire, dérivées par handshake | Déchiffrement d'une session en cours |
| Historique, appareils, réglages | Base locale | Reconnaissance de l'activité |
| Clé d'un lien de partage | Fragment de l'URL | Déchiffrement de la copie hébergée |

| Adversaire | Capacités supposées | Ce qu'il ne peut pas faire |
| --- | --- | --- |
| **Réseau passif** | Écoute du trafic | Rien : tout est chiffré de bout en bout |
| **Relais / signalisation hostile** | Lit, modifie, rejoue, bloque | Lire un nom de fichier ou un octet de contenu ; se faire passer pour un pair sans la clé privée |
| **Appareil inconnu sur le réseau** | Se connecte, annonce, propose | Faire accepter un transfert : confirmation obligatoire, clé comparée au souvenir local |
| **Porteur d'un lien de partage** | Possède l'URL complète | Rien de plus que ce que le lien donne : il est fait pour ça, il expire et se révoque |
| **Fournisseur d'hébergement** | Voit les métadonnées (IP, volumes, horaires) | Lire le contenu ou les noms de fichiers |

### Ce qui est protégé, et comment

| Menace | Protection | Où |
| --- | --- | --- |
| Lecture en transit | AES-256-GCM par trame, clés dérivées par ECDH éphémère + HKDF-SHA-256 | `packages/security/src/session.ts` |
| Usurpation d'identité | Handshake exigeant une preuve de possession de la clé ; empreinte comparée au souvenir local | `packages/security/src/handshake.ts` |
| Homme du milieu au premier appairage | SAS à 6 chiffres dérivé du transcript complet, affiché des deux côtés ; un écart doit être refusé | `packages/security` + écran de confirmation |
| Rejeu de trames | Compteur par direction dans le nonce (`SESSION_REPLAY`) | `packages/security/src/session.ts` |
| Falsification d'une trame | AEAD authentifié par trame | idem |
| Faux « terminé » | SHA-256 par fichier, `verifying` obligatoire | `packages/transfer-engine` |
| Écriture hors du dossier choisi | Normalisation, refus des absolus et de `..`, signalé par fichier | `packages/protocol/src/paths.ts` |
| Écrasement silencieux | Modes `create-new`/`replace`/`resume` explicites, question avant remplacement | `packages/transfer-engine` |
| Abus du relais | 2 pairs, TTL 10 min, 20 messages/s, tailles bornées, relais après accord des deux pairs | `apps/signaling/src/rooms.ts` |
| Fuite par les journaux | Aucun secret, clé, jeton ou contenu journalisé ; chemins masqués (`redactPath`) | `packages/protocol/src/paths.ts` |
| Code d'appairage dans un journal serveur | Le code voyage dans le **fragment** de l'URL, jamais envoyé au serveur | `apps/web/src/app/controller.ts` |
| Fichiers hébergés lisibles par le serveur | Chiffrement côté expéditeur, clé jamais transmise au serveur | `packages/sharing` |
| Catalogue d'erreurs fuyant | 42 codes génériques traduits ; jamais le message brut du système | `packages/app-core/src/errors.ts` |
| Permissions Tauri trop larges | Liste courte, vérifiée par `scripts/check-desktop-config.mjs` | `apps/desktop/src-tauri/capabilities/` |

### Ce qui n'est PAS protégé

1. **Le poste lui-même.** Un logiciel malveillant présent sur l'appareil peut lire les
   fichiers que DropForge écrit. DropForge ne chiffre pas le disque.
2. **Un appareil déjà approuvé et compromis** dispose de la confiance accordée ; la
   révocation est manuelle.
3. **Le premier appairage sans comparaison du code.** Si l'utilisateur ne compare pas le
   SAS, un attaquant placé sur le chemin pourrait s'intercaler au premier appairage.
   C'est pourquoi l'écran demande explicitement de comparer le même code des deux côtés.
4. **Les métadonnées de connexion** (IP, horaires, volumes) sont visibles par l'hébergeur
   du relais. L'anonymat réseau n'est pas un objectif : utilisez Tor ou un VPN si
   nécessaire, DropForge ne s'en occupe pas.
5. **Le contenu dans le dossier de réception** : une fois écrit, c'est un fichier normal,
   avec les permissions du système.
6. **La disponibilité** : un attaquant qui contrôle le réseau peut toujours bloquer un
   transfert. DropForge le dit et propose les alternatives qui restent possibles.
7. **Le partage hébergé suppose un tiers** ; il est désactivé par défaut et l'application
   explique ce qu'il implique avant de l'activer.

### Choix cryptographiques

- **Primitives de la plateforme uniquement** : WebCrypto (Ed25519, X25519, HKDF-SHA-256,
  AES-256-GCM, SHA-256), repli P-256 si Ed25519 est absent. Aucun algorithme n'est
  implémenté par le projet.
- **Hachage en flux** : `@noble/hashes` (MIT) pour le SHA-256 incrémental des gros
  fichiers, même primitive que le hachage en une passe.
- **Dérivation** : `ikm = ECDH(éphémères)` ; `salt = sha256(transcript)` ;
  `info = dropforge/v1/{i2r,r2i,sas}` — trois secrets indépendants.
- **Nonce** : préfixe de direction (4 octets) + compteur 64 bits big-endian, jamais
  réutilisé pour une même clé.
- **SAS de 6 chiffres** (~20 bits) : suffisant contre une attaque en ligne pendant la
  fenêtre d'appairage (une tentative par connexion, code changé à chaque appairage),
  **insuffisant** face à des milliers de rejeux — ce n'est pas le modèle : l'identité est
  vérifiée par clé et la confiance mémorisée.

**Signalement d'une vulnérabilité** : en privé, jamais dans une issue publique.

## 6. Vie privée

**DropForge ne collecte rien, n'envoie rien à l'auteur du logiciel, n'exige aucun
compte, et n'a aucune télémétrie — ni par défaut ni en option.**

Ce qui **ne quitte jamais** les appareils : le contenu des fichiers (sauf mode « lien
hébergé », activé explicitement, et même alors la copie part déjà chiffrée), les
préférences, l'historique, la liste des appareils de confiance, les clés privées (créées
localement, jamais exportées).

| Destinataire | Ce qu'il voit | Pourquoi |
| --- | --- | --- |
| L'appareil d'en face | Les fichiers envoyés, leurs noms et tailles | C'est le but du transfert |
| Le service de signalisation (relais aveugle) | IP, horaires, volume, identifiant de salle — **pas** les noms de fichiers, **pas** le contenu | Mettre deux appareils en relation, relayer si le direct est impossible |
| Le service de partage (optionnel, désactivé par défaut) | Une copie **chiffrée**, sa taille, son expiration, le nombre de téléchargements | Héberger temporairement un fichier pour un destinataire hors ligne |
| Serveurs STUN/TURN (seulement si un déploiement en configure) | L'adresse IP publique, pour découvrir le routeur | Trouver un chemin direct entre deux appareils éloignés |

**Aucun serveur STUN n'est utilisé par défaut.** Un déploiement peut en configurer un
(`VITE_ICE_URLS`) : c'est alors un choix explicite, visible dans l'application construite,
et il doit être annoncé aux personnes qui l'utilisent.

Le réglage « journaux de diagnostic » ne fait qu'autoriser des journaux **locaux** plus
détaillés. Aucun journal ne contient de clé, de jeton, de contenu de fichier ni de chemin
complet (masqués).

| Donnée | Emplacement | Durée |
| --- | --- | --- |
| Historique | Local | Réglable (7 jours à toujours, défaut : toujours), supprimable |
| Appareils connus | Local | Jusqu'à oubli ou révocation |
| Points de reprise | Local | Jusqu'à la fin du transfert ou sa suppression |
| Copie hébergée d'un lien | Service de partage | Expiration choisie (5 min à 7 jours) ; révocation immédiate possible |
| Journaux locaux | Local | Non purgés automatiquement (désactivés par défaut) |

Tout étant local, les droits s'exercent sans intermédiaire : « exporter l'historique »
produit un JSON que vous lisez ou transmettez vous-même ; « tout supprimer » efface
l'historique ; « réinitialiser l'identité » crée une nouvelle empreinte et oublie les
appareils approuvés. Un transfert révèle votre adresse IP à votre interlocuteur : ne
l'utilisez pas pour des données que vous ne voudriez pas voir associées à votre réseau.

## 7. Partage hébergé (optionnel)

| Mode | Disponibilité | Comportement |
| --- | --- | --- |
| Direct (défaut) | Toujours | L'expéditeur reste connecté ; le destinataire reçoit en direct |
| Hébergé temporaire | Optionnel, désactivable | Copie **chiffrée avant l'envoi** sur le service configuré |

Contraintes : expiration effective (5 min à 7 jours, défaut 24 h), révocation côté
serveur, autorisation vérifiée, ≤ 512 Mio, ≤ 200 fichiers, ≤ 50 téléchargements, morceaux
de 1 Mio. La clé de déchiffrement n'est **jamais** envoyée au serveur : elle voyage dans
le fragment du lien.

Garde-fous, dans cet ordre : (1) limite de taille et de nombre de fichiers **avant**
l'upload ; (2) expiration obligatoire ; (3) révocation et suppression des objets expirés ;
(4) autorisation vérifiée (jeton par lien, pas de liste publique) ; (5) chiffrement côté
expéditeur ; (6) aucun dépassement automatique — un refus est renvoyé plutôt qu'un débit.

Si aucun service n'est configuré, l'application n'affiche pas l'option : elle ne promet
pas une fonction qu'elle ne peut pas tenir. **État actuel : aucun service d'hébergement
n'est configuré**, donc le mode hébergé est indisponible ; le transfert direct fonctionne
sans lui.

## 8. Plateformes : ce qui marche, où

| Domaine | État | Précision |
| --- | --- | --- |
| Moteur de transfert (chiffrement, reprise, vérification, file d'attente) | ✅ Implémenté et **testé** | 504 tests automatisés, 47 fichiers (§ 9) |
| Interface React/TypeScript partagée (FR/EN, thèmes) | ✅ Implémentée et **testée** au niveau du contrôleur et du rendu | `apps/web/src/entry.test.tsx`, `ui.test.tsx` |
| Écran d'entrée « Envoyer / Recevoir », moins d'options visibles | ✅ Implémenté et **testé** | `apps/web/src/screens/transfer.tsx`, cas « ouvre sur le choix » dans `ui.test.tsx` |
| Adresse du relais : un seul endroit décide, un réglage la change | ✅ Implémenté et **testé** | `apps/web/src/platform/signaling.ts` + `signaling.test.ts`, `packages/settings` (schéma 3) |
| Application web progressive installable | ✅ Implémentée et **testée** | installation, hors ligne, refus ; **pas encore essayée sur un téléphone réel** |
| Serveur de signalisation / relais aveugle | ✅ Implémenté et **testé** (Node) | salles, quotas, relais après accord des deux pairs |
| Application Windows (Tauri + Rust) | ⚠️ **Compilée et empaquetée** à chaque envoi, recompilée par la tâche `windows` de l'intégration continue | **jamais ouverte sur un vrai Windows** : c'est la seule chose que la chaîne ne peut pas faire |
| Installateur et désinstallateur Windows | ⚠️ **Corrigé en 0.1.2, pas encore essayé sur un poste réel** | 0.1.1 avait deux défauts (écran de démarrage bloqué, désinstallation refusée) ; correctifs : contrôle de secours dans la page + `DROPFORGE_RELEASE_MAIN_BINARY` — `tests/desktop-splash.test.ts`, `tests/nsis.test.ts` |
| Tests dans un vrai navigateur (E2E) | ✅ **Exécutés à chaque envoi** | Chromium, Firefox, WebKit (iPhone) ; octets reçus hachés et comparés |
| Tests sur appareils mobiles réels | ❌ Non exécutés | l'émulation de téléphone est couverte, un vrai iPhone/Android ne l'est pas |
| Liens de partage hébergés | ⚠️ Code client implémenté et testé ; **nécessite un hébergement** | désactivé proprement plutôt que facturé |

**Protocoles d'essai manuel** (ce que la chaîne ne peut pas faire, à faire une fois) :

- **Windows** : installer la dernière version → l'application s'ouvre sans écran bloqué →
  transférer un fichier vers un autre appareil → fermer la fenêtre (doit rester en zone de
  notification) → désinstaller depuis « Applications installées » (doit se lancer sans
  message d'« application en cours d'exécution ») → réinstaller.
- **Téléphone** : ouvrir l'adresse publiée en HTTPS → « Installer l'application » →
  rouvrir hors ligne → recevoir un fichier depuis un ordinateur.

Le pas-à-pas détaillé, avec ce qu'il faut observer à chaque étape, est dans
`npm run test:e2e` (bancs automatisés) et dans le § 7 du [`GUIDE.md`](GUIDE.md) pour la
réparation d'une installation Windows.

## 9. Tests

```bash
npm run verify           # tout ce que la chaîne exécute : types, contrôles, tests
npm test                 # 47 fichiers, 504 tests
npm run test:unit        # paquets métier, sans DOM
npm run test:integration # transferts réels en mémoire, sécurité, reprise
npm run check:desktop    # configuration Windows, icônes, hooks NSIS
npm run check:site       # la page publiée correspond à ses sources
npm run test:e2e         # navigateurs réels (jamais lancé par verify)
npm run test:e2e:install # installe Chromium, Firefox, WebKit

npm i --no-save werift   # facultatif : une pile WebRTC en TypeScript, sans binaire
npm run check:direct     # vérifie le chemin direct avec du vrai WebRTC (hors verify)
```

Total vérifié le 16 octobre 2026 : **504 tests, 47 fichiers**, tous au vert sur Linux ; la
même suite tourne sur **Windows** à chaque envoi (tâche `windows` de `ci.yml`), ce qui a
déjà fait apparaître deux défauts propres à Windows (scripts `.cmd` lancés sans shell,
chemins de test non portables).

### Ce qui est couvert, et par quoi

| Domaine | Fichier(s) | Ce que le test prouve |
| --- | --- | --- |
| Transfert de bout en bout (mémoire) | `tests/loopback-transfer.test.ts` | Un fichier traverse le moteur et **les octets reçus sont hachés et comparés** à la source |
| Sécurité | `tests/security-integration.test.ts` | Handshake authentifié, rejeu refusé, trame modifiée rejetée, identité changée = arrêt |
| Reprise | `tests/resume.test.ts` | Reprise adoptée seulement si le manifeste correspond ; plages re-hachées |
| File d'attente | `packages/transfer-engine/src/*.test.ts` | Pause, reprise, annulation, réessai (jamais un refus), réordonnancement |
| Relais | `apps/signaling/src/server.test.ts` | Salles, quotas, relais aveugle, expiration, accord à deux |
| Adresse du relais | `apps/web/src/platform/signaling.test.ts` | Rien n'est inventé sur un site publié ; `Aucun relais` ne contacte rien ; une adresse écrite est respectée |
| Réglages | `packages/settings/src/settings.test.ts` | Défauts privés, bornes, **migration 2 → 3** (l'adresse du relais arrive avec `Automatique`), adresse invalide refusée à l'écriture |
| Repli par relais, bout en bout | `tests/relay-fallback.test.ts` | Une tentative en mode relais **aboutit**, dans les deux sens |
| Chemin **direct** (WebRTC) | `scripts/check-direct-path.mts` (`npm run check:direct`) | Avec une vraie pile WebRTC (`werift`) et le **vrai** service de signalisation du dépôt : un code met les deux pairs en relation, la négociation aboutit, **les deux côtés obtiennent `webrtc`** (aucun repli), et 64 Kio traversent le canal intact dans les deux sens. Hors `verify` : la pile s'installe à la demande (`npm i --no-save werift`), pour ne pas alourdir la chaîne |
| Modèle de données | `packages/*/src/*.test.ts` | Migrations, invariants (`completed` sans `completedAt` = refus), révocation |
| Contrôleur d'application | `apps/web/src/app/controller.test.ts` | Chaque commande, chaque état publié, sans React |
| Entrée réelle de l'application | `apps/web/src/entry.test.tsx` | L'application démarre pour de vrai ; privée de WebCrypto, elle **dit ce qui manque** au lieu de rester blanche |
| Mode « même Wi‑Fi » et son certificat | `tests/lan-mode.test.ts` | Commande unique, deux processus arrêtés ensemble, proxy `/ws` des deux côtés, et le certificat jugé par une **vraie poignée de main TLS** (signature, dates, noms, usage serveur) ; réutilisation du certificat, renouvellement quand les adresses changent, clé en 0600, dossier non versionné |
| Écran de démarrage Windows | `tests/desktop-splash.test.ts` | Le contrôle de secours n'importe rien, écoute les erreurs, affiche la cause à 15 s, consigne via `report_problem` |
| Hooks de l'installateur | `tests/nsis.test.ts` | Macros insérées/définies, hooks que Tauri appelle réellement, exécutable écarté du chemin interrogé |
| Récupération Windows | `tests/windows-recovery.test.ts` | Le script de déblocage ne modifie rien sans `-Apply`, ne touche jamais aux fichiers reçus |
| Logo et icônes | `tests/icons.test.ts` | `.ico` du `.exe` (7 tailles), SVG identique à la description partagée, icône de la zone de notification |
| Publication | `tests/netlify.test.ts`, `tests/pages-site.test.ts` | Le dossier publié est celui de Vite, le service worker n'est jamais servi depuis un cache, la page publiée est autonome et correspond à ses sources |
| Paquets de publication | `tests/packaging.test.ts` | Écriture **et relecture** des ZIP (CRC, structure, refus d'une archive corrompue) |
| Configuration Windows | `tests/*.test.ts` + `scripts/check-desktop-config.mjs` | Permissions, plugins, cibles, icônes aux dimensions exactes |

### De bout en bout, dans de vrais navigateurs

Trois moteurs (Chromium, Firefox, WebKit en émulation iPhone) exécutent la vraie
application servie par son serveur de production, avec le vrai service de signalisation :
deux appareils se rencontrent, un fichier arrive **octet pour octet**, un refus est un
échec et non un succès, l'historique survit à un rechargement, l'application fonctionne
hors ligne, et Firefox reçoit par téléchargement puisqu'il n'a pas d'accès au disque. Une
panne est rapportée avec l'état de l'application, le journal du navigateur et le texte de
l'écran.

### Ce qui n'est PAS couvert (à ne pas confondre avec « testé »)

- **Un vrai Windows** : la chaîne compile, empaquette, vérifie la configuration ; elle
  n'ouvre pas la fenêtre à votre place.
- **Un vrai téléphone** : l'émulation est couverte, pas un appareil physique.
- **Un déploiement réel** : pas d'essai d'intrusion sur un relais exposé à Internet.
- **Les mises à jour signées** : le chemin est écrit et documenté, il n'est pas exercé
  faute de clés configurées.
- **La charge** : aucun test de dizaines de Go ni de milliers de fichiers simultanés.

## 10. État réel du projet

**DropForge n'est pas encore une 1.0, et ce document ne prétend pas le contraire.**
Version actuelle : **0.1.2** — application web, installateur Windows corrigé, serveur de
signalisation optionnel, 504 tests automatiques et une suite navigateur réelle.

| Exigence du cahier des charges | État | Où le vérifier |
| --- | --- | --- |
| Deux plateformes partageant une interface, PWA installable | ✅ | `apps/web`, `apps/desktop`, `e2e/` |
| Interface premium sombre (charbon + violet/bleu électrique), clair disponible | ✅ | `packages/design-system`, `docs` de thème dans le code |
| Transferts : chiffrement, reprise, vérification, file d'attente | ✅ | `packages/transfer-engine`, `tests/loopback-transfer.test.ts` |
| Connexions : local → direct → relais, sans jamais mentir sur le chemin | ✅ | `packages/connection-manager`, `tests/relay-fallback.test.ts` |
| Sécurité : aucun compte, pas de télémétrie, erreurs honnêtes | ✅ | § 5, § 6 de ce document |
| Données locales versionnées, migrations, suppression | ✅ | § 4, `packages/*/src/*.test.ts` |
| Machine à états des transferts, états terminaux stricts | ✅ | § 3, `packages/app-core` |
| Réglages complets, validés, bornés | ✅ | `packages/settings` + liste blanche |
| Architecture modulaire, ports, testabilité sans système | ✅ | § 1 |
| Tests obligatoires, jamais un « fait » sur la seule foi d'un écran | ✅ | § 9 |
| Infrastructure 100 % gratuite, aucune dépendance payante | ✅ | § 11 |
| Application Windows compilée et publiée à chaque version | ✅ | `.github/workflows/release.yml` |
| **Installateur/désinstallateur Windows essayés sur un poste réel** | ⚠️ | corrigé en 0.1.2, à confirmer sur un vrai Windows |
| **Mises à jour signées** | 🔒 | attend deux secrets (`GUIDE.md` § 9) |
| **Certificat d'éditeur (SmartScreen)** | 💰 | facultatif et payant |
| **Licence du projet** | 🔒 | décision du propriétaire ; sans fichier `LICENSE`, le code n'est pas réutilisable |
| **Hébergement des liens de partage** | ⚠️ | aucun service retenu : le mode hébergé est indisponible, le reste fonctionne |
| **Deux appareils sur le même Wi‑Fi** | ✅ | c'est le mode pris en charge et éprouvé de bout en bout : `npm run lan` (`GUIDE.md` § 4), rendez-vous vérifié à travers l'application elle-même |
| **Relais joignable en ligne** | 🗺️ **Feuille de route** | hors du périmètre assumé pour l'instant : l'application publiée n'invente plus d'adresse (corrigé) et n'essaie plus rien ; le code du relais existe et reste testé (`tests/relay-fallback.test.ts`), mais deux appareils de **réseaux différents** ne sont pas promis avant qu'un relais public soit retenu |
| **Essais sur appareils mobiles réels** | ❌ | émulation couverte, appareil physique non |

### Feuille de route

Ce qui est **hors périmètre pour l'instant**, et assumé comme tel :

| Sujet | État | Ce qu'il faudrait |
| --- | --- | --- |
| Deux appareils sur des réseaux différents | 🗺️ | une adresse de relais publique (le code du relais existe et reste testé) |
| Liens de partage hébergés (fichier stocké, expirable) | 🗺️ | un service de stockage retenu — aucun ne l'est |
| Mises à jour signées de l'application Windows | 🔒 | deux secrets de signature (action propriétaire) |
| Essais sur un vrai téléphone et un vrai Windows | ⚠️ | un essai humain, décrit pas à pas dans `TECHNIQUE.md` § 9 |

Ce que la feuille de route **change dans le produit aujourd'hui** : les écrans ne
promettent plus que ce qui marche (deux appareils du même Wi‑Fi) et ne parlent plus des
méthodes éloignées. Rien n'a été supprimé du code : le relais, les liens hébergés et le
repli restent implémentés, documentés et testés, prêts à être branchés — ils ne sont
simplement plus annoncés.

### Décisions d'interface, et la règle qui les explique

Les écrans suivent la **loi de Hick** : plus un écran propose de choix, plus chacun
demande de temps. Trois conséquences, vérifiables dans le code et dans les tests :

1. **une seule action principale par état d'écran**, et c'est la seule à porter le style
   principal (`df-button--lead`, `df-choice--primary`) ;
2. **les options rares attendent** dans un dépliant (« Options », « Avancé ») : rien
   n'est caché, tout est à un clic, mais rien ne se lit par défaut ;
3. **ce qui ne sert pas n'est pas affiché** : la file d'attente n'existe que si un
   transfert existe, « Envoyer vers » n'apparaît que si un appareil est joignable,
   « Vider la sélection » que si quelque chose est sélectionné.

L'écran d'entrée porte la seule entorse assumée, et elle est volontaire : **Envoyer**
et **Recevoir** y sont deux, parce que ce sont deux gestes différents — mais ils ne sont
pas présentés au même poids (carte principale contre carte discrète).

Ce qui manque pour une 1.0 honnête : **un essai humain sur un vrai Windows** (installation,
lancement, transfert local, désinstallation), **les mises à jour signées** (deux secrets),
**la licence**, **un service d'hébergement** si le partage par lien doit exister (ou
l'acceptation explicite de son absence), **une adresse de relais joignable** pour que deux
appareils de réseaux différents se trouvent sans réglage, et **des essais sur appareils
mobiles réels**.

## 11. Infrastructure 100 % gratuite

Vérifié le 13 octobre 2026 auprès des sources citées. Les offres gratuites changent :
revérifiez avant de vous engager.

**Ce qui fonctionne sans aucun serveur** : le transfert entre deux appareils du même
réseau local — y compris la mise en relation, puisque `npm run lan` la sert depuis la
machine qui sert aussi l'application. Aucun compte, aucun service tiers, aucune carte
bancaire. La mise en relation entre réseaux différents et le transfert direct par
Internet, eux, demandent un relais : accessoire par conception, puisque sa disparition ne
casse pas le mode local. Si tout le reste disparaît, DropForge continue de fonctionner
chez soi.

| Besoin | Option gratuite | Limite honnête |
| --- | --- | --- |
| Relais / signalisation | le serveur du dépôt sur une machine à vous, ou Cloudflare Workers + Durable Objects | quota journalier ; un rapport communautaire d'octobre 2026 signale une application du quota WebSocket plus stricte qu'annoncée — d'où la conception : le relais est un **accessoire**, sa disparition ne casse ni le local ni le direct |
| Traverser un NAT strict (TURN) | Cloudflare Realtime TURN : 1 000 Go/mois, puis 0,05 $/Go | palier **partagé** avec le service SFU et **carte bancaire requise** à l'activation → TURN n'est ni requis ni activé par défaut |
| Héberger la PWA | Cloudflare Pages (bande passante non mesurée), GitHub Pages, **Netlify** (`netlify.toml` fourni), Vercel | Netlify et Vercel : bande passante mensuelle bornée ; GitHub Pages : pas d'en-têtes personnalisés ni de WebSocket |
| Liens hébergés (optionnel) | Cloudflare R2 : 10 Go/mois, egress gratuit | activation avec moyen de paiement → plafonds **côté application** (512 Mio, 50 téléchargements) pour refuser avant tout dépassement facturable |
| Publication automatisée | GitHub Actions | gratuit pour un dépôt public, aucune carte bancaire |
| Mises à jour signées | signature Tauri (paire Ed25519) | gratuite ; indépendante de la signature de code Windows |
| Signature de code Windows | certificat OV/EV | **le seul poste de coût réel du projet**, facultatif (un exécutable non signé s'installe avec un avertissement) |
| Certificat TLS pour le réseau local | certificat auto-signé fabriqué par `npm run lan` | gratuit et immédiat ; le navigateur affiche un avertissement à accepter une fois par appareil (voir ci-dessous) |
| Certificat TLS sans avertissement | un **nom de domaine** que vous possédez, pointant vers l'adresse privée, et un certificat Let's Encrypt obtenu par validation DNS-01 | gratuit, mais demande de posséder un domaine et de créer un enregistrement DNS : ce n'est pas quelque chose qu'un script peut faire à votre place |

**Pourquoi le réseau local a besoin de TLS.** `crypto.subtle` — le chiffrement de
DropForge — n'est fourni par les navigateurs que dans un **contexte sécurisé** :
`https://`, `http://localhost`, `http://127.0.0.1`, et rien d'autre. Une adresse privée en
clair (`http://192.168.1.24`) n'en est pas un, dans aucun des trois grands moteurs. Le
mode « deux appareils sur le même Wi‑Fi » sert donc en HTTPS, avec un certificat
fabriqué localement (`scripts/lib/self-signed.mjs`, vérifié par une vraie poignée de
main TLS dans `tests/lan-mode.test.ts`). Ce certificat **chiffre** sans **prouver**
d'identité — c'est assumé, et sans conséquence sur les garanties du produit :
l'identité vient du code à comparer affiché des deux côtés, et le contenu est scellé par
les clés des deux appareils, pas par le TLS.

**Le STUN, lui, n'est pas un défaut.** Aucun serveur ICE n'est configuré par défaut :
c'est une décision, pas un oubli. Un serveur STUN public apprend l'adresse de l'appareil
et le moment où il se connecte — exactement le tiers que ce produit existe pour éviter —
et l'imposer rendrait chaque tentative dépendante d'un tiers joignable. Sur le réseau
local, les deux appareils se trouvent directement, sans aucun serveur. Un déploiement
qui doit traverser des NAT en configure un explicitement (`VITE_ICE_URLS`), et le dit
alors à ses utilisateurs.

## 12. Annexes générées

Ces deux annexes sont **écrites par des scripts**, jamais à la main : elles décrivent ce
qui sera réellement installé par `npm ci`, lu depuis `package-lock.json`. Une liste
recopiée à la main deviendrait fausse au premier changement de dépendance.

**Annexe A — inventaire des dépendances** (`node scripts/list-dependencies.mjs`)

<!-- DEPENDANCES:START -->
### Inventaire des dépendances

> Document **généré** : `node scripts/list-dependencies.mjs`. Ne pas modifier à la main.

Ce document décrit **ce qui sera réellement installé** par `npm ci`, lu depuis
`package-lock.json` : dépendances directes, dépendances transitives, versions et
licences. Les licences des dépendances directes sont détaillées dans l'annexe B de ce
même document ; ici, la question posée est différente : que contient l'installation, et
y a-t-il quelque chose de problématique dedans ?

#### Résumé

| Mesure | Valeur |
| --- | --- |
| Dépendances directes | 30 |
| Dépendances transitives | 498 |
| Total installé | 528 |
| Licences distinctes | 11 |
| Licences copyleft fortes détectées | aucune |

Les paquets internes (`@dropforge/*`) ne figurent pas ici : ce sont des sources
TypeScript du dépôt, reliées par des alias, jamais publiées ni installées.

#### Licences, par nombre de paquets

| Licence | Paquets |
| --- | --- |
| (MIT OR CC0-1.0) | 1 |
| Apache-2.0 | 32 |
| Apache-2.0 OR MIT | 13 |
| BlueOak-1.0.0 | 8 |
| BSD-2-Clause | 5 |
| BSD-3-Clause | 5 |
| CC-BY-4.0 | 1 |
| ISC | 21 |
| MIT | 424 |
| MIT OR Apache-2.0 | 6 |
| MPL-2.0 | 12 |

#### Licences qui demandent quelque chose

##### copyleft au niveau du fichier — 12 paquet(s)

Réutiliser le paquet tel quel n'impose rien. Modifier ses fichiers **et** redistribuer le résultat oblige à publier ces fichiers modifiés sous la même licence. Aucun paquet MPL n'est modifié par DropForge.

Paquets : `lightningcss`, `lightningcss-android-arm64`, `lightningcss-darwin-arm64`, `lightningcss-darwin-x64`, `lightningcss-freebsd-x64`, `lightningcss-linux-arm-gnueabihf`, `lightningcss-linux-arm64-gnu`, `lightningcss-linux-arm64-musl`, `lightningcss-linux-x64-gnu`, `lightningcss-linux-x64-musl`, `lightningcss-win32-arm64-msvc`, `lightningcss-win32-x64-msvc`

##### attribution — 1 paquet(s)

Utilisation libre, y compris commerciale, à condition de citer la source. Concerne ici des données (compatibilité des navigateurs), pas du code exécuté.

Paquets : `caniuse-lite`

##### domaine public — 1 paquet(s)

Aucune obligation : la licence la plus permissive possible.

Paquets : `type-fest`

#### Dépendances directes

| Paquet | Version | Licence | Déclaré par |
| --- | --- | --- | --- |
| `@noble/hashes` | 2.4.0 | MIT | packages/protocol/package.json (dependencies, ^2.4.0) |
| `@playwright/test` | 1.64.0 | Apache-2.0 | package.json (devDependencies, ^1.64.0) |
| `@tauri-apps/api` | 2.12.3 | Apache-2.0 OR MIT | apps/desktop/package.json (dependencies, ^2.12.3) |
| `@tauri-apps/cli` | 2.12.2 | Apache-2.0 OR MIT | apps/desktop/package.json (devDependencies, ^2.12.2) |
| `@tauri-apps/plugin-dialog` | 2.8.2 | MIT OR Apache-2.0 | apps/desktop/package.json (dependencies, ^2.8.2) |
| `@tauri-apps/plugin-fs` | 2.7.0 | MIT OR Apache-2.0 | apps/desktop/package.json (dependencies, ^2.7.0) |
| `@tauri-apps/plugin-notification` | 2.6.0 | MIT OR Apache-2.0 | apps/desktop/package.json (dependencies, ^2.6.0) |
| `@tauri-apps/plugin-process` | 2.4.0 | MIT OR Apache-2.0 | apps/desktop/package.json (dependencies, ^2.4.0) |
| `@tauri-apps/plugin-sql` | 2.5.0 | MIT OR Apache-2.0 | apps/desktop/package.json (dependencies, ^2.5.0) |
| `@tauri-apps/plugin-updater` | 2.13.3 | MIT OR Apache-2.0 | apps/desktop/package.json (dependencies, ^2.13.3) |
| `@types/node` | 26.6.5 | MIT | package.json (devDependencies, ^26.6.5) ; apps/signaling/package.json (devDependencies, ^26.6.5) |
| `@types/qrcode` | 1.5.6 | MIT | apps/web/package.json (devDependencies, ^1.5.6) |
| `@types/react` | 19.3.0 | MIT | apps/web/package.json (devDependencies, ^19.3.0) ; apps/desktop/package.json (devDependencies, ^19.3.0) ; packages/design-system/package.json (devDependencies, ^19.3.0) |
| `@types/react-dom` | 19.3.0 | MIT | apps/web/package.json (devDependencies, ^19.3.0) ; apps/desktop/package.json (devDependencies, ^19.3.0) |
| `@types/ws` | 8.18.2 | MIT | apps/signaling/package.json (devDependencies, ^8.18.2) |
| `@vitejs/plugin-react` | 6.1.2 | MIT | apps/web/package.json (devDependencies, ^6.1.2) ; apps/desktop/package.json (devDependencies, ^6.1.2) |
| `fake-indexeddb` | 6.2.5 | Apache-2.0 | package.json (devDependencies, ^6.2.5) |
| `happy-dom` | 21.0.1 | MIT | package.json (devDependencies, ^21.0.1) |
| `i18next` | 26.4.4 | MIT | apps/web/package.json (dependencies, ^26.4.4) |
| `qrcode` | 1.5.4 | MIT | apps/web/package.json (dependencies, ^1.5.4) |
| `react` | 19.3.0 | MIT | apps/web/package.json (dependencies, ^19.3.0) ; apps/desktop/package.json (dependencies, ^19.3.0) ; packages/design-system/package.json (devDependencies, ^19.3.0) |
| `react-dom` | 19.3.0 | MIT | apps/web/package.json (dependencies, ^19.3.0) ; apps/desktop/package.json (dependencies, ^19.3.0) |
| `react-i18next` | 17.0.16 | MIT | apps/web/package.json (dependencies, ^17.0.16) |
| `tsx` | 4.23.15 | MIT | package.json (devDependencies, ^4.23.15) ; apps/signaling/package.json (devDependencies, ^4.23.15) |
| `typescript` | 7.0.2 | Apache-2.0 | package.json (devDependencies, ^7.0.2) |
| `vite` | 8.3.4 | MIT | apps/web/package.json (devDependencies, ^8.3.4) ; apps/desktop/package.json (devDependencies, ^8.3.4) ; apps/signaling/package.json (devDependencies, ^8.3.4) |
| `vite-plugin-pwa` | 2.0.0 | MIT | apps/web/package.json (devDependencies, ^2.0.0) |
| `vitest` | 5.0.4 | MIT | package.json (devDependencies, ^5.0.4) |
| `ws` | 8.22.0 | MIT | apps/signaling/package.json (dependencies, ^8.22.0) |
| `zod` | 4.6.6 | MIT | packages/protocol/package.json (dependencies, ^4.6.6) |

#### Dépendances transitives

Ces paquets ne sont pas choisis directement : ils viennent des précédents. Ils sont
listés parce qu'ils font partie de l'installation et que leur licence compte autant.

| Paquet | Version | Licence | Déclaré par |
| --- | --- | --- | --- |
| `@apideck/better-ajv-errors` | 0.3.7 | MIT | — |
| `@babel/code-frame` | 7.29.7 | MIT | — |
| `@babel/compat-data` | 7.29.7 | MIT | — |
| `@babel/core` | 7.29.7 | MIT | — |
| `@babel/generator` | 7.29.8 | MIT | — |
| `@babel/helper-annotate-as-pure` | 7.29.7 | MIT | — |
| `@babel/helper-compilation-targets` | 7.29.7 | MIT | — |
| `@babel/helper-create-class-features-plugin` | 7.29.7 | MIT | — |
| `@babel/helper-create-regexp-features-plugin` | 7.29.10 | MIT | — |
| `@babel/helper-define-polyfill-provider` | 0.6.8 | MIT | — |
| `@babel/helper-globals` | 7.29.7 | MIT | — |
| `@babel/helper-member-expression-to-functions` | 7.29.7 | MIT | — |
| `@babel/helper-module-imports` | 7.29.7 | MIT | — |
| `@babel/helper-module-transforms` | 7.29.7 | MIT | — |
| `@babel/helper-optimise-call-expression` | 7.29.7 | MIT | — |
| `@babel/helper-plugin-utils` | 7.29.7 | MIT | — |
| `@babel/helper-remap-async-to-generator` | 7.29.7 | MIT | — |
| `@babel/helper-replace-supers` | 7.29.7 | MIT | — |
| `@babel/helper-skip-transparent-expression-wrappers` | 7.29.7 | MIT | — |
| `@babel/helper-string-parser` | 7.29.7 | MIT | — |
| `@babel/helper-validator-identifier` | 7.29.7 | MIT | — |
| `@babel/helper-validator-option` | 7.29.7 | MIT | — |
| `@babel/helper-wrap-function` | 7.29.7 | MIT | — |
| `@babel/helpers` | 7.29.10 | MIT | — |
| `@babel/parser` | 7.29.9 | MIT | — |
| `@babel/plugin-bugfix-firefox-class-in-computed-class-key` | 7.29.7 | MIT | — |
| `@babel/plugin-bugfix-safari-class-field-initializer-scope` | 7.29.7 | MIT | — |
| `@babel/plugin-bugfix-safari-id-destructuring-collision-in-function-expression` | 7.29.7 | MIT | — |
| `@babel/plugin-bugfix-safari-rest-destructuring-rhs-array` | 7.29.7 | MIT | — |
| `@babel/plugin-bugfix-v8-spread-parameters-in-optional-chaining` | 7.29.7 | MIT | — |
| `@babel/plugin-bugfix-v8-static-class-fields-redefine-readonly` | 7.29.7 | MIT | — |
| `@babel/plugin-proposal-private-property-in-object` | 7.21.0-placeholder-for-preset-env.2 | MIT | — |
| `@babel/plugin-syntax-import-assertions` | 7.29.7 | MIT | — |
| `@babel/plugin-syntax-import-attributes` | 7.29.7 | MIT | — |
| `@babel/plugin-syntax-unicode-sets-regex` | 7.18.6 | MIT | — |
| `@babel/plugin-transform-arrow-functions` | 7.29.7 | MIT | — |
| `@babel/plugin-transform-async-generator-functions` | 7.29.7 | MIT | — |
| `@babel/plugin-transform-async-to-generator` | 7.29.7 | MIT | — |
| `@babel/plugin-transform-block-scoped-functions` | 7.29.7 | MIT | — |
| `@babel/plugin-transform-block-scoping` | 7.29.7 | MIT | — |
| `@babel/plugin-transform-class-properties` | 7.29.7 | MIT | — |
| `@babel/plugin-transform-class-static-block` | 7.29.7 | MIT | — |
| `@babel/plugin-transform-classes` | 7.29.7 | MIT | — |
| `@babel/plugin-transform-computed-properties` | 7.29.7 | MIT | — |
| `@babel/plugin-transform-destructuring` | 7.29.7 | MIT | — |
| `@babel/plugin-transform-dotall-regex` | 7.29.7 | MIT | — |
| `@babel/plugin-transform-duplicate-keys` | 7.29.7 | MIT | — |
| `@babel/plugin-transform-duplicate-named-capturing-groups-regex` | 7.29.7 | MIT | — |
| `@babel/plugin-transform-dynamic-import` | 7.29.7 | MIT | — |
| `@babel/plugin-transform-explicit-resource-management` | 7.29.7 | MIT | — |
| `@babel/plugin-transform-exponentiation-operator` | 7.29.7 | MIT | — |
| `@babel/plugin-transform-export-namespace-from` | 7.29.7 | MIT | — |
| `@babel/plugin-transform-for-of` | 7.29.7 | MIT | — |
| `@babel/plugin-transform-function-name` | 7.29.7 | MIT | — |
| `@babel/plugin-transform-json-strings` | 7.29.7 | MIT | — |
| `@babel/plugin-transform-literals` | 7.29.7 | MIT | — |
| `@babel/plugin-transform-logical-assignment-operators` | 7.29.7 | MIT | — |
| `@babel/plugin-transform-member-expression-literals` | 7.29.7 | MIT | — |
| `@babel/plugin-transform-modules-amd` | 7.29.7 | MIT | — |
| `@babel/plugin-transform-modules-commonjs` | 7.29.7 | MIT | — |
| `@babel/plugin-transform-modules-systemjs` | 7.29.8 | MIT | — |
| `@babel/plugin-transform-modules-umd` | 7.29.7 | MIT | — |
| `@babel/plugin-transform-named-capturing-groups-regex` | 7.29.7 | MIT | — |
| `@babel/plugin-transform-new-target` | 7.29.7 | MIT | — |
| `@babel/plugin-transform-nullish-coalescing-operator` | 7.29.7 | MIT | — |
| `@babel/plugin-transform-numeric-separator` | 7.29.7 | MIT | — |
| `@babel/plugin-transform-object-rest-spread` | 7.29.7 | MIT | — |
| `@babel/plugin-transform-object-super` | 7.29.7 | MIT | — |
| `@babel/plugin-transform-optional-catch-binding` | 7.29.7 | MIT | — |
| `@babel/plugin-transform-optional-chaining` | 7.29.7 | MIT | — |
| `@babel/plugin-transform-parameters` | 7.29.7 | MIT | — |
| `@babel/plugin-transform-private-methods` | 7.29.7 | MIT | — |
| `@babel/plugin-transform-private-property-in-object` | 7.29.7 | MIT | — |
| `@babel/plugin-transform-property-literals` | 7.29.7 | MIT | — |
| `@babel/plugin-transform-regenerator` | 7.29.8 | MIT | — |
| `@babel/plugin-transform-regexp-modifiers` | 7.29.7 | MIT | — |
| `@babel/plugin-transform-reserved-words` | 7.29.7 | MIT | — |
| `@babel/plugin-transform-shorthand-properties` | 7.29.7 | MIT | — |
| `@babel/plugin-transform-spread` | 7.29.8 | MIT | — |
| `@babel/plugin-transform-sticky-regex` | 7.29.7 | MIT | — |
| `@babel/plugin-transform-template-literals` | 7.29.7 | MIT | — |
| `@babel/plugin-transform-typeof-symbol` | 7.29.7 | MIT | — |
| `@babel/plugin-transform-unicode-escapes` | 7.29.7 | MIT | — |
| `@babel/plugin-transform-unicode-property-regex` | 7.29.7 | MIT | — |
| `@babel/plugin-transform-unicode-regex` | 7.29.7 | MIT | — |
| `@babel/plugin-transform-unicode-sets-regex` | 7.29.7 | MIT | — |
| `@babel/preset-env` | 7.29.7 | MIT | — |
| `@babel/preset-modules` | 0.1.6-no-external-plugins | MIT | — |
| `@babel/runtime` | 7.29.10 | MIT | — |
| `@babel/template` | 7.29.7 | MIT | — |
| `@babel/traverse` | 7.29.10 | MIT | — |
| `@babel/types` | 7.29.8 | MIT | — |
| `@esbuild/aix-ppc64` | 0.28.2 | MIT | — |
| `@esbuild/android-arm` | 0.28.2 | MIT | — |
| `@esbuild/android-arm64` | 0.28.2 | MIT | — |
| `@esbuild/android-x64` | 0.28.2 | MIT | — |
| `@esbuild/darwin-arm64` | 0.28.2 | MIT | — |
| `@esbuild/darwin-x64` | 0.28.2 | MIT | — |
| `@esbuild/freebsd-arm64` | 0.28.2 | MIT | — |
| `@esbuild/freebsd-x64` | 0.28.2 | MIT | — |
| `@esbuild/linux-arm` | 0.28.2 | MIT | — |
| `@esbuild/linux-arm64` | 0.28.2 | MIT | — |
| `@esbuild/linux-ia32` | 0.28.2 | MIT | — |
| `@esbuild/linux-loong64` | 0.28.2 | MIT | — |
| `@esbuild/linux-mips64el` | 0.28.2 | MIT | — |
| `@esbuild/linux-ppc64` | 0.28.2 | MIT | — |
| `@esbuild/linux-riscv64` | 0.28.2 | MIT | — |
| `@esbuild/linux-s390x` | 0.28.2 | MIT | — |
| `@esbuild/linux-x64` | 0.28.2 | MIT | — |
| `@esbuild/netbsd-arm64` | 0.28.2 | MIT | — |
| `@esbuild/netbsd-x64` | 0.28.2 | MIT | — |
| `@esbuild/openbsd-arm64` | 0.28.2 | MIT | — |
| `@esbuild/openbsd-x64` | 0.28.2 | MIT | — |
| `@esbuild/openharmony-arm64` | 0.28.2 | MIT | — |
| `@esbuild/sunos-x64` | 0.28.2 | MIT | — |
| `@esbuild/win32-arm64` | 0.28.2 | MIT | — |
| `@esbuild/win32-ia32` | 0.28.2 | MIT | — |
| `@esbuild/win32-x64` | 0.28.2 | MIT | — |
| `@isaacs/cliui` | 9.0.0 | BlueOak-1.0.0 | — |
| `@jridgewell/gen-mapping` | 0.3.13 | MIT | — |
| `@jridgewell/remapping` | 2.3.5 | MIT | — |
| `@jridgewell/resolve-uri` | 3.1.2 | MIT | — |
| `@jridgewell/source-map` | 0.3.11 | MIT | — |
| `@jridgewell/sourcemap-codec` | 1.6.0 | MIT | — |
| `@jridgewell/trace-mapping` | 0.3.31 | MIT | — |
| `@napi-rs/lzma-linux-x64-gnu` | 1.5.1 | MIT | — |
| `@oxc-project/types` | 0.153.0 | MIT | — |
| `@rolldown/binding-android-arm-eabi` | 1.2.13 | MIT | — |
| `@rolldown/binding-android-arm64` | 1.2.13 | MIT | — |
| `@rolldown/binding-darwin-arm64` | 1.2.13 | MIT | — |
| `@rolldown/binding-darwin-x64` | 1.2.13 | MIT | — |
| `@rolldown/binding-freebsd-x64` | 1.2.13 | MIT | — |
| `@rolldown/binding-linux-arm-gnueabihf` | 1.2.13 | MIT | — |
| `@rolldown/binding-linux-arm64-gnu` | 1.2.13 | MIT | — |
| `@rolldown/binding-linux-arm64-musl` | 1.2.13 | MIT | — |
| `@rolldown/binding-linux-ppc64-gnu` | 1.2.13 | MIT | — |
| `@rolldown/binding-linux-s390x-gnu` | 1.2.13 | MIT | — |
| `@rolldown/binding-linux-x64-gnu` | 1.2.13 | MIT | — |
| `@rolldown/binding-linux-x64-musl` | 1.2.13 | MIT | — |
| `@rolldown/binding-openharmony-arm64` | 1.2.13 | MIT | — |
| `@rolldown/binding-win32-arm64-msvc` | 1.2.13 | MIT | — |
| `@rolldown/binding-win32-x64-msvc` | 1.2.13 | MIT | — |
| `@rolldown/pluginutils` | 1.0.1 | MIT | — |
| `@rollup/plugin-babel` | 6.1.0 | MIT | — |
| `@rollup/plugin-node-resolve` | 16.0.3 | MIT | — |
| `@rollup/plugin-replace` | 6.0.3 | MIT | — |
| `@rollup/plugin-terser` | 1.0.0 | MIT | — |
| `@rollup/pluginutils` | 5.4.0 | MIT | — |
| `@rollup/rollup-android-arm-eabi` | 4.64.5 | MIT | — |
| `@rollup/rollup-android-arm64` | 4.64.5 | MIT | — |
| `@rollup/rollup-darwin-arm64` | 4.64.5 | MIT | — |
| `@rollup/rollup-darwin-x64` | 4.64.5 | MIT | — |
| `@rollup/rollup-freebsd-arm64` | 4.64.5 | MIT | — |
| `@rollup/rollup-freebsd-x64` | 4.64.5 | MIT | — |
| `@rollup/rollup-linux-arm-gnueabihf` | 4.64.5 | MIT | — |
| `@rollup/rollup-linux-arm-musleabihf` | 4.64.5 | MIT | — |
| `@rollup/rollup-linux-arm64-gnu` | 4.64.5 | MIT | — |
| `@rollup/rollup-linux-arm64-musl` | 4.64.5 | MIT | — |
| `@rollup/rollup-linux-loong64-gnu` | 4.64.5 | MIT | — |
| `@rollup/rollup-linux-loong64-musl` | 4.64.5 | MIT | — |
| `@rollup/rollup-linux-ppc64-gnu` | 4.64.5 | MIT | — |
| `@rollup/rollup-linux-ppc64-musl` | 4.64.5 | MIT | — |
| `@rollup/rollup-linux-riscv64-gnu` | 4.64.5 | MIT | — |
| `@rollup/rollup-linux-riscv64-musl` | 4.64.5 | MIT | — |
| `@rollup/rollup-linux-s390x-gnu` | 4.64.5 | MIT | — |
| `@rollup/rollup-linux-x64-gnu` | 4.64.5 | MIT | — |
| `@rollup/rollup-linux-x64-musl` | 4.64.5 | MIT | — |
| `@rollup/rollup-openbsd-x64` | 4.64.5 | MIT | — |
| `@rollup/rollup-openharmony-arm64` | 4.64.5 | MIT | — |
| `@rollup/rollup-win32-arm64-msvc` | 4.64.5 | MIT | — |
| `@rollup/rollup-win32-ia32-msvc` | 4.64.5 | MIT | — |
| `@rollup/rollup-win32-x64-gnu` | 4.64.5 | MIT | — |
| `@rollup/rollup-win32-x64-msvc` | 4.64.5 | MIT | — |
| `@tauri-apps/cli-darwin-arm64` | 2.12.2 | Apache-2.0 OR MIT | — |
| `@tauri-apps/cli-darwin-x64` | 2.12.2 | Apache-2.0 OR MIT | — |
| `@tauri-apps/cli-linux-arm-gnueabihf` | 2.12.2 | Apache-2.0 OR MIT | — |
| `@tauri-apps/cli-linux-arm64-gnu` | 2.12.2 | Apache-2.0 OR MIT | — |
| `@tauri-apps/cli-linux-arm64-musl` | 2.12.2 | Apache-2.0 OR MIT | — |
| `@tauri-apps/cli-linux-riscv64-gnu` | 2.12.2 | Apache-2.0 OR MIT | — |
| `@tauri-apps/cli-linux-x64-gnu` | 2.12.2 | Apache-2.0 OR MIT | — |
| `@tauri-apps/cli-linux-x64-musl` | 2.12.2 | Apache-2.0 OR MIT | — |
| `@tauri-apps/cli-win32-arm64-msvc` | 2.12.2 | Apache-2.0 OR MIT | — |
| `@tauri-apps/cli-win32-ia32-msvc` | 2.12.2 | Apache-2.0 OR MIT | — |
| `@tauri-apps/cli-win32-x64-msvc` | 2.12.2 | Apache-2.0 OR MIT | — |
| `@trickfilm400/rollup-plugin-off-main-thread` | 3.0.0-pre1 | Apache-2.0 | — |
| `@types/chai` | 5.2.3 | MIT | — |
| `@types/deep-eql` | 4.0.2 | MIT | — |
| `@types/estree` | 1.0.9 | MIT | — |
| `@types/resolve` | 1.20.2 | MIT | — |
| `@types/trusted-types` | 2.0.7 | MIT | — |
| `@types/whatwg-mimetype` | 3.0.2 | MIT | — |
| `@typescript/typescript-aix-ppc64` | 7.0.2 | Apache-2.0 | — |
| `@typescript/typescript-darwin-arm64` | 7.0.2 | Apache-2.0 | — |
| `@typescript/typescript-darwin-x64` | 7.0.2 | Apache-2.0 | — |
| `@typescript/typescript-freebsd-arm64` | 7.0.2 | Apache-2.0 | — |
| `@typescript/typescript-freebsd-x64` | 7.0.2 | Apache-2.0 | — |
| `@typescript/typescript-linux-arm` | 7.0.2 | Apache-2.0 | — |
| `@typescript/typescript-linux-arm64` | 7.0.2 | Apache-2.0 | — |
| `@typescript/typescript-linux-loong64` | 7.0.2 | Apache-2.0 | — |
| `@typescript/typescript-linux-mips64el` | 7.0.2 | Apache-2.0 | — |
| `@typescript/typescript-linux-ppc64` | 7.0.2 | Apache-2.0 | — |
| `@typescript/typescript-linux-riscv64` | 7.0.2 | Apache-2.0 | — |
| `@typescript/typescript-linux-s390x` | 7.0.2 | Apache-2.0 | — |
| `@typescript/typescript-linux-x64` | 7.0.2 | Apache-2.0 | — |
| `@typescript/typescript-netbsd-arm64` | 7.0.2 | Apache-2.0 | — |
| `@typescript/typescript-netbsd-x64` | 7.0.2 | Apache-2.0 | — |
| `@typescript/typescript-openbsd-arm64` | 7.0.2 | Apache-2.0 | — |
| `@typescript/typescript-openbsd-x64` | 7.0.2 | Apache-2.0 | — |
| `@typescript/typescript-sunos-x64` | 7.0.2 | Apache-2.0 | — |
| `@typescript/typescript-win32-arm64` | 7.0.2 | Apache-2.0 | — |
| `@typescript/typescript-win32-x64` | 7.0.2 | Apache-2.0 | — |
| `@vitest/mocker` | 5.0.4 | MIT | — |
| `@vitest/spy` | 5.0.4 | MIT | — |
| `acorn` | 8.19.0 | MIT | — |
| `ajv` | 8.20.0 | MIT | — |
| `ansi-regex` | 5.0.1 | MIT | — |
| `ansi-styles` | 4.3.0 | MIT | — |
| `array-buffer-byte-length` | 1.0.2 | MIT | — |
| `arraybuffer.prototype.slice` | 1.0.4 | MIT | — |
| `assertion-error` | 2.0.1 | MIT | — |
| `async` | 3.2.6 | MIT | — |
| `async-function` | 1.0.0 | MIT | — |
| `at-least-node` | 1.0.0 | ISC | — |
| `available-typed-arrays` | 1.0.7 | MIT | — |
| `babel-plugin-polyfill-corejs2` | 0.4.17 | MIT | — |
| `babel-plugin-polyfill-corejs3` | 0.14.2 | MIT | — |
| `babel-plugin-polyfill-regenerator` | 0.6.8 | MIT | — |
| `balanced-match` | 4.0.4 | MIT | — |
| `balanced-match` | 1.0.2 | MIT | — |
| `baseline-browser-mapping` | 2.11.28 | Apache-2.0 | — |
| `brace-expansion` | 5.0.12 | MIT | — |
| `brace-expansion` | 2.1.7 | MIT | — |
| `browserslist` | 4.29.3 | MIT | — |
| `buffer-from` | 1.1.2 | MIT | — |
| `buffer-image-size` | 0.6.4 | MIT | — |
| `call-bind` | 1.0.9 | MIT | — |
| `call-bind-apply-helpers` | 1.0.2 | MIT | — |
| `call-bound` | 1.0.4 | MIT | — |
| `camelcase` | 5.3.1 | MIT | — |
| `caniuse-lite` | 1.0.30001815 | CC-BY-4.0 | — |
| `chai` | 6.3.0 | MIT | — |
| `cliui` | 6.0.0 | ISC | — |
| `color-convert` | 2.0.1 | MIT | — |
| `color-name` | 1.1.4 | MIT | — |
| `commander` | 2.20.3 | MIT | — |
| `common-tags` | 1.8.2 | MIT | — |
| `convert-source-map` | 2.0.0 | MIT | — |
| `core-js-compat` | 3.50.0 | MIT | — |
| `cross-spawn` | 7.0.6 | MIT | — |
| `crypto-random-string` | 2.0.0 | MIT | — |
| `csstype` | 3.2.3 | MIT | — |
| `data-view-buffer` | 1.0.2 | MIT | — |
| `data-view-byte-length` | 1.0.2 | MIT | — |
| `data-view-byte-offset` | 1.0.1 | MIT | — |
| `debug` | 4.4.3 | MIT | — |
| `decamelize` | 1.2.0 | MIT | — |
| `deepmerge` | 4.3.1 | MIT | — |
| `define-data-property` | 1.1.4 | MIT | — |
| `define-properties` | 1.2.1 | MIT | — |
| `detect-libc` | 2.1.2 | Apache-2.0 | — |
| `dijkstrajs` | 1.0.3 | MIT | — |
| `dunder-proto` | 1.0.1 | MIT | — |
| `ejs` | 3.1.10 | Apache-2.0 | — |
| `electron-to-chromium` | 1.5.452 | ISC | — |
| `emoji-regex` | 8.0.0 | MIT | — |
| `entities` | 7.0.1 | BSD-2-Clause | — |
| `es-abstract` | 1.24.2 | MIT | — |
| `es-abstract-get` | 1.0.0 | MIT | — |
| `es-define-property` | 1.0.1 | MIT | — |
| `es-errors` | 1.3.0 | MIT | — |
| `es-module-lexer` | 2.3.2 | MIT | — |
| `es-object-atoms` | 1.1.2 | MIT | — |
| `es-set-tostringtag` | 2.1.0 | MIT | — |
| `es-to-primitive` | 1.3.4 | MIT | — |
| `esbuild` | 0.28.2 | MIT | — |
| `escalade` | 3.2.0 | MIT | — |
| `estree-walker` | 2.0.2 | MIT | — |
| `estree-walker` | 3.0.3 | MIT | — |
| `esutils` | 2.0.3 | BSD-2-Clause | — |
| `eta` | 4.6.0 | MIT | — |
| `expect-type` | 1.4.0 | Apache-2.0 | — |
| `fast-deep-equal` | 3.1.3 | MIT | — |
| `fast-json-stable-stringify` | 2.1.0 | MIT | — |
| `fast-uri` | 3.1.8 | BSD-3-Clause | — |
| `fdir` | 6.5.0 | MIT | — |
| `filelist` | 1.0.6 | Apache-2.0 | — |
| `find-up` | 4.1.0 | MIT | — |
| `for-each` | 0.3.5 | MIT | — |
| `foreground-child` | 3.3.1 | ISC | — |
| `fs-extra` | 9.1.0 | MIT | — |
| `fsevents` | 2.3.3 | MIT | — |
| `function-bind` | 1.1.2 | MIT | — |
| `function.prototype.name` | 1.2.0 | MIT | — |
| `functions-have-names` | 1.2.3 | MIT | — |
| `generator-function` | 2.0.1 | MIT | — |
| `gensync` | 1.0.0-beta.2 | MIT | — |
| `get-caller-file` | 2.0.5 | ISC | — |
| `get-intrinsic` | 1.3.0 | MIT | — |
| `get-own-enumerable-property-symbols` | 3.0.2 | ISC | — |
| `get-proto` | 1.0.1 | MIT | — |
| `get-symbol-description` | 1.1.0 | MIT | — |
| `glob` | 11.1.0 | BlueOak-1.0.0 | — |
| `globalthis` | 1.0.4 | MIT | — |
| `gopd` | 1.2.0 | MIT | — |
| `graceful-fs` | 4.2.11 | ISC | — |
| `has-bigints` | 1.1.0 | MIT | — |
| `has-property-descriptors` | 1.0.2 | MIT | — |
| `has-proto` | 1.2.0 | MIT | — |
| `has-symbols` | 1.1.0 | MIT | — |
| `has-tostringtag` | 1.0.2 | MIT | — |
| `hasown` | 2.0.4 | MIT | — |
| `html-parse-stringify` | 4.0.1 | MIT | — |
| `idb` | 7.1.1 | ISC | — |
| `internal-slot` | 1.1.0 | MIT | — |
| `is-array-buffer` | 3.0.5 | MIT | — |
| `is-async-function` | 2.1.1 | MIT | — |
| `is-bigint` | 1.1.0 | MIT | — |
| `is-boolean-object` | 1.2.2 | MIT | — |
| `is-callable` | 1.2.7 | MIT | — |
| `is-core-module` | 2.17.0 | MIT | — |
| `is-data-view` | 1.0.2 | MIT | — |
| `is-date-object` | 1.1.0 | MIT | — |
| `is-document.all` | 1.0.0 | MIT | — |
| `is-finalizationregistry` | 1.1.1 | MIT | — |
| `is-fullwidth-code-point` | 3.0.0 | MIT | — |
| `is-generator-function` | 1.1.2 | MIT | — |
| `is-map` | 2.0.3 | MIT | — |
| `is-module` | 1.0.0 | MIT | — |
| `is-negative-zero` | 2.0.3 | MIT | — |
| `is-number-object` | 1.1.1 | MIT | — |
| `is-obj` | 1.0.1 | MIT | — |
| `is-regex` | 1.2.1 | MIT | — |
| `is-regexp` | 1.0.0 | MIT | — |
| `is-set` | 2.0.3 | MIT | — |
| `is-shared-array-buffer` | 1.0.4 | MIT | — |
| `is-stream` | 2.0.1 | MIT | — |
| `is-string` | 1.1.1 | MIT | — |
| `is-symbol` | 1.1.1 | MIT | — |
| `is-typed-array` | 1.1.15 | MIT | — |
| `is-weakmap` | 2.0.2 | MIT | — |
| `is-weakref` | 1.1.1 | MIT | — |
| `is-weakset` | 2.0.4 | MIT | — |
| `isarray` | 2.0.5 | MIT | — |
| `isexe` | 2.0.0 | ISC | — |
| `jackspeak` | 4.2.3 | BlueOak-1.0.0 | — |
| `jake` | 10.9.4 | Apache-2.0 | — |
| `js-tokens` | 4.0.0 | MIT | — |
| `jsesc` | 3.1.0 | MIT | — |
| `json-schema-traverse` | 1.0.0 | MIT | — |
| `json5` | 2.2.3 | MIT | — |
| `jsonfile` | 6.2.1 | MIT | — |
| `jsonpointer` | 5.0.1 | MIT | — |
| `leven` | 3.1.0 | MIT | — |
| `lightningcss` | 1.33.0 | MPL-2.0 | — |
| `lightningcss-android-arm64` | 1.33.0 | MPL-2.0 | — |
| `lightningcss-darwin-arm64` | 1.33.0 | MPL-2.0 | — |
| `lightningcss-darwin-x64` | 1.33.0 | MPL-2.0 | — |
| `lightningcss-freebsd-x64` | 1.33.0 | MPL-2.0 | — |
| `lightningcss-linux-arm-gnueabihf` | 1.33.0 | MPL-2.0 | — |
| `lightningcss-linux-arm64-gnu` | 1.33.0 | MPL-2.0 | — |
| `lightningcss-linux-arm64-musl` | 1.33.0 | MPL-2.0 | — |
| `lightningcss-linux-x64-gnu` | 1.33.0 | MPL-2.0 | — |
| `lightningcss-linux-x64-musl` | 1.33.0 | MPL-2.0 | — |
| `lightningcss-win32-arm64-msvc` | 1.33.0 | MPL-2.0 | — |
| `lightningcss-win32-x64-msvc` | 1.33.0 | MPL-2.0 | — |
| `locate-path` | 5.0.0 | MIT | — |
| `lodash.debounce` | 4.0.8 | MIT | — |
| `lru-cache` | 5.1.1 | ISC | — |
| `lru-cache` | 11.5.3 | BlueOak-1.0.0 | — |
| `magic-string` | 0.30.21 | MIT | — |
| `magic-string` | 0.30.21 | MIT | — |
| `magic-string` | 1.4.3 | MIT | — |
| `math-intrinsics` | 1.1.0 | MIT | — |
| `minimatch` | 5.1.9 | ISC | — |
| `minimatch` | 10.2.6 | BlueOak-1.0.0 | — |
| `minipass` | 7.1.3 | BlueOak-1.0.0 | — |
| `ms` | 2.1.3 | MIT | — |
| `nanoid` | 3.3.20 | MIT | — |
| `node-releases` | 2.0.58 | MIT | — |
| `object-inspect` | 1.13.4 | MIT | — |
| `object-keys` | 1.1.1 | MIT | — |
| `object.assign` | 4.1.7 | MIT | — |
| `obug` | 3.0.0 | MIT | — |
| `own-keys` | 1.0.2 | MIT | — |
| `p-limit` | 2.3.0 | MIT | — |
| `p-locate` | 4.1.0 | MIT | — |
| `p-try` | 2.2.0 | MIT | — |
| `package-json-from-dist` | 1.0.1 | BlueOak-1.0.0 | — |
| `path-exists` | 4.0.0 | MIT | — |
| `path-key` | 3.1.1 | MIT | — |
| `path-parse` | 1.0.7 | MIT | — |
| `path-scurry` | 2.0.2 | BlueOak-1.0.0 | — |
| `picocolors` | 1.1.1 | ISC | — |
| `picomatch` | 4.0.7 | MIT | — |
| `playwright` | 1.64.0 | Apache-2.0 | — |
| `playwright-core` | 1.64.0 | Apache-2.0 | — |
| `pngjs` | 5.0.0 | MIT | — |
| `possible-typed-array-names` | 1.1.0 | MIT | — |
| `postcss` | 8.5.29 | MIT | — |
| `pretty-bytes` | 6.1.1 | MIT | — |
| `pretty-bytes` | 5.6.0 | MIT | — |
| `reflect.getprototypeof` | 1.0.10 | MIT | — |
| `regenerate` | 1.5.0 | MIT | — |
| `regenerate-unicode-properties` | 10.3.0 | MIT | — |
| `regexp.prototype.flags` | 1.5.4 | MIT | — |
| `regexpu-core` | 6.5.3 | MIT | — |
| `regjsgen` | 0.8.0 | MIT | — |
| `regjsparser` | 0.13.4 | BSD-2-Clause | — |
| `require-directory` | 2.1.1 | MIT | — |
| `require-from-string` | 2.0.2 | MIT | — |
| `require-main-filename` | 2.0.0 | ISC | — |
| `resolve` | 1.22.13 | MIT | — |
| `rolldown` | 1.2.13 | MIT | — |
| `rollup` | 4.64.5 | MIT | — |
| `safe-array-concat` | 1.1.4 | MIT | — |
| `safe-push-apply` | 1.0.0 | MIT | — |
| `safe-regex-test` | 1.1.0 | MIT | — |
| `scheduler` | 0.28.0 | MIT | — |
| `semver` | 6.3.1 | ISC | — |
| `serialize-javascript` | 7.1.2 | BSD-3-Clause | — |
| `set-blocking` | 2.0.0 | ISC | — |
| `set-function-length` | 1.2.2 | MIT | — |
| `set-function-name` | 2.0.2 | MIT | — |
| `set-proto` | 1.0.0 | MIT | — |
| `shebang-command` | 2.0.0 | MIT | — |
| `shebang-regex` | 3.0.0 | MIT | — |
| `side-channel` | 1.1.1 | MIT | — |
| `side-channel-list` | 1.0.1 | MIT | — |
| `side-channel-map` | 1.0.1 | MIT | — |
| `side-channel-weakmap` | 1.0.2 | MIT | — |
| `signal-exit` | 4.1.0 | ISC | — |
| `smob` | 1.6.2 | MIT | — |
| `source-map` | 0.8.0 | BSD-3-Clause | — |
| `source-map` | 0.6.1 | BSD-3-Clause | — |
| `source-map-js` | 1.2.2 | BSD-3-Clause | — |
| `source-map-support` | 0.5.21 | MIT | — |
| `std-env` | 4.3.0 | MIT | — |
| `stop-iteration-iterator` | 1.1.0 | MIT | — |
| `string-width` | 4.2.3 | MIT | — |
| `string.prototype.matchall` | 4.1.0 | MIT | — |
| `string.prototype.trim` | 1.2.11 | MIT | — |
| `string.prototype.trimend` | 1.0.10 | MIT | — |
| `string.prototype.trimstart` | 1.0.8 | MIT | — |
| `stringify-object` | 3.3.0 | BSD-2-Clause | — |
| `strip-ansi` | 6.0.1 | MIT | — |
| `strip-comments` | 2.0.1 | MIT | — |
| `supports-preserve-symlinks-flag` | 1.0.0 | MIT | — |
| `temp-dir` | 2.0.0 | MIT | — |
| `tempy` | 0.6.0 | MIT | — |
| `terser` | 5.51.2 | BSD-2-Clause | — |
| `tinybench` | 6.2.2 | MIT | — |
| `tinyexec` | 1.3.1 | MIT | — |
| `tinyglobby` | 0.2.17 | MIT | — |
| `type-fest` | 0.16.0 | (MIT OR CC0-1.0) | — |
| `typed-array-buffer` | 1.0.3 | MIT | — |
| `typed-array-byte-length` | 1.0.3 | MIT | — |
| `typed-array-byte-offset` | 1.0.5 | MIT | — |
| `typed-array-length` | 1.0.8 | MIT | — |
| `unbox-primitive` | 1.1.0 | MIT | — |
| `undici-types` | 8.9.0 | MIT | — |
| `unicode-canonical-property-names-ecmascript` | 2.0.1 | MIT | — |
| `unicode-match-property-ecmascript` | 2.0.0 | MIT | — |
| `unicode-match-property-value-ecmascript` | 2.2.1 | MIT | — |
| `unicode-property-aliases-ecmascript` | 2.2.0 | MIT | — |
| `unique-string` | 2.0.0 | MIT | — |
| `universalify` | 2.0.1 | MIT | — |
| `upath` | 1.2.0 | MIT | — |
| `update-browserslist-db` | 1.3.4 | MIT | — |
| `use-sync-external-store` | 1.7.0 | MIT | — |
| `whatwg-mimetype` | 3.0.0 | MIT | — |
| `which` | 2.0.2 | ISC | — |
| `which-boxed-primitive` | 1.1.1 | MIT | — |
| `which-builtin-type` | 1.2.1 | MIT | — |
| `which-collection` | 1.0.2 | MIT | — |
| `which-module` | 2.0.1 | ISC | — |
| `which-typed-array` | 1.1.24 | MIT | — |
| `why-is-node-running` | 3.2.1 | MIT | — |
| `workbox-background-sync` | 7.4.1 | MIT | — |
| `workbox-broadcast-update` | 7.4.1 | MIT | — |
| `workbox-build` | 7.4.1 | MIT | — |
| `workbox-cacheable-response` | 7.4.1 | MIT | — |
| `workbox-core` | 7.4.1 | MIT | — |
| `workbox-expiration` | 7.4.1 | MIT | — |
| `workbox-google-analytics` | 7.4.1 | MIT | — |
| `workbox-navigation-preload` | 7.4.1 | MIT | — |
| `workbox-precaching` | 7.4.1 | MIT | — |
| `workbox-range-requests` | 7.4.1 | MIT | — |
| `workbox-recipes` | 7.4.1 | MIT | — |
| `workbox-routing` | 7.4.1 | MIT | — |
| `workbox-strategies` | 7.4.1 | MIT | — |
| `workbox-streams` | 7.4.1 | MIT | — |
| `workbox-sw` | 7.4.1 | MIT | — |
| `workbox-window` | 7.4.1 | MIT | — |
| `wrap-ansi` | 6.2.0 | MIT | — |
| `y18n` | 4.0.3 | ISC | — |
| `yallist` | 3.1.1 | ISC | — |
| `yargs` | 15.4.1 | MIT | — |
| `yargs-parser` | 18.1.3 | ISC | — |

#### Comment vérifier soi-même

```bash
npm ci                     # installe exactement ces versions
npm run licences                     # régénère l'annexe B (licences directes)
node scripts/list-dependencies.mjs   # régénère l'annexe A (ce document)
npm ls --all               # l'arbre complet, tel que npm le voit
```
<!-- DEPENDANCES:END -->

**Annexe B — licences des dépendances directes** (`npm run licences`)

<!-- LICENCES:START -->
### Licences des dépendances

> Document **généré** : `node scripts/list-licences.mjs`. Ne pas modifier à la main.

La licence de DropForge lui-même **n’est pas encore choisie** : c’est une décision
du propriétaire du projet, et `package.json` renvoie à `docs/GUIDE.md` en attendant.
Cette annexe liste les licences des **dépendances directes réellement installées**,
pour qu’une
future décision soit prise en connaissance de cause : toutes sont compatibles avec
une redistribution, y compris commerciale.

| Licence | Paquets |
| --- | --- |
| Apache-2.0 | `@playwright/test` 1.64.0, `fake-indexeddb` 6.2.5, `typescript` 7.0.2 |
| Apache-2.0 OR MIT | `@tauri-apps/api` 2.12.3, `@tauri-apps/cli` 2.12.2 |
| MIT | `@noble/hashes` 2.4.0, `@types/node` 26.6.5, `@types/qrcode` 1.5.6, `@types/react` 19.3.0, `@types/react-dom` 19.3.0, `@types/ws` 8.18.2, `@vitejs/plugin-react` 6.1.2, `happy-dom` 21.0.1, `i18next` 26.4.4, `qrcode` 1.5.4, `react` 19.3.0, `react-dom` 19.3.0, `react-i18next` 17.0.16, `tsx` 4.23.15, `vite` 8.3.4, `vite-plugin-pwa` 2.0.0, `vitest` 5.0.4, `ws` 8.22.0, `zod` 4.6.6 |
| MIT OR Apache-2.0 | `@tauri-apps/plugin-dialog` 2.8.2, `@tauri-apps/plugin-fs` 2.7.0, `@tauri-apps/plugin-notification` 2.6.0, `@tauri-apps/plugin-process` 2.4.0, `@tauri-apps/plugin-sql` 2.5.0, `@tauri-apps/plugin-updater` 2.13.3 |

#### Remarques

- Les dépendances **transitives** ne sont pas listées ici : l’inventaire complet, avec
  leurs versions et leurs licences, est l’annexe A de ce même document
  (`node scripts/list-dependencies.mjs`).
  Elles sont toutes sous MIT, ISC, BSD, Apache-2.0, 0BSD ou MPL-2.0 : aucune copyleft forte.
- `@tauri-apps/*` est distribué sous Apache-2.0 OR MIT ; Tauri lui-même est sous
  Apache-2.0 OR MIT. Aucun composant n’impose de redevance ni de compte payant.
- Aucune bibliothèque de chiffrement « maison » : seules WebCrypto (plateforme) et
  `@noble/hashes` (MIT, auditée publiquement) est utilisée.
<!-- LICENCES:END -->
