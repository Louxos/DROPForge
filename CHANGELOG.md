# Historique des versions

Les notes de version publiées sur GitHub sont **extraites de ce fichier** : la section
correspondant à l'étiquette (`v0.1.2` → `## [0.1.2]`) devient la description de la
Release. Une seule source, jamais deux textes à garder cohérents.

Le format suit [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) ; les versions
suivent le [versionnage sémantique](https://semver.org/lang/fr/) une fois la 1.0 atteinte.

> **À lire avant les versions antérieures.** Jusqu'à la 0.1.2 incluse, DropForge était
> aussi une application Windows (Tauri 2 + Rust). Cette application a été **retirée du
> projet** en 0.1.3 : les entrées plus bas qui parlent d'installateur, de `.exe` ou de
> `.msi` décrivent un produit qui n'existe plus dans ce dépôt. La suite du projet est
> l'application web installable, et rien d'autre.

## [Archivé] — 4 novembre 2026

**Le développement de DropForge s'arrête ici.** Cette entrée n'est pas une version : rien
n'est ajouté, rien n'est corrigé. Elle date la fin du projet et dit ce qui reste en ligne.

### Ce qui s'arrête

- plus de fonctionnalités, plus de correctifs, plus de réponses de support ;
- plus de versions publiées : la dernière reste la **0.1.3** du 16 octobre 2026. Le code
  contenait une évolution `0.2.0` (publication sur GitHub Pages) qui n'a jamais reçu
  d'étiquette ni de version publiée ;
- le dépôt GitHub passe en **lecture seule**, avec l'étiquette `archived-2026-11-04`.

### Changé

- **Le site publié est désormais dans le dépôt.** GitHub Pages sert les fichiers de la
  branche (`index.html`, `404.html`, `favicon.svg`, `app/`, `.nojekyll`) au lieu d'un
  artefact de workflow : un dépôt archivé n'exécute plus ses workflows, un site qui
  n'existerait que là ne serait plus reconstructible. `npm run publish:site` écrit cette
  copie, et `npm run check:pages` la compare **octet par octet** au site construit — une
  dérive échoue la chaîne.
- La page publiée devient une page d'archive ; la page 404 et l'écran « À propos »
  rappellent la date et l'arrêt du développement.
- **La fermeture se lit en rouge et en orange** : filet en haut de page, sceau daté,
  titre en dégradé chaud, halos rouges. Le logo garde son violet et son bleu — c'est
  DropForge, pas une page d'erreur — et la bannière du README porte les mêmes couleurs.

### Ce qui reste en ligne

- le code source et l'historique complet des commits, inchangés ;
- les versions `v0.1.0` à `v0.1.3` et leurs archives, avec leurs sommes de contrôle ;
- l'application, toujours servie à `https://louxos.github.io/DROPForge/app/`, **sans
  maintenance** ;
- la page du site, devenue une page d'archive, et cette documentation telle qu'elle était.

### Pourquoi

Un seul développeur, bénévole, pour un produit qui touche au réseau pair-à-pair, à la
cryptographie, au stockage local et à trois moteurs de navigateurs : la maintenance est
devenue disproportionnée. Le besoin est couvert par des outils installés et suivis par des
équipes entières. Et rester gratuit était un plafond — relais public, serveurs TURN,
hébergement des liens de partage et essais sur de vrais téléphones ne pouvaient pas être
tenus sérieusement sans financement. **Plutôt que de promettre ce qui ne pouvait pas être
tenu, le projet s'arrête.**

### Non couvert, et assumé jusqu'au bout

Aucune version stable (1.0) n'a jamais été publiée. Les transferts entre appareils de
**réseaux différents**, les **liens de partage hébergés** et les **essais sur téléphones
réels** n'ont jamais été livrés. Le dépôt n'a jamais reçu de licence : le code est
consultable, pas librement réutilisable.

## [0.2.0]

> **Version jamais publiée.** L'évolution ci-dessous a été écrite, testée et publiée sur
> GitHub Pages, mais le projet s'est arrêté avant qu'elle ne reçoive une étiquette et des
> notes de version. Elle est le dernier état du code, pas une release.

**DropForge est publié par GitHub Pages, et par rien d'autre.** Un dépôt, un site, un
artefact : `npm run build:pages` assemble l'accueil, la page 404 et l'application dans
`_site/`, et `.github/workflows/pages.yml` le publie à chaque envoi sur `main`. Il n'y a
plus de `netlify.toml`, plus de variable d'environnement à recopier à la main, plus de
second hébergement à tenir à jour — et donc plus de risque que le site publié ne soit pas
celui du dépôt.

```
https://<compte>.github.io/<dépôt>/        l'accueil
https://<compte>.github.io/<dépôt>/app/    l'application installable
…/une-adresse-inconnue                     la page 404 du site
```

Rétrocompatibilité : l'ancienne adresse de l'application (racine du site, ailleurs) ouvre
désormais la page d'accueil, d'où un bouton mène à l'application. Les liens d'appairage
changent de forme (`…/app/#c=CODE`) — ceux qui ont été partagés avant ne fonctionnent plus.

### Ajouté

- **Le site complet, construit en une commande** : `npm run build:pages` assemble
  `_site/` — accueil, page 404, application compilée sous `app/`. Le chemin de base est
  calculé à partir du nom du dépôt (`/DROPForge/`, ou `/` pour un dépôt
  `<compte>.github.io`) : une fourche se publie sans modifier un fichier.
- **Une vraie page 404**, servie par GitHub Pages pour toute adresse inconnue, avec le
  statut 404. Elle explique, renvoie à l'accueil et à l'application par des chemins
  absolus, et ne redirige que si le fragment appartient à l'application (`#c=…`,
  `#df=…`) — pour qu'un lien d'appairage mal collé ne soit pas perdu.
- **Le routage dans le fragment** : `#route=transfer|devices|activity|settings` est lu au
  démarrage et à chaque `hashchange`, et écrit par `history.replaceState`. Un
  rechargement garde l'écran, le bouton retour quitte l'application, et les raccourcis
  de l'application installée (« Transfert », « Historique ») ouvrent enfin le bon écran —
  ils pointaient sur `#route=…` depuis la 0.1.0 sans que rien ne les lise.
- **Le QR code fait ce qu'il annonce** : un lien d'appairage ouvre la page avec
  `#c=CODE`, et l'application consomme ce code **une fois** au démarrage, puis retire le
  fragment pour qu'un rechargement ne rappelle pas la salle. Le lien pointe désormais sur
  la page réellement ouverte (`…/app/#c=…`) et non sur la racine de l'origine, où il
  n'y avait pas d'application sur un site de projet.
- **`npm run check:pages`** : sert `_site/` sur un serveur qui applique les règles de
  GitHub Pages (chemin de base, pas de réécriture, `404.html`), puis demande chaque
  fichier référencé à travers ce chemin, lit le manifeste (`start_url`, `scope`, icônes,
  raccourcis), l'enregistrement du service worker et **tous** les fichiers qu'il précache,
  vérifie qu'une adresse inconnue répond 404 avec la page du site, qu'aucune carte de
  sources n'est publiée et que le site reste sous son budget. `--url https://…` rejoue
  les mêmes contrôles sur le site en ligne.
- **`npm run preview:pages`** : le même site, servi sous `/DROPForge/` pour cliquer
  dedans avant de publier.
- **Vérification après publication** : la chaîne de Pages vérifie le site **avant** de
  l'envoyer, puis le relit **après** déploiement depuis son adresse publique. Un envoi
  n'est annoncé réussi qu'après cette lecture.
- **Deux variables de dépôt** pour un domaine personnalisé ou une adresse particulière :
  `DROPFORGE_PAGES_BASE`, `DROPFORGE_SITE_URL` ; et deux pour un déploiement distant :
  `DROPFORGE_SIGNALING_URL`, `DROPFORGE_ICE_URLS`. Sans elles, rien n'est deviné.

### Modifié

- **La page d'accueil ne connaît plus son adresse** : elle renvoie à l'application par un
  chemin relatif (`app/`) et n'affiche l'adresse absolue qu'à l'ouverture, calculée depuis
  l'URL du navigateur. Le fichier `site/app-url.txt`, qu'il fallait penser à mettre à jour
  après chaque déploiement, a disparu avec le problème qu'il créait.
- **Le site publié ne contient plus de cartes de sources** : 3,5 Mio → **702 Kio** pour
  15 fichiers (une carte de 2,8 Mio accompagnait un script de 600 Kio). Elles restent
  disponibles à la demande (`DROPFORGE_SOURCEMAP=1`).
- **Aucun fichier généré n'est plus versionné** : `index.html`, `favicon.svg` et
  `.nojekyll` à la racine du dépôt ont disparu ; le site est reconstruit à chaque
  publication, il ne peut donc pas dériver de ses sources.
- **`npm run verify` construit et vérifie le site** (au lieu de comparer la page publiée à
  ses sources) : le contrôle porte sur les fichiers qui seront réellement envoyés.
- **La chaîne d'intégration construit aussi le site sous un autre chemin**
  (`/autre-nom/`), pour prouver qu'aucun préfixe n'est écrit en dur.

### Retiré

- `netlify.toml` — configuration, en-têtes de cache, redirection SPA et réglages de
  développement. GitHub Pages ne lit pas d'en-têtes personnalisés : les règles de cache
  qu'il posait ne sont plus applicables (voir « Limites assumées »).
- `tests/netlify.test.ts` — remplacé par `tests/pages-deploy.test.ts`, qui vérifie la
  chaîne GitHub Pages, le site construit, le préfixe de chaque référence et l'absence de
  reste de l'ancien hébergeur.
- `.netlify/` et sa mention dans `.gitignore`.

### Limites assumées, écrites ici pour ne pas les découvrir plus tard

- **GitHub Pages n'accepte aucun en-tête personnalisé** : pas de `Cache-Control` choisi,
  pas de CSP. Les fichiers de l'application portent une empreinte de contenu dans leur
  nom, le navigateur revalide le service worker, et `index.html` peut rester en cache
  jusqu'à une dizaine de minutes après une publication. C'est une limite de l'hôte, pas
  un réglage oublié (`docs/TECHNIQUE.md` § 12).
- **Aucune WebSocket** : le relais (transferts entre deux réseaux différents) ne peut pas
  vivre sur le site. Il reste optionnel, ailleurs, annoncé par `DROPFORGE_SIGNALING_URL` ;
  sans lui, l'application le dit et le mode « deux appareils sur le même Wi‑Fi » reste
  entier.
- **Aucun stockage de fichiers** : les liens de partage hébergés restent indisponibles.
  Le code client existe et reste testé ; aucun service n'est branché, et l'écran ne
  propose pas une fonction qui ne marcherait pas.
- **Le site vit sous `/app/`** : une PWA installée depuis une version antérieure garde son
  ancienne portée. Il faut la désinstaller puis la réinstaller depuis la nouvelle adresse
  pour bénéficier des mises à jour.

## [0.1.3]

**Le projet se concentre sur une seule chose : l'application web installable.** L'application
Windows (Tauri 2 + Rust) est **retirée du dépôt** — code, installateurs, scripts et tests.
Elle a coûté cher sans rien apporter de décisif : elle ne pouvait être compilée et essayée
que sur une machine Windows, sa dernière version publiée ne s'ouvrait pas (Tauri gèle
`Object.prototype` avant d'exécuter la page, et une bibliothèque écrivait sur ce prototype —
l'exception arrivait avant React), et tout ce qu'elle apportait en plus de l'application web
se paie en défauts qu'aucun test automatique ne pouvait attraper depuis ce dépôt.

Ce qui reste est plus court, plus vérifiable, et testé de bout en bout : l'application web
s'installe depuis le navigateur, sur ordinateur comme sur téléphone, elle fonctionne hors
ligne, et le mode « deux appareils sur le même Wi‑Fi » se lance en une commande.

**Ce qui a disparu** : `apps/desktop` (coque Tauri, hooks d'installateur, écran de
démarrage), les scripts `check-desktop-config`, `generate-installer-art` et
`unblock-windows.ps1`, le générateur de `.ico`/BMP, les tâches « Application Windows » des
chaînes d'intégration, les secrets de signature, et les neuf tests qui ne parlaient que de
tout cela. Les **versions publiées précédemment restent téléchargeables** sur la page des
versions, et ne sont plus maintenues.

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

- **`npm run check:direct` : le chemin direct (WebRTC) vérifié avec du vrai WebRTC**,
  hors navigateur. Jusqu'ici, la négociation SDP/ICE et l'ouverture du canal n'étaient
  prouvées par rien d'exécutable : les tests de navigateur ne tournent pas partout, et le
  test du repli par relais dit lui-même que WebRTC n'existe pas dans Node. Avec une pile
  WebRTC en TypeScript (`werift`, installée à la demande) et le **vrai** service de
  signalisation du dépôt, deux pairs se rencontrent par un code, obtiennent tous les deux
  un canal `webrtc` — aucun repli — et 64 Kio traversent le canal intacts dans les deux
  sens. Lancé en direct : tout est au vert.

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

- **La publication d'une version ne s'arrête plus en chemin.** `scripts/package.mjs`
  demandait encore de compiler l'application Windows, pourtant retirée du dépôt :
  `npm run package` échouait, et avec lui la fabrication des archives d'une version. La
  chaîne d'intégration, elle, l'appelait avec `--no-build` — l'oubli ne se voyait donc
  qu'au moment de publier, c'est-à-dire au pire moment. Le script ne construit plus que ce
  qu'il publie, et un test refuse désormais qu'un script nomme un espace de travail qui
  n'existe plus.
- **Se connecter d'abord ne laisse plus sans moyen d'envoyer.** Une fois une connexion
  ouverte, l'écran allait bien à l'envoi — mais le sélecteur de fichiers n'était plus
  rendu du tout : il restait un bouton « Envoyer vers » éteint, aucun fichier
  sélectionnable, et rien d'autre à faire que fermer la connexion. Le sélecteur reste
  maintenant à l'écran pendant la connexion, et dès que des fichiers sont choisis, le
  chef de file redevient « Envoyer vers » tandis que le sélecteur passe au second plan :
  un seul geste important à la fois. Un test de l'interface refuse désormais le retour
  de ce cul-de-sac.
- **Les réglages ne proposent plus ce qui n'existe plus.** « Lancer au démarrage de
  Windows » et « À la fermeture de la fenêtre » n'avaient de sens que dans l'application
  Windows : ils disparaissent de l'écran **et** du schéma des préférences, qui passe en
  **version 4** avec sa migration (un fichier existant garde tout le reste, ces deux clés
  sont retirées au lieu d'être ignorées en silence).
- **La chaîne de publication ne construit plus rien d'inutile.** `release.yml` publie les
  deux archives réellement téléchargeables (application web, serveur optionnel) et leurs
  sommes de contrôle ; `ci.yml` vérifie deux cibles au lieu de trois. Un dépôt qui ne
  compile plus de Rust se vérifie en une minute, sur n'importe quelle machine.
- **`npm run verify` ne demande plus ni Rust, ni machine Windows** : types, cohérence de la
  page publiée, icônes à jour, puis les tests. C'est la commande que lancent aussi bien la
  chaîne d'intégration que la page de contribution.
- **La page publiée ne propose plus qu'un chemin.** Elle disait « deux chemins, un seul
  logiciel » ; elle dit maintenant où aller — l'application web — et ce qu'il est advenu
  des installateurs précédents. Le lien vers l'application reste **tout en haut**.

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
  scénarios iOS et téléphone ont été adaptés. Le tableau de bord des tests annonce 445
  tests sur 42 fichiers.

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
