# Historique des versions

Les notes de version publiées sur GitHub sont **extraites de ce fichier** : la section
correspondant à l'étiquette (`v0.1.2` → `## [0.1.2]`) devient la description de la
Release. Une seule source, jamais deux textes à garder cohérents.

Le format suit [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) ; les versions
suivent le [versionnage sémantique](https://semver.org/lang/fr/) une fois la 1.0 atteinte.

## [0.1.2] — 15 octobre 2026

**Version de correction : les deux défauts signalés sur l'application Windows sont
corrigés, et la récupération d'une installation coincée est documentée et outillée.**

### Corrigé

- **L'écran de démarrage ne peut plus rester affiché sans rien dire.** Un contrôle de
  secours est écrit dans la page (`apps/desktop/index.html`), exécuté **avant** le paquet
  de l'interface et sans aucune importation : il ne peut donc pas échouer pour la même
  raison que ce qu'il surveille. Il écoute les erreurs de chargement, les exceptions et
  les promesses rejetées, puis remplace l'écran de démarrage par **la cause réelle**, le
  chemin du journal de diagnostic et un bouton pour copier le détail — au bout de 15
  secondes, ou dès qu'une erreur est connue. La cause est aussi écrite dans
  `%APPDATA%\org.dropforge.app\diagnostics.log` via la commande `report_problem`.
- **« L'application est en cours d'exécution » alors qu'elle ne tourne pas** n'arrête plus
  l'installation ni la désinstallation. Le contrôle du modèle NSIS de Tauri interroge le
  **Windows Restart Manager** sur le chemin `%LOCALAPPDATA%\DropForge\DropForge.exe` — pas
  sur les processus ; un antivirus, l'Explorateur, une instance restée en arrière-plan ou
  le démarrage automatique suffisaient à le déclencher. Le hook `installer/hooks.nsh`
  ferme l'application, **écarte l'exécutable du chemin interrogé**
  (`DropForge.exe` → `DropForge.exe.df-ecarte` : un fichier renommé n'a plus
  d'utilisateurs), referme, puis supprime le fichier écarté. Si le renommage échoue parce
  qu'un autre programme tient réellement le fichier, le journal d'installation le dit au
  lieu de laisser croire à une application fantôme.
- **La documentation ne part plus dans tous les sens** : quatre fichiers au lieu de
  dix-neuf — ce journal, le [README](README.md), le [guide](docs/GUIDE.md) et la
  [documentation technique](docs/TECHNIQUE.md). Rien n'a été perdu : le guide contient
  l'installation, l'usage, le dépannage et la publication ; la documentation technique
  contient l'architecture, le comportement, les données, la sécurité, les plateformes, les
  tests, l'état réel et les annexes générées (dépendances, licences).
- La page d'accueil GitHub Pages (`index.html`, généré depuis `site/`) : bloc « L'application
  web » en haut de page avec son adresse unique, les deux chemins (application web ou
  téléchargement), avertissement honnête sur les défauts Windows, état réel du projet.

### Ajouté

- `scripts/unblock-windows.ps1` : déblocage d'une installation coincée. Constat sans rien
  modifier, nettoyage seulement avec `-Apply` et confirmation à chaque étape (processus,
  entrées de désinstallation, démarrage automatique, dossiers du programme, raccourcis,
  données locales sur `-RemoveData`). Les fichiers reçus ne sont jamais touchés.
- `npm run site:build` / `npm run check:site` : génération et vérification de la page
  publiée ; `check:site` fait partie de `npm run verify`.
- Tests : `tests/desktop-splash.test.ts` (8), `tests/pages-site.test.ts` (13),
  `tests/windows-recovery.test.ts` (7), plus `tests/nsis.test.ts` étendu (12).
  **480 tests, 45 fichiers.**

### Ce que cette version ne prouve pas encore

- **Aucun essai manuel sur un vrai Windows** n'a été fait : la chaîne d'intégration
  compile, empaquette et vérifie la configuration, elle n'ouvre pas la fenêtre à votre
  place. C'est la première chose à confirmer (protocole : `docs/TECHNIQUE.md` § 8).
- **Aucune mise à jour signée** : les secrets de signature ne sont pas configurés, donc
  l'application ne proposera pas de mise à jour automatique (`docs/GUIDE.md` § 9). Le
  greffon de mise à jour est compilé sans sa fonction `zip`, parce que son auteur a retiré
  du registre toutes les versions antérieures à 9.0 le 16 octobre 2026 : sans cela,
  l'installateur Windows ne compilait plus du tout (`docs/TECHNIQUE.md`, « Mises à jour »).
- **Aucun service d'hébergement** : les liens de partage hébergés restent indisponibles ;
  le transfert direct fonctionne sans eux.
- **La licence du projet reste à définir** : le fichier `LICENSE` n'existe pas encore.

## [0.1.1] — 14 octobre 2026

Version de **correction** : la 0.1.0 s'installait, puis ne s'ouvrait pas.

### Corrigé

- **L'application Windows s'ouvre toujours.** La fenêtre était masquée par configuration
  et n'était révélée que par l'interface : tout échec de démarrage (base de données
  injoignable, greffon refusé, rendu raté) laissait un processus sans fenêtre, et rien à
  l'écran. L'ouverture est maintenant demandée **avant tout le reste**, deux contrôles de
  secours côté Rust affichent la fenêtre après 700 ms puis 12 s même si l'interface n'a
  rien demandé, et un échec affiche sa cause, le chemin du journal et un bouton
  « Réessayer ». Chaque panne est écrite dans `%APPDATA%\org.dropforge.app\diagnostics.log`
  (sans secret, taille bornée). Un second lancement ramène la fenêtre existante au premier
  plan au lieu de démarrer un processus invisible.
- **La confirmation d'un nouvel appareil est posée des deux côtés — et elle montre le
  code.** Un appareil qui recevait un code d'appairage pouvait se connecter sans que
  l'autre côté ait pu demander sa confirmation ; la question voyage désormais dans un
  message dédié (capacité `trust.request`). La question affiche aussi **le code à
  comparer**, qui manquait : les deux appareils demandaient de vérifier six chiffres en
  affichant un tiret à la place — c'est le test de navigateur qui l'a montré. Une connexion
  fermée cesse d'être affichée : l'interface efface la connexion et explique pourquoi, avec
  un code d'erreur stable.

### Ajouté

- **Le logo est partout** : le même dessin (`packages/design-system/src/brand-mark.mjs`)
  est la source unique de l'icône du `.exe` (7 tailles, 16 → 256 px), des images de
  l'installateur, de la fenêtre, de la zone de notification, de l'écran d'attente, du
  favicon, du manifeste PWA et de l'icône d'accueil iOS. Aucune n'est dessinée à la main :
  `npm run icons` les génère.
- **L'installateur est soigné** : WebView2 embarqué (premier lancement sans réseau), images
  d'en-tête et de bandeau aux dimensions exactes, icône d'installateur, choix de la langue,
  démarrage en français, fermeture propre d'une instance en cours, et case « supprimer les
  données de l'application » **décochée par défaut**.
- **Tests de bout en bout sur de vrais navigateurs** : Chromium, Firefox et WebKit
  (iPhone) exécutent la vraie application servie par son serveur de production, avec le
  vrai service de signalisation ; un fichier arrive octet pour octet, un refus est un échec
  et non un succès, l'historique survit à un rechargement, l'application fonctionne hors
  ligne.

## [0.1.0] — 13 octobre 2026

Première version publiée : application web progressive, serveur de signalisation optionnel,
moteur de transfert (chiffrement de bout en bout, reprise, vérification SHA-256, file
d'attente) et installateur Windows. **L'application Windows s'installait mais ne s'ouvrait
pas** — c'est le défaut que la 0.1.1 corrige.

[0.1.2]: https://github.com/Louxos/DROPForge/releases/tag/v0.1.2
[0.1.1]: https://github.com/Louxos/DROPForge/releases/tag/v0.1.1
[0.1.0]: https://github.com/Louxos/DROPForge/releases/tag/v0.1.0
