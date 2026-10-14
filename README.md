# DropForge

**Transférez vos fichiers simplement, rapidement, et en toute sécurité.**

DropForge envoie des fichiers entre vos appareils — Windows, Android, iOS, n'importe
quel navigateur — sans compte obligatoire, sans service payant, et en privilégiant le
transfert direct d'un appareil à l'autre. Quand un serveur est utilisé, il ne voit
jamais le contenu des fichiers.

<p align="center">
  <em>Un seul nom, deux coques : une application Windows (Tauri 2 + Rust) et une
  application web progressive (PWA) partageant exactement la même interface.</em>
</p>

---

## Télécharger

| Vous êtes sur | Prenez | Comment |
| --- | --- | --- |
| **Windows** | l'installateur de la dernière version | page **[Releases](../../releases)** → `DropForge_<version>_x64-setup.exe` (par utilisateur, sans droits administrateur) |
| **Téléphone, tablette, autre ordinateur** | l'application web | `dropforge-pwa-<version>.zip` de la dernière version, servi en **HTTPS**, puis « Installer l'application » / « Sur l'écran d'accueil ». La page hébergée (GitHub Pages) demande une activation manuelle du dépôt — deux minutes, expliquées dans [`docs/OWNER-GUIDE.md`](docs/OWNER-GUIDE.md) |
| **N'importe où, sans réseau** | le même dossier, hors ligne | une fois le service worker installé, l'application fonctionne sans réseau ; l'archive se sert depuis n'importe quel dossier |
| **Deux réseaux différents** | le serveur optionnel | `dropforge-signaling-<version>.zip` : `npm install --omit=dev && npm start` |
| **Un serveur à vous** | les conteneurs | `cd deploy && docker compose up -d --build` → `http://localhost:8080` |

Détail complet, vérification des sommes de contrôle et construction soi-même :
[`docs/DOWNLOAD.md`](docs/DOWNLOAD.md).

---

## État réel du projet

DropForge n'est **pas** encore une version 1.0. Ce tableau dit exactement où en est
chaque partie — pas d'estimation optimiste. La matrice détaillée, fonctionnalité par
fonctionnalité, est dans [`docs/PLATFORM-MATRIX.md`](docs/PLATFORM-MATRIX.md).

| Partie | Statut |
| --- | --- |
| Moteur de transfert (chiffrement, reprise, vérification, file d'attente) | ✅ Implémenté et **testé** (399 tests automatisés, 37 fichiers) |
| Interface partagée React/TypeScript (FR/EN, thème sombre/clair) | ✅ Implémentée et **testée** au niveau du contrôleur d'application |
| Application web progressive (PWA) installable | ✅ Implémentée et **testée** (pas encore testée sur téléphone réel) |
| Serveur de signalisation / relais aveugle | ✅ Implémenté et **testé** (Node) |
| Application Windows (Tauri + Rust) | ✅ **Compilée et empaquetée** par la chaîne d'intégration (version 0.1.0 : `DropForge_0.1.0_x64-setup.exe` et `.msi` publiés), et recompilée à **chaque envoi** par la tâche Windows de l'intégration continue. La fenêtre ne peut plus rester invisible : ouverture demandée avant tout le reste, contrôles de secours côté Rust, écran d'échec avec la cause et le journal (`docs/TROUBLESHOOTING.md`). L'application n'a **pas encore été ouverte** sur un vrai Windows : c'est la seule chose que la chaîne d'intégration ne peut pas faire |
| Installateur et désinstallateur Windows | ✅ **Soignés** : WebView2 embarqué (premier lancement sans réseau), images d'en-tête et de bandeau aux dimensions exactes, icône d'installateur, choix de la langue, démarrage en français, fermeture des instances en cours, désinstallation proposant (décoché) la suppression des données locales. Non signés « éditeur » (certificat payant) et les mises à jour signées attendent une clé (`docs/OWNER-GUIDE.md`) |
| Tests dans un vrai navigateur (E2E) | ✅ **Écrits et exécutés à chaque envoi** : deux navigateurs réels, transfert réel, **octets reçus hachés et comparés** — plus le refus, l'appareil refusé, l'historique après rechargement et le fonctionnement hors ligne. Chromium, Firefox, WebKit (`docs/TESTING.md`) |
| Tests sur appareils mobiles réels | ❌ Non exécutés — l'émulation de téléphone est couverte, un vrai iPhone/Android ne l'est pas |
| Liens de partage hébergés | ⚠️ Code client implémenté et testé ; nécessite un hébergement (optionnel) |

## Comment DropForge se connecte

Dans l'ordre, la première méthode qui fonctionne réellement :

1. **Réseau local** — les deux appareils sont sur le même réseau : le transfert ne
   sort jamais du réseau local.
2. **Direct (WebRTC)** — les deux appareils sont derrière des réseaux différents : un
   canal chiffré de bout en bout est négocié avec l'aide d'un serveur de signalisation
   qui ne voit passer que des messages de négociation et des données déjà chiffrées.
3. **Relais aveugle** — quand la connexion directe est impossible : le serveur relaie
   des octets chiffrés sans pouvoir les lire.

Si aucune méthode ne fonctionne, DropForge le dit clairement et propose une
alternative. **Il n'affirme jamais qu'un réseau autorise la connexion directe.**

## Fonctionnalités

**Transferts** — tous types de fichiers ; sélection multiple, glisser-déposer et
dossiers là où le système le permet ; envoi et réception ; file d'attente avec pause, reprise,
annulation, réessai et réordonnancement ; limité en parallèle par un réglage (1 à 8) ;
reprise après coupure quand la plateforme expose l'écriture aléatoire ; vérification
d'intégrité SHA-256 avant tout état « terminé » ; aucun plafond de taille artificiel.

**Appareils** — découverte sur le réseau local, appairage affiché sous forme de code
et de QR code, connexion manuelle par code de salle, appareils de confiance
révocables, favoris avec envoi rapide en une action, confirmation explicite avant
d'accepter un nouvel appareil. L'appairage **vérifie l'identité cryptographique** (un
code à 6 chiffres dérivé du secret partagé), pas seulement un nom. Le QR code est
généré par la bibliothèque `qrcode` (MIT) : aucun encodeur maison, comme pour la
cryptographie.

**Historique et réglages** — historique détaillé, cherchable et filtrable, avec
suppression ; favoris et envoi rapide ; notifications ; langue, thème, dossier de
réception, règles de conflit, confidentialité, limites.

**Sécurité** — aucun compte obligatoire, aucune télémétrie par défaut, aucune
collection inutile ; cryptographie par les bibliothèques reconnues du navigateur
(WebCrypto) et `@noble/hashes` ; jamais d'écrasement silencieux d'un fichier existant ;
aucun secret, aucune clé et aucun contenu de fichier dans les journaux.

**Ce que DropForge ne fait pas** (et le dit) — voir
[`docs/THREAT-MODEL.md`](docs/THREAT-MODEL.md) §4 : protection contre un appareil
cassé par un logiciel malveillant, garantie de fonctionnement derrière un réseau qui
bloque tout, réception en arrière-plan dans un navigateur mobile.

## Démarrage rapide (développement)

Prérequis : **Node 22+** et npm. Rust n'est nécessaire que pour compiler l'application
Windows.

```bash
npm install

npm run dev            # application web + signalisation (une seule commande)
npm run dev:web        # application web seule → http://localhost:5173
npm run dev:signaling  # signalisation seule → http://localhost:8787
```

`npm run dev` affiche les journaux des deux processus avec un préfixe, et un seul
Ctrl-C arrête l'ensemble.

Pour utiliser DropForge entre deux appareils, ouvrez l'application sur les deux. Le
serveur de signalisation n'est nécessaire que pour les transferts **distants** :
sur le même réseau local, l'application fonctionne sans lui.

```bash
npm run dev:desktop    # application Windows (nécessite Rust + Windows)
```

## Construire

```bash
npm run build          # les trois cibles compilables ici (web, serveur, interface bureau)
npm run package        # → release/ : archives téléchargeables + SHA256SUMS
npm run smoke:release  # vérifie ces archives comme le ferait un téléchargement
npm run build:windows  # installateur Windows (nécessite Windows + Rust)
npm run icons          # régénère les icônes (aucune dépendance externe)
npm run licences       # régénère docs/LICENCES.md depuis les dépendances installées
```

`npm run dev` lance l'application et le service de signalisation ensemble. Le
serveur de signalisation est facultatif : sur un même réseau, l'application
fonctionne sans lui.

## Tests

```bash
npm run verify           # typecheck + tous les tests + configuration Windows
npm test                 # 37 fichiers, 399 tests
npm run test:unit        # paquets et application
npm run test:integration # transferts réels en mémoire, reprise, sécurité, relais
npm run test:e2e         # de vrais navigateurs, deux appareils, un transfert réel
```

Ce qui est couvert — et surtout **ce qui ne l'est pas** — est détaillé dans
[`docs/TESTING.md`](docs/TESTING.md). Rien n'est marqué comme testé parce que
l'interface l'affiche.

## Infrastructure 100 % gratuite

DropForge est conçu pour ne fonctionner **sur aucune ressource payante**. Analyse
complète, avec les chiffres vérifiés et les limites honnêtes :
[`docs/FREE-DEPLOYMENT.md`](docs/FREE-DEPLOYMENT.md).

- **Le transfert local ne nécessite aucun service.** Deux appareils sur le même réseau
  fonctionnent sans serveur, sans compte et sans Internet.
- **La signalisation est facultative et remplaçable.** Le serveur fourni dans ce dépôt
  s'auto-héberge ; un hébergement gratuit est documenté pour qui n'a pas de machine
  disponible.
- **Aucun paiement ne peut être déclenché par l'application.** Aucune clé d'API
  facturée n'est utilisée ; les services optionnels sont configurés par celui qui
  héberge, jamais par DropForge, et l'activation de la facturation automatique n'est
  **pas** une étape de ce projet.
- **Les limites sont vérifiées avant l'opération**, pas après : taille des fichiers,
  durée et nombre de téléchargements d'un lien de partage, quota de trafic. Un refus
  arrive **avant** toute consommation facturable, jamais sous forme de dépassement.
- **Aucune limite de taille artificielle** n'est imposée aux transferts directs : les
  seules limites réelles sont celles du réseau et du disque, et elles sont affichées.
- **Ce qui ne peut pas rester gratuit est désactivé proprement.** Les liens de partage
  hébergés nécessitent un service de stockage : sans configuration, la fonctionnalité
  est absente de l'interface plutôt que facturée. Le transfert direct, lui, reste
  disponible dans tous les cas.
- **TURN (relais de secours) n'est pas requis.** Les relais payants ne sont pas une
  dépendance : quand la connexion directe échoue, DropForge le dit et propose une
  alternative, au lieu de facturer un relais à quelqu'un.

## Structure du dépôt

```
packages/
  protocol/           format des trames, chemins sûrs, catalogue d'erreurs
  app-core/           types partagés, machine à états, ports (fichiers, horloge, journaux)
  security/           identité, handshake authentifié, sessions chiffrées, appairage
  transfer-engine/    envoi, réception, plages, reprise, file d'attente, vérification
  connection-manager/ choix de la méthode de connexion (local → direct → relais)
  device-manager/     appareils connus, confiance, révocation
  history/            historique des transferts (stockage clé-valeur)
  sharing/            liens de partage (chiffrés côté client, expiration, quotas)
  notifications/      notifications système avec anti-doublon
  settings/           préférences versionnées et validées
  design-system/      jetons de thème, formats, styles
apps/
  web/                l'interface + la PWA (React, TypeScript, Vite)
  desktop/            la coque Windows (Tauri 2 + Rust) réutilisant l'interface
                      (démarrage surveillé, greffons Tauri, installateur NSIS/WiX)
  signaling/          serveur de signalisation et relais aveugle (Node, WebSocket)
deploy/               déploiement maison (nginx, Docker, compose)
.github/workflows/    intégration continue, publication de l'application, versions
docs/                 architecture, modèle de données, sécurité, tests, dépannage…
tests/                transferts de bout en bout en mémoire, reprise, sécurité
e2e/                  navigateurs réels : deux appareils, transfert vérifié (Playwright)
scripts/              icônes, visuels d'installateur, licences, inventaire, paquets
```

L'interface ne contient **aucune** logique de transfert : elle pilote un contrôleur
d'application qui s'appuie sur les paquets. Le même code sert la PWA et Windows.

## Documentation

| Document | Contenu |
| --- | --- |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Modules, dépendances, flux d'un transfert |
| [`docs/SPEC.md`](docs/SPEC.md) | Comportement attendu, états, erreurs |
| [`docs/DATA-MODEL.md`](docs/DATA-MODEL.md) | Données locales, schémas, migrations |
| [`docs/THREAT-MODEL.md`](docs/THREAT-MODEL.md) | Ce qui est protégé — et ce qui ne l'est pas |
| [`docs/PRIVACY.md`](docs/PRIVACY.md) | Ce qui ne quitte jamais l'appareil |
| [`docs/FREE-DEPLOYMENT.md`](docs/FREE-DEPLOYMENT.md) | Coûts réels, quotas, alternatives |
| [`docs/PLATFORM-MATRIX.md`](docs/PLATFORM-MATRIX.md) | Implémenté / testé / partiel / bloqué |
| [`docs/OWNER-GUIDE.md`](docs/OWNER-GUIDE.md) | Les trois actions réservées au propriétaire du dépôt (Pages, clés de mise à jour, signature, licence) |
| [`docs/TESTING.md`](docs/TESTING.md) | Tests, et protocoles à exécuter à la main |
| [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md) | Chaque erreur, sa cause, sa solution |
| [`docs/UPDATE-PROCEDURE.md`](docs/UPDATE-PROCEDURE.md) | Comment publier une mise à jour signée |
| [`docs/DOWNLOAD.md`](docs/DOWNLOAD.md) | Télécharger, vérifier, installer, construire |
| [`deploy/README.md`](deploy/README.md) | Déployer soi-même (statique, conteneurs, Internet) |
| [`docs/LICENCES.md`](docs/LICENCES.md) | Licences des dépendances directes (généré) |
| [`docs/DEPENDENCIES.md`](docs/DEPENDENCIES.md) | Inventaire complet : directes, transitives, licences (généré) |

## Sécurité

Le modèle de menace complet est dans
[`docs/THREAT-MODEL.md`](docs/THREAT-MODEL.md). En résumé : le serveur de
signalisation ne peut pas lire les fichiers, l'appairage vérifie l'identité
cryptographique de l'appareil, aucune trame rejouée ne passe, et aucun chemin reçu ne
peut sortir du dossier de réception.

**Signaler une vulnérabilité** : évitez les détails exploitables dans une issue
publique ; utilisez un canal de signalement privé lorsque c'est possible. Un rapport
utile contient le code d'erreur affiché, la plateforme, et la méthode de connexion
utilisée — aucun fichier.

## Contributions

Les contributions, idées et retours sont bienvenus. Avant de proposer une
modification, vérifiez l'état réel dans
[`docs/PLATFORM-MATRIX.md`](docs/PLATFORM-MATRIX.md) : une fonctionnalité marquée
« bloqué » ou « non testé » ne doit pas être présentée comme terminée.

## Licence

La licence du projet reste à définir. Tant qu'aucune licence n'a été ajoutée au
dépôt, le code n'est pas automatiquement réutilisable, modifiable ou redistribuable.
Les licences des dépendances sont listées dans
[`docs/LICENCES.md`](docs/LICENCES.md).

## Soutenir le projet

En suivant son évolution, en partageant vos idées, en signalant les problèmes et en
contribuant à son amélioration.

Merci de votre intérêt pour DropForge.
