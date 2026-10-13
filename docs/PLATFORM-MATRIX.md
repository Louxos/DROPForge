# Matrice des plateformes

Statut exact, sans arrondi optimiste. Quatre niveaux :

- **Implémenté** : le code existe.
- **Testé** : le code existe *et* des tests automatisés l'exercent (le nombre est réel,
  il vient de `npm test`).
- **Partiel** : fonctionne avec une limitation documentée.
- **Bloqué / non vérifié** : écrit mais impossible à valider dans l'environnement de
  développement utilisé, ou dépendant d'un tiers.

## Vue d'ensemble

| Fonction | Windows (Tauri) | PWA (Chromium bureau/Android) | PWA (Safari iOS) | PWA (Firefox) |
| --- | --- | --- | --- | --- |
| Transfert local (même réseau) | Implémenté, non compilé | Testé (logique partagée) | Testé (logique partagée) | Testé (logique partagée) |
| Transfert direct Internet (WebRTC) | Implémenté, non compilé | Implémenté | Partiel (voir iOS) | Implémenté |
| Relais aveugle | Implémenté, non compilé | Testé | Testé | Testé |
| Réception dans un dossier | Implémenté (système de fichiers) | Oui (File System Access) | Non (téléchargement) | Non (téléchargement) |
| Repli par téléchargement | — | Oui | Oui | Oui |
| Reprise après interruption | Oui (écriture aléatoire) | Oui (File System Access) | Non | Non |
| Reprise après fermeture | Oui (état + fichier partiel) | Non (voir « limites PWA ») | Non | Non |
| Envoyer un dossier entier | Implémenté | Oui (sélecteur de dossier) | Non | Non |
| Barre latérale / navigation basse | Oui (barre latérale) | Oui (les deux selon la largeur) | Oui (barre basse) | Oui (barre basse) |
| Notifications système | Oui (plugin, à accorder par l'OS) | Oui (permission) | Partiel | Oui |
| Démarrage automatique | Oui (réglage, désactivé par défaut) | Non applicable | Non applicable | Non applicable |
| Zone de notification / continuer en arrière-plan | Oui | Non | Non | Non |
| Mise à jour | Signée, vérifiée, avec accord | Service worker embarqué | idem | idem |
| Historique / appareils / réglages | SQLite | IndexedDB | IndexedDB | IndexedDB |

## Windows (application Tauri 2 + Rust)

**État : écrit, typechecké côté TypeScript, *non compilé* dans cet environnement.**

| Élément | État | Détail |
| --- | --- | --- |
| Interface | ✅ Même code que la PWA (`@dropforge/web`) | `apps/desktop/src/main.tsx` |
| Gestion des données locales | ✅ `SqliteMetaStore` (SQLite, migrations, transactions) | `apps/desktop/src/platform/tauri-store.ts` |
| Fichiers (réception) | ✅ `TauriFileSystem` (mode `create-new`/`replace`/`resume`, espace libre réel) | `apps/desktop/src/platform/tauri-fs.ts` |
| Identité | ✅ SQLite local, refus d'un enregistrement inutilisable | `apps/desktop/src/platform/tauri-identity-store.ts` |
| Mises à jour | ✅ Plugin Tauri, clé publique compilée, installation après accord | `apps/desktop/src/platform/tauri-updater.ts` |
| Rust : fenêtre, tray, fermeture, autostart, espace libre | ✅ Écrit | `apps/desktop/src-tauri/src/lib.rs` |
| Configuration (fenêtre, CSP, bundle MSI/NSIS, capacités) | ✅ Écrite | `tauri.conf.json`, `capabilities/default.json` |
| Icônes | ✅ Générées (dont un `.ico`) | `apps/desktop/src-tauri/icons/` |
| **Compilation Rust** | ❌ **Non vérifiée** | Aucune chaîne d'outils Rust dans l'environnement de développement utilisé |
| **Installateur signé** | ❌ **Non produit** | Nécessite Windows + un certificat (voir `docs/UPDATE-PROCEDURE.md`) |
| **Exécution réelle sur Windows** | ❌ **Non testée** | Idem |

Ce qui reste à faire, dans l'ordre, sur une machine Windows avec Rust et Node :

1. `npm install`, puis `npm run tauri build -w @dropforge/desktop` ;
2. corriger ce que le compilateur Rust signale (le code n'a jamais été compilé : des
   ajustements d'API sont probables) ;
3. renseigner `plugins.updater.pubkey` et les `endpoints` pour activer les mises à
   jour signées, puis republier ;
4. exécuter le protocole de test de `docs/TESTING.md` (« À faire sur Windows »).

## PWA (navigateur)

| Élément | État | Détail |
| --- | --- | --- |
| Capacités mesurées | ✅ Testé (12 tests) | `apps/web/src/platform/capabilities.test.ts` |
| Écriture dans un dossier | ✅ Testé (24 tests) | `apps/web/src/platform/browser-fs.test.ts` |
| Repli téléchargement | ✅ Testé | idem |
| Dossier de réception mémorisé | ✅ Testé (8 tests) | `receive-folder.test.ts` |
| Base locale + migration v1→v2 | ✅ Testé (9 tests) | `indexed-db-store.test.ts` |
| Mises à jour (service worker) | ✅ Testé (8 tests) | `updater.test.ts` |
| Contrôleur d'application (bout en bout, deux appareils) | ✅ Testé (22 tests) | `apps/web/src/app/controller.test.ts` |
| Installation réelle sur téléphone | ⚠️ À faire | Voir « À tester à la main » |

### Limites de la PWA, dites explicitement dans l'interface

| Limite | Réalité | Ce que DropForge en dit |
| --- | --- | --- |
| Réception en arrière-plan | Impossible : un onglet non visible peut être suspendu | Le réglage « réception en arrière-plan » est affiché comme indisponible, avec la raison |
| Connexion qui survit à la fermeture | Impossible sans serveur | Les transferts actifs sont perdus ; l'interface prévient avant de fermer |
| Reprise après fermeture | Uniquement avec File System Access (Chromium) | Affiché dans la liste des capacités, sinon « le fichier sera renvoyé depuis le début » |
| iOS : sélecteur de dossier | Absent | L'envoi de dossier est masqué ; les fichiers arrivent par téléchargement |
| iOS : onglet en arrière-plan | Suspension rapide | Une note explique que l'application doit rester au premier plan |
| Firefox : écriture dans un dossier | Absent | Repli téléchargement, expliqué dans la fenêtre d'acceptation |

## Serveur de signalisation / relais

| Élément | État |
| --- | --- |
| Salles, TTL, quotas, relais aveugle | ✅ Implémenté et testé (11 tests d'intégration) |
| `/health` | ✅ `{ ok, rooms, limits }` |
| Déploiement Cloudflare | ⚠️ Non écrit : le serveur fourni est un service Node ; l'option Cloudflare est documentée dans `docs/FREE-DEPLOYMENT.md` |
| TURN | ❌ Volontairement non requis (voir `docs/FREE-DEPLOYMENT.md`) |

## Ce qui n'existe pas encore

| Élément | Pourquoi |
| --- | --- |
| Découverte automatique sur le réseau local **native** (mDNS/UDP) | La découverte est implémentée au niveau logique (annonces signées + cache) et testée ; le transport natif spécifique à chaque plateforme reste à brancher |
| Liens de partage hébergés de bout en bout | Le paquet `sharing` (chiffrement, expiration, révocation, limites) est testé ; il manque un service d'hébergement configuré (optionnel par conception) |
| Tests E2E navigateur (Playwright) | Le contrôleur et la plateforme sont testés unitairement ; un E2E réel n'a pas été exécuté dans cet environnement |
| Tests sur appareils mobiles réels | À faire, voir `docs/TESTING.md` |
