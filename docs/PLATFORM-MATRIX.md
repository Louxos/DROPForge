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
| Transfert local (même réseau) | Compilé et empaqueté, à ouvrir | Testé (logique partagée + navigateurs réels) | Testé (WebKit, sans transfert piloté) | Testé (navigateurs réels) |
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

**État : compilé et empaqueté par la chaîne d'intégration** (version 0.1.0 publiée :
`DropForge_0.1.0_x64-setup.exe`, 3,4 Mo). Le TypeScript est vérifié et testé ici, mais
**aucune compilation Rust n'est possible dans cet environnement** : chaque correction
du code Rust a été trouvée par une compilation réelle, sur une machine Windows.

| Élément | État | Détail |
| --- | --- | --- |
| Interface | ✅ Même code que la PWA (`@dropforge/web`) | `apps/desktop/src/main.tsx` |
| Gestion des données locales | ✅ `SqliteMetaStore` (SQLite, migrations, transactions) | `apps/desktop/src/platform/tauri-store.ts` |
| Fichiers (réception) | ✅ `TauriFileSystem` (mode `create-new`/`replace`/`resume`, espace libre réel) | `apps/desktop/src/platform/tauri-fs.ts` |
| Identité | ✅ SQLite local, refus d'un enregistrement inutilisable | `apps/desktop/src/platform/tauri-identity-store.ts` |
| Mises à jour | ✅ Plugin Tauri, clé publique compilée, installation après accord | `apps/desktop/src/platform/tauri-updater.ts` |
| Rust : fenêtre, fermeture, autostart, espace libre | ✅ Écrit | `apps/desktop/src-tauri/src/lib.rs` |
| Icône de la zone de notification | ✅ Menu (ouvrir / quitter) et clic gauche | Menu **construit en Rust** : la configuration de Tauri 2.2+ ne porte plus de menu d'icône. Le dépôt de fichiers **sur l'icône** n'est pas proposé : `TrayIconEvent` (2.12) n'expose que Click, DoubleClick, Enter, Move, Leave — glisser-déposer dans la **fenêtre**, oui |
| Configuration (fenêtre, CSP, bundle MSI/NSIS, capacités) | ✅ Écrite | `tauri.conf.json`, `capabilities/default.json` |
| Icônes | ✅ Générées (dont un `.ico`) | `apps/desktop/src-tauri/icons/` |
| **Compilation Rust** | ✅ **Faite par la chaîne d'intégration** | `.github/workflows/release.yml`, à chaque tag. Elle a servi deux fois : elle a rejeté une API de tray inexistante puis une permission mal nommée, défauts invisibles ici |
| Configuration (fenêtre, CSP, bundle, icône de notification, permissions) | ✅ **Validée** contre le schéma officiel de Tauri 2 | `npm run check:desktop` — c'est ce contrôle qui a corrigé le menu de l'icône (désormais construit en Rust, la configuration ne l'acceptant plus depuis Tauri 2.2) |
| **Installateur** | ⚠️ **Produit par la chaîne d'intégration** | Par utilisateur, non signé « éditeur » (certificat payant) ; mises à jour signées si la clé est configurée — voir `docs/DOWNLOAD.md` |
| **Ouverture de la fenêtre** | ✅ **Corrigée et vérifiée à la compilation** | La fenêtre ne peut plus rester invisible : elle est demandée avant tout le reste, deux contrôles de secours côté Rust l'affichent (700 ms puis 12 s), un écran d'attente est présent dans `index.html`, et tout échec de démarrage affiche sa cause, son étape, le chemin du journal et un bouton « Réessayer » au lieu d'un processus sans fenêtre. Voir `docs/TROUBLESHOOTING.md` |
| **Installateur / désinstallateur** | ✅ **Soigné** | WebView2 embarqué (premier lancement sans réseau), images d'en-tête et de bandeau NSIS/WiX aux dimensions exactes, icône d'installateur, choix de la langue à l'installation, démarrage en français, fermeture propre d'une instance en cours, désinstallation qui propose (décoché) la suppression des données locales |
| **Exécution réelle sur Windows** | ⚠️ **À faire par vous** | L'installateur est publié, la coque est compilée et empaquetée à chaque envoi, mais personne n'a encore **ouvert** l'application sur Windows : c'est la seule chose que la chaîne d'intégration ne peut pas faire. Protocole : `docs/TESTING.md` |

Ce qui reste à faire, sur une machine Windows :

1. **Lancer l'application installée** et dérouler le protocole de test de
   `docs/TESTING.md` (« À faire sur Windows »). C'est la seule chose que la chaîne
   d'intégration ne peut pas faire : elle compile et empaquette, elle ne clique pas ;
2. configurer les secrets `DROPFORGE_UPDATER_*` pour que les mises à jour soient
   signées, vérifiées et proposées — sans eux, l'application le dit et propose de
   retélécharger ;
3. si l'avertissement SmartScreen doit disparaître, acheter un certificat d'éditeur
   (payant, annuel) et le configurer dans la chaîne d'intégration.

## PWA (navigateur)

| Élément | État | Détail |
| --- | --- | --- |
| Capacités mesurées | ✅ Testé (12 tests) | `apps/web/src/platform/capabilities.test.ts` |
| Écriture dans un dossier | ✅ Testé (24 tests) | `apps/web/src/platform/browser-fs.test.ts` |
| Repli téléchargement | ✅ Testé | idem |
| Dossier de réception mémorisé | ✅ Testé (8 tests) | `receive-folder.test.ts` |
| Base locale + migration v1→v2 | ✅ Testé (9 tests) | `indexed-db-store.test.ts` |
| Mises à jour (service worker) | ✅ Testé (8 tests) | `updater.test.ts` |
| Contrôleur d'application (bout en bout, deux appareils) | ✅ Testé (27 tests) | `apps/web/src/app/controller.test.ts` |
| Interface rendue (React, DOM simulé) | ✅ Testé (6 tests) | `apps/web/src/app/ui.test.tsx` — ni CSS, ni navigateur réel |
| QR code d'appairage | ✅ Testé (7 tests de structure) | `apps/web/src/components/qr.test.ts` |
| Installation (invite du navigateur, iOS expliqué, déjà installé) | ✅ Testé (7 tests) | `apps/web/src/platform/install.test.ts` |
| Installation réelle sur téléphone | ⚠️ À faire | La publication sur GitHub Pages attend une activation du dépôt (voir `docs/OWNER-GUIDE.md`) ; l'installation depuis un navigateur de bureau est couverte par les tests de bout en bout (`e2e/mobile.spec.ts`, `e2e/safari.spec.ts`) |

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
| Liens de partage hébergés de bout en bout | Le paquet `sharing` (chiffrement, expiration, révocation, limites) est testé, et le contrôleur refuse la création sans service configuré ; aucun service d'hébergement n'est fourni. Sans configuration, l'option est affichée en lecture seule dans les réglages, avec la raison — jamais un bouton qui échoue en silence |
| ~~Tests E2E navigateur (Playwright)~~ | ✅ **Écrits et exécutés par la chaîne d'intégration** : deux navigateurs réels, un transfert réel, les octets reçus hachés et comparés ; refus, appareil refusé, historique après rechargement et fonctionnement hors ligne. Trois moteurs (Chromium, Firefox, WebKit). Détail : `docs/TESTING.md` |
| Tests sur appareils mobiles réels | À faire, voir `docs/TESTING.md` |
