# Historique des versions

Les notes de version publiées sur GitHub sont **extraites de ce fichier** : la section
correspondant à l'étiquette (`v0.1.2` → `## [0.1.2]`) devient la description de la
Release. Une seule source, jamais deux textes à garder cohérents.

Le format suit [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) ; les versions
suivent le [versionnage sémantique](https://semver.org/lang/fr/) une fois la 1.0 atteinte.

## [Non publiée]

**Interface revue selon la loi de Hick, mode « même Wi‑Fi » utilisable en une commande,
et correction de l'adresse du relais.** Ces changements sont dans le dépôt ; ils ne sont
pas encore publiés sous forme de version. L'application web, elle, est servie en continu :
son déploiement suit la branche publiée du dépôt.

### Ajouté

- **`npm run lan` : le mode « deux appareils sur le même Wi‑Fi »**, une commande et une
  adresse (servie en HTTPS). Le script compile si besoin, démarre le service de mise en relation et
  l'application compilée sur le réseau (avec `/ws` dirigé vers ce service), puis affiche
  les adresses à ouvrir sur chaque appareil. Rien ne sort du réseau : les fichiers
  passent en direct d'un appareil à l'autre. C'est le seul chemin qui marche vraiment en
  local — une page servie en HTTPS n'a pas le droit d'ouvrir `ws://` vers la machine d'à
  côté, et un hébergement statique ne garde pas une connexion WebSocket ouverte.
  Vérifié en démarrant les deux services et en faisant aboutir un rendez-vous à deux
  pairs **à travers l'application elle-même** (`/ws` de l'application → service).

- **Le mode « même Wi‑Fi » est servi en HTTPS**, avec un certificat fabriqué pour cette
  machine (`scripts/lib/self-signed.mjs`, sans dépendance : clé RSA, signature SHA-256 et
  encodage DER écrits ici, éprouvés par une vraie poignée de main TLS dans les tests).
  Ce n'était pas un confort : sur une adresse privée en clair, le navigateur **supprime
  `crypto.subtle`** — sont « sécurisés » `https://`, `http://localhost` et
  `http://127.0.0.1`, rien d'autre — donc les deux appareils se trouvaient puis la remise
  échouait, sans que rien ne l'explique. Le certificat est réutilisé d'une fois sur
  l'autre (un certificat neuf redemanderait l'avertissement du navigateur à chaque
  lancement) et refait seulement s'il ne couvre plus les adresses de la machine. Le
  message d'erreur du chiffrement manquant dit maintenant la cause et la sortie.

### Modifié

- **Loi de Hick appliquée à tous les écrans** : une seule action principale par état, et
  c'est la seule à porter le style principal (`df-button--lead`, `df-choice--primary`).
  L'écran d'entrée garde **Envoyer** et **Recevoir**, mais ne les présente plus au même
  poids : carte principale d'un côté, carte discrète de l'autre.
- **Les options rares sont repliées** dans un dépliant « Options » / « Avancé » : les
  cinq boutons identiques d'une ligne d'appareil deviennent **une** action
  (« Connecter ») plus un dépliant ; les quatre filtres de l'historique (quatre boutons
  de même taille) deviennent une liste déroulante ; la suppression d'une entrée attend
  que ses détails soient ouverts ; concurrence, taille maximale, relais, hébergement,
  diagnostic, démarrage automatique et réinitialisations passent dans **Réglages →
  Avancé**.
- **Ce qui ne sert pas n'est plus affiché** : la file d'attente n'apparaît qu'avec un
  transfert, « Vider la sélection » qu'avec une sélection, « Envoyer vers » qu'avec un
  appareil joignable ; les messages « aucun appareil joignable » qui restaient affichés
  à l'écran ont disparu — sans appareil, la seule action proposée est d'en connecter un.
- **Barres de défilement intégrées à la direction artistique** : fines, arrondies,
  discrètes, accentuées au survol (`::-webkit-scrollbar` **et** `scrollbar-color`,
  gardés identiques), et plus aucune barre horizontale.
- **Écran de chargement refait** : marque avec un halo qui respire, nom, phrase
  d'accroche, barre indéterminée (jamais un pourcentage inventé), puis l'interface qui
  arrive en fondu au lieu de remplacer l'écran d'un coup.
- **L'écran de transfert ouvre sur un choix, pas sur un formulaire.** « Envoyer » ou
  « Recevoir » : deux grands boutons, et rien d'autre. Le sélecteur de fichiers, la
  saisie de code, l'affichage du code d'appairage et la liste des appareils n'apparaissent
  qu'après le choix — chacun n'existe que dans l'étape où il sert. Une fois une connexion
  ouverte, l'écran va directement à l'envoi, avec le pair, la méthode réellement utilisée
  et le code à comparer affichés une seule fois, en haut.
- **Boutons plus francs à l'usage.** `touch-action: manipulation` et la suppression du
  halo tactile du navigateur (c'est eux qui font « traîner » un appui), un vrai
  `scale(0.97)` à l'appui — sans transition sur la descente, donc dans la même image —,
  et un anneau de focus visible au clavier. Les zones de dépôt, cartes de choix et
  fenêtres de décision ont leur propre retour visuel ; `prefers-reduced-motion` reste
  respecté, y compris pour les nouvelles animations.
- **Le sélecteur de fichiers est un vrai bouton** (le champ reste caché) : il a le rôle
  d'un bouton, se pilote au clavier, et le banc de tests peut l'appeler par son nom.

### Corrigé

- **L'application web n'invente plus l'adresse de son relais.** Elle construisait
  `wss://<son propre hôte>/ws`, que rien ne sert sur un hébergement statique : « Recevoir »
  et « joindre par code » échouaient donc systématiquement en production, avec une erreur
  de connexion à chaque tentative. La décision vit maintenant dans un seul fichier
  (`apps/web/src/platform/signaling.ts`, testé) avec trois cas : l'adresse des réglages,
  `Aucun relais` (rien n'est contacté, jamais), ou `Automatique` — le relais du
  déploiement s'il est déclaré (`VITE_SIGNALING_URL`), l'origine locale en développement
  et dans le banc (le serveur de développement y proxifie `/ws`), et **rien** partout
  ailleurs.
- **Réglage « Adresse du relais »** (Réglages) : automatique, aucun, ou votre propre
  adresse `ws://`/`wss://`. Le schéma des réglages passe en **version 3** avec sa
  migration : une installation existante garde ses préférences et reçoit `Automatique`.
  Une adresse mal écrite est refusée au moment où elle est saisie, avec le code d'erreur
  traduit, au lieu de produire un transfert qui échoue plus tard.
- **Un relais absent est dit avant, pas après.** L'écran d'accueil et l'étape
  « Recevoir » annoncent qu'aucun relais n'est configuré (ou qu'il est désactivé) et que
  seuls les appareils du même réseau peuvent se joindre. Une tentative sans adresse est
  refusée avec le code `RELAY_UNAVAILABLE` au lieu de laisser le navigateur lever une
  erreur de syntaxe brute.
- **Le banc de navigateur suit le nouvel écran** : les helpers passent par le choix
  d'entrée (idempotents, ils ne cliquent que si l'étape n'est pas déjà ouverte), et les
  scénarios iOS et téléphone ont été adaptés. Le tableau de bord des tests annonce 492
  tests sur 46 fichiers.

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
  l'application ne proposera pas de mise à jour automatique (`docs/GUIDE.md` § 9).
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
