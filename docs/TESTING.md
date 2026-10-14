# Tests

## Lancer

```bash
npm install                 # une fois
npm run typecheck           # TypeScript, tout le dépôt
npm test                    # unitaires + intégration
npm run test:unit           # paquets + application web + interface
npm run test:integration    # transferts, reprise, sécurité, relais
npm run verify              # typecheck + tests + configuration Tauri
npm run check:desktop       # tauri.conf.json contre le schéma officiel de Tauri 2
npm run smoke:release       # les archives téléchargeables (après npm run package)

# Navigateurs réels (jamais lancés par `npm run verify` : ils demandent des navigateurs)
npm run test:e2e:install    # une fois : télécharge Chromium, Firefox et WebKit
npm run test:e2e            # deux appareils, un transfert réel, octets vérifiés
```

`npm run check:desktop` mérite une explication : la partie bureau ne peut pas être
compilée ici (aucun Rust), mais son fichier de configuration, lui, peut être vérifié
par la CLI officielle. Ce contrôle a déjà servi — il a montré que le menu de l'icône
de la zone de notification était déclaré dans une forme que Tauri 2.12 n'accepte plus
(le menu doit être construit en Rust). Une erreur de ce genre ne se serait vue que sur
une machine Windows, au moment de la compilation.

Ce contrôle statique ne remplace pas la compilation, et la première publication l'a
prouvé : la chaîne d'intégration a rejeté **deux défauts qu'aucun test d'ici ne pouvait
voir** —

1. `TrayIconEvent::Drop` n'existe pas dans l'API de Tauri 2.12 : le dépôt de fichiers
   sur l'icône de la zone de notification n'est pas exposé du tout. La fonction a été
   retirée de l'interface, du Rust et de la documentation, plutôt que d'être annoncée ;
2. la permission `process:allow-relaunch` n'existe pas : le greffon n'expose que `exit`
   et `restart`, donc `relaunch()` côté JavaScript demande `process:allow-restart`.
   Au passage, `fs:allow-exists` a reçu la portée qui lui manquait — sans elle, l'appel
   aurait été refusé à l'exécution, sur Windows, à l'usage.

C'est la raison d'être de la chaîne de publication : compiler et empaqueter pour de
vrai, sur la plateforme visée, à chaque version.

Les **tests de navigateur** ont apporté la troisième : le repli par **relais aveugle**,
annoncé partout (README, interface, `docs/ARCHITECTURE.md`), ne fonctionnait pas. La
tentative en mode relais marquait bien son transport comme ouvert quand le service
confirmait le relais, mais ne le remettait jamais à la tentative en cours : elle attendait
ensuite un canal WebRTC que personne n'ouvrirait, puis échouait au délai. Autrement dit,
une connexion qui avait besoin du relais échouait **toujours**, et rien dans les tests
unitaires ne pouvait le voir — ils remplacent le transport. Depuis la correction,
`tests/relay-fallback.test.ts` le prouve sur un vrai serveur : la tentative aboutit, les
trames traversent le relais dans les deux sens, et un pair ne peut pas basculer une salle
en relais sans que l'autre ait répondu.

## Ce qui est couvert, et par quoi

| Suite | Fichiers | Tests | Ce qu'elle prouve |
| --- | --- | --- | --- |
| Fondations | `protocol/…` (paths, frames, checksum), `app-core/…` (state-machine, progress) | 59 | Chemins sûrs, format de trame, empreintes, machine à états, fiabilité des mesures |
| Cryptographie | `security/…` (identity, session, pairing, handshake) | 48 | Handshake authentifié, anti-rejeu, appairage vérifié, dérivation des clés |
| Moteur | `transfer-engine/…` (ranges, queue, manifest) | 16 | Plages, file d'attente, manifeste et son empreinte |
| Modules métier | `device-manager`, `history`, `settings`, `sharing`, `notifications`, `design-system`, `connection-manager` | 74 | Confiance des appareils, historique, préférences validées, partages, notifications, thème, choix de méthode |
| **Coque Windows** | `apps/desktop/src/platform/local-paths.test.ts` | 9 | Construction et normalisation des chemins (POSIX/Windows), racine de lecteur, dossier parent — les seules parties du shell qui se testent sans Tauri |
| **QR d’appairage** | `apps/web/src/components/qr.test.ts` | 7 | Structure réelle du code QR (motifs de repérage, motif de synchronisation, taille légale), refus propre au-delà de la capacité |
| **Application web** | `apps/web/src/**` | **116** | Capacités mesurées, écriture/refus/renommage de fichiers, dossier de réception, base locale + migration, mises à jour, i18n FR/EN exhaustive, **contrôleur d'application de bout en bout (deux appareils, transfert réel, refus, conflits)** |
| **Interface montée (DOM simulé)** | `apps/web/src/app/ui.test.tsx` | 6 | L'application est réellement rendue (React + happy-dom) : chargement puis navigation, état vide honnête quand aucun appareil n'est joignable, transfert suivi jusqu'à « Terminé » avec sa vérification, **refus affiché comme un refus**, changement de langue à chaud, fonction indisponible annoncée comme telle |
| **Démarrage de la coque Windows** | `apps/desktop/src/platform/boot.test.ts` | 11 | La séquence de démarrage : l'ordre des étapes, l'arrêt sur l'échec avec l'étape nommée, la description d'erreur bornée sur une ligne (aucune entrée de journal ne peut être forgée), et « l'interface a-t-elle réellement rendu quelque chose » — la question qui manquait quand l'application pouvait s'ouvrir sur une fenêtre vide |
| Transferts réels (mémoire) | `tests/loopback-transfer.test.ts` | 23 | Envoi/réception complets, conflits, écrasement, fichiers modifiés, gros fichiers, vérification |
| Reprise | `tests/resume.test.ts` | 5 | Reprise alignée sur les morceaux, refus si l'empreinte change |
| Sécurité (bout en bout) | `tests/security-integration.test.ts` | 11 | Relais incapable de lire, SAS falsifié, signature falsifiée, trame rejouée, traversée de chemin, écrasement refusé, disque plein, trame forgée |
| Connexion | `tests/connection-manager.test.ts` | 8 | Choix de méthode, échecs cumulés, changement d'identité = arrêt, et **confirmation demandée des deux côtés** avant toute connexion |
| Relais | `apps/signaling/src/server.test.ts` | 13 | Salles, quotas, relais aveugle, expiration, et l'accord **à deux** avant de basculer une salle en relais (un pair qui demande, l'autre qui répond — jamais l'inverse) |
| **Repli par relais, bout en bout** | `tests/relay-fallback.test.ts` | 3 | Une tentative en mode relais **aboutit** (elle expirait avant : le transport était marqué ouvert mais jamais remis à la tentative en cours), les trames traversent le relais dans les deux sens, et la moitié qui attend accepte le relais sans jamais le subir |
| Logo et icônes | `tests/icons.test.ts` | 16 | Le `.ico` de l’exécutable (sept tailles, DIB de 16 à 128 et PNG pour 256, cadres dans le fichier), l’écriture d’un DIB (BGRA, de bas en haut, masque), le SVG livré **identique à la description partagée**, l’écran de démarrage, le bloc de marque de l’interface, l’icône masquable, et l’icône de la **zone de notification** livrée à 32 px (celle que Windows réduit à 16) |
| **Entrée réelle de l’application** | `apps/web/src/entry.test.tsx` | 3 | `main.tsx` démarré pour de vrai, hors navigateur : IndexedDB simulée mais conforme, WebCrypto réel — la coque s’affiche ; et privée de WebCrypto, l’application **dit ce qui manque** au lieu de rester blanche (l’entrée finissait par un `void boot()` sans `catch` : n’importe quel échec laissait une page vide) |
| Hooks de l’installateur | `tests/nsis.test.ts` | 11 | Le fichier de hooks NSIS : les mêmes macros lues dans un extrait Linux et dans un extrait Windows, la macro de fermeture insérée par les deux chemins, et le refus des trois erreurs silencieuses (macro insérée mais jamais définie, hook que Tauri n’appelle pas, macro morte) — ces tests viennent d’un échec réel de la tâche Windows |
| Paquets de publication | `tests/packaging.test.ts` | 9 | Écriture **et relecture** des archives ZIP : CRC de référence, structure du répertoire central, choix stocké/déflaté, refus d’une entrée sans nom, refus d’une archive corrompue ou étrangère |

Total vérifié le 14 octobre 2026 : **440 tests, 41 fichiers**, tous au vert, sur Linux.
La même suite tourne aussi sur Windows à chaque envoi (tâche `windows` de
`.github/workflows/ci.yml`) : c'est ce qui a fait apparaître les deux défauts propres à
Windows corrigés depuis — des scripts `.cmd` lancés sans shell, et un contrôle de
l'installateur qui comparait des chaînes avec `\n` sur un fichier extrait en CRLF (voir
`scripts/lib/nsis.mjs` et `.gitattributes`).

Et, en plus de ces tests unitaires et d'intégration, **11 scénarios dans de vrais
navigateurs**, sur trois moteurs (Chromium, Firefox, WebKit) — voir la section suivante.

Le test d'interface a une histoire : il a été écrit pour vérifier que l'écran suivait
réellement le moteur, et il a immédiatement échoué sur un défaut grave — le contrôleur
publiait toujours le même objet d'état, si bien que `useSyncExternalStore` ne voyait
jamais de changement et que l'interface restait figée sur son premier rendu. Les 27
tests du contrôleur, eux, passaient tous : ils lisaient l'état directement. C'est
exactement la différence entre « le moteur fonctionne » et « le produit fonctionne ».

### Les paquets téléchargeables sont testés eux aussi

Les tests ci-dessus vérifient le code. Le paquet est vérifié séparément, parce qu'un
paquet peut être cassé même quand tout le code est vert — c'est arrivé pendant le
développement : l'archive du serveur déclarait `ws` mais importait `zod`, et ne
démarrait donc pas sur une machine vierge.

```bash
npm run package         # construit release/*.zip + SHA256SUMS
npm run smoke:release   # extrait, sert, démarre — puis échoue si ce n'est pas bon
```

`scripts/smoke-release.mjs` fait exactement ce que fera la personne qui télécharge :

- il lit les archives avec le lecteur ZIP du dépôt (`scripts/lib/unzip.mjs`) et vérifie
  les sommes de contrôle du fichier `SHA256SUMS` ;
- il sert l'application web **depuis un sous-dossier**, comme après un dézip, et
  vérifie que la page, la feuille de style, le script, le manifeste, les icônes et le
  service worker répondent, octet pour octet, avec des chemins relatifs ;
- il installe l'archive du serveur dans un dossier temporaire (`npm install
  --omit=dev`, les dépendances déclarées et rien d'autre), le démarre avec `node
  dist/main.js` comme l'indique son `RUN.md`, et lit `/health`.

Ce test est exécuté par la chaîne d'intégration avant chaque publication.

## De bout en bout, dans de vrais navigateurs

Tout ce qui précède remplace une pièce : le transport, le système de fichiers, le DOM,
l'horloge. Cette suite ne remplace rien. Deux **contextes de navigateur** (deux identités,
deux stockages, deux appareils), le **vrai service de signalisation**, un **vrai canal
WebRTC**, et des **vrais fichiers** — dont les octets reçus sont hachés *en dehors de
l'application*, puis comparés à ceux qui ont été envoyés.

```bash
npm run test:e2e
```

Elle s'exécute contre l'application **construite** (`vite build` puis `vite preview`) et
le service de signalisation, démarrés automatiquement par la configuration Playwright.

| Scénario | Navigateur | Ce qui est prouvé |
| --- | --- | --- |
| Transfert de deux fichiers (un texte, quelques Mio binaires) | Chromium, Firefox | Les deux appareils se découvrent par code, comparent leur code de sécurité, et les fichiers arrivent **octet pour octet** : les empreintes SHA-256 des téléchargements capturés sont identiques à celles des fichiers envoyés |
| Refus de la réception | Chromium | L'expéditeur voit un **échec**, avec la raison affichée, et jamais « Terminé » ; aucune des deux interfaces ne prétend que le fichier est arrivé |
| Appareil refusé à l'appairage | Chromium | Le côté qui refuse n'obtient aucune connexion, et aucun transfert n'est possible ensuite |
| Historique après rechargement | Chromium | Après un rechargement complet de la page, l'historique est toujours là (IndexedDB) et l'entrée s'ouvre |
| Hors ligne | Chromium | Une fois le service worker installé, l'application **se rouvre sans réseau** : la promesse « PWA installable qui fonctionne hors ligne » est vérifiée, pas supposée |
| Téléphone (Pixel 7 émulé) | Chromium mobile | La navigation basse remplace la barre latérale, et un transfert complet fonctionne depuis un écran de téléphone |
| Ce que l'on ne promet pas sur iOS | WebKit (iPhone 14 émulé) | Le sélecteur de dossier est **absent** (iOS ne l'a pas), l'installation explique le vrai geste (« Partager → Sur l'écran d'accueil ») au lieu d'un bouton mort, et le code d'appairage peut être affiché |

Ce que cette suite **ne** fait **pas** : piloter un vrai iPhone, un vrai Android ou un
vrai Windows. Les gestes qui ne peuvent pas être automatisés (choisir un dossier dans le
système, installer une PWA depuis le menu du navigateur, accepter un certificat) restent
dans le protocole manuel ci-dessous — et `docs/PLATFORM-MATRIX.md` dit lesquels ont été
réellement exécutés.

## Ce qui n'est PAS couvert (à ne pas confondre avec « testé »)

| Élément | Statut | Où c'est dit |
| --- | --- | --- |
| Compilation et exécution Rust/Tauri | ❌ Environnement sans Rust | `docs/PLATFORM-MATRIX.md` |
| Coque Windows au-delà des chemins | ❌ `tauri-fs`, `tauri-store`, `tauri-updater` n'importent les plugins Tauri : aucun test automatique, seule la vérification de types | ci-dessus |
| Navigateur réel (Chromium/Safari/Firefox) | ✅ Couvert par `npm run test:e2e` — sauf les gestes que l'automatisation ne peut pas faire : choisir un dossier dans la boîte de dialogue du système, installer une PWA depuis le menu du navigateur, accepter une permission native | section précédente |
| Appareils mobiles réels | ❌ Non testé : l'émulation de téléphone (Chromium Pixel 7, WebKit iPhone 14) est couverte, un vrai iPhone et un vrai Android non | plus bas |
| Service d'hébergement de partage | ❌ Non configuré ; seul le code client est testé | `docs/FREE-DEPLOYMENT.md` |
| Compilation Rust | ⚠️ Faite par la chaîne d'intégration sur Windows à chaque envoi, jamais dans l'environnement de développement | `docs/PLATFORM-MATRIX.md` |
| Signature d'un installateur Windows | ❌ Aucun certificat disponible | `docs/UPDATE-PROCEDURE.md` |

## Protocole à exécuter sur une machine Windows (à faire)

1. **Compilation** : `npm run build:windows`, corriger les erreurs
   de compilation Rust, relancer.
2. **Installation** : installer le MSI/NSIS produit, vérifier qu'il n'y a pas de
   demande de droits administrateur (installation par utilisateur).
3. **Transfert local** : deux PC sur le même réseau, envoyer un fichier de 1 Gio,
   un dossier de 500 fichiers, un fichier de 4 Gio (vérifier la vérification finale).
4. **Interruption** : couper le Wi-Fi pendant l'envoi, reconnecter, vérifier la
   reprise et l'absence de doublon.
5. **Espace** : destination pleine → refus **avant** écriture, message explicite.
6. **Conflits** : fichier existant → ignorer/renommer/remplacer, et vérifier que le
   fichier d'origine est intact dans les deux premiers cas.
7. **Fenêtre** : fermer pendant un transfert avec « continuer en arrière-plan »
   → le transfert se termine et une notification apparaît.
8. **Démarrage** : activer puis désactiver le démarrage automatique, vérifier dans le
   gestionnaire des tâches que rien ne reste activé.
9. **Mise à jour** : publier une version supérieure signée, vérifier que DropForge la
   propose, qu'il ne l'installe pas sans accord, et qu'une signature invalide est
   refusée.
10. **Désinstallation** : vérifier que les fichiers reçus restent, et que les données
    locales supprimées sont celles de l'application uniquement.

## Protocole à exécuter sur téléphone (à faire)

| Appareil | À vérifier |
| --- | --- |
| Android / Chrome | Installation de la PWA, envoi de plusieurs fichiers, réception dans un dossier choisi, notification, reprise après une coupure |
| iOS / Safari | Installation depuis le menu Partager, envoi de photos, réception par téléchargement, comportement quand l'application passe en arrière-plan (doit avertir, pas mentir) |
| Firefox (bureau) | Repli téléchargement, message clair sur le dossier de réception non mémorisable |
| Safari (bureau) | Idem iOS, sans installation |

Pour chaque cas : noter ce qui fonctionne, ce qui échoue, et le message affiché.
Compléter ensuite `docs/PLATFORM-MATRIX.md` — c'est le seul document qui doit
refléter ces résultats.

## Écrire un test

- Un test qui décrit un comportement visible porte le nom de ce comportement, pas le
  nom de la fonction.
- Les tests qui touchent au temps utilisent les horloges injectables
  (`Clock`), jamais `setTimeout` avec des valeurs devinées.
- Un test de sécurité place l'attaquant de son côté : une trame forgée est envoyée
  *par* l'attaquant, jamais injectée dans le transport de la victime.
- Aucun test ne doit dépendre d'un ordre d'exécution ou d'un état global : chaque
  fichier crée ses propres objets.
