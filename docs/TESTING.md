# Tests

## Lancer

```bash
npm install                 # une fois
npm run typecheck           # TypeScript, tout le dépôt
npm test                    # unitaires + intégration
npm run test:unit           # paquets + application web + interface
npm run test:integration    # transferts, reprise, sécurité, relais
npm run verify              # typecheck + tests
```

## Ce qui est couvert, et par quoi

| Suite | Fichiers | Tests | Ce qu'elle prouve |
| --- | --- | --- | --- |
| Fondations | `protocol/…` (paths, frames, checksum), `app-core/…` (state-machine, progress) | 59 | Chemins sûrs, format de trame, empreintes, machine à états, fiabilité des mesures |
| Cryptographie | `security/…` (identity, session, pairing, handshake) | 48 | Handshake authentifié, anti-rejeu, appairage vérifié, dérivation des clés |
| Moteur | `transfer-engine/…` (ranges, queue, manifest) | 15 | Plages, file d'attente, manifeste et son empreinte |
| Modules métier | `device-manager`, `history`, `settings`, `sharing`, `notifications`, `design-system`, `connection-manager` | 71 | Confiance des appareils, historique, préférences validées, partages, notifications, thème, choix de méthode |
| **Application web** | `apps/web/src/**` | **78** | Capacités mesurées, écriture/refus/renommage de fichiers, dossier de réception, base locale + migration, mises à jour, i18n FR/EN exhaustive, **contrôleur d'application de bout en bout (deux appareils, transfert réel, refus, conflits)** |
| Transferts réels (mémoire) | `tests/loopback-transfer.test.ts` | 23 | Envoi/réception complets, conflits, écrasement, fichiers modifiés, gros fichiers, vérification |
| Reprise | `tests/resume.test.ts` | 5 | Reprise alignée sur les morceaux, refus si l'empreinte change |
| Sécurité (bout en bout) | `tests/security-integration.test.ts` | 11 | Relais incapable de lire, SAS falsifié, signature falsifiée, trame rejouée, traversée de chemin, écrasement refusé, disque plein, trame forgée |
| Connexion | `tests/connection-manager.test.ts` | 7 | Choix de méthode, échecs cumulés, changement d'identité = arrêt |
| Relais | `apps/signaling/src/server.test.ts` | 11 | Salles, quotas, relais aveugle, expiration |

Total vérifié le 13 octobre 2026 : **328 tests, 30 fichiers**, tous au vert.

## Ce qui n'est PAS couvert (à ne pas confondre avec « testé »)

| Élément | Statut | Où c'est dit |
| --- | --- | --- |
| Compilation et exécution Rust/Tauri | ❌ Environnement sans Rust | `docs/PLATFORM-MATRIX.md` |
| Navigateur réel (Chromium/Safari/Firefox) | ❌ Aucun test E2E exécuté | `docs/PLATFORM-MATRIX.md` |
| Appareils mobiles réels | ❌ Non testé | plus bas |
| Service d'hébergement de partage | ❌ Non configuré ; seul le code client est testé | `docs/FREE-DEPLOYMENT.md` |
| Signature d'un installateur Windows | ❌ Aucun certificat disponible | `docs/UPDATE-PROCEDURE.md` |

## Protocole à exécuter sur une machine Windows (à faire)

1. **Compilation** : `npm run tauri build -w @dropforge/desktop`, corriger les erreurs
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
