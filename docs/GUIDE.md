# Guide DropForge

Tout ce qui se fait **avec** DropForge : l'installer, s'en servir, réparer, publier.
Ce qui se passe **dedans** (architecture, sécurité, tests, état réel) est dans
[`TECHNIQUE.md`](TECHNIQUE.md). L'historique des versions est dans
[`../CHANGELOG.md`](../CHANGELOG.md).

**Sommaire** — [1. Ce que c'est](#1-ce-que-cest) ·
[2. Comment ça se connecte](#2-comment-ça-se-connecte) ·
[3. Installer](#3-installer) ·
[4. Deux appareils sur le même Wi‑Fi](#4-le-plus-simple-et-ce-qui-est-prêt-aujourdhui-deux-appareils-sur-le-même-wi-fi) ·
[5. S'en servir](#5-sen-servir) ·
[6. L'installer sur vos appareils](#6-linstaller-sur-vos-appareils) ·
[7. Dépannage](#7-dépannage) ·
[8. Réparer l'application installée](#8-réparer-lapplication-installée) ·
[9. Vos données, et comment tout enlever](#9-vos-données-et-comment-tout-enlever) ·
[10. Propriétaire du dépôt](#10-propriétaire-du-dépôt) ·
[11. Déployer soi-même](#11-déployer-soi-même)

---

## 1. Ce que c'est

DropForge transfère des fichiers d'un appareil à un autre — Windows, Android, iOS,
n'importe quel navigateur — **sans compte obligatoire**, chiffré de bout en bout, et en
direct de machine à machine dès que le réseau le permet. Quand un serveur s'en mêle, il
ne voit jamais le contenu des fichiers.

Une seule application : une **application web installable** (PWA). Elle s'ouvre dans le
navigateur, s'installe depuis son menu, et se lance ensuite comme un logiciel — même
hors ligne. Il n'y a **rien à télécharger**.

Ce que DropForge ne fait pas, et le dit : voir
[`TECHNIQUE.md`](TECHNIQUE.md), section 5. En résumé : pas de protection contre un appareil déjà infecté, pas de
garantie derrière un réseau qui bloque tout, pas de réception en arrière-plan dans un
navigateur mobile.

## 2. Comment ça se connecte

Dans l'ordre, **la première méthode qui fonctionne réellement** :

| Ordre | Méthode | Quand | Ce qui sort de votre réseau |
| --- | --- | --- | --- |
| 1 | **Réseau local** | Les deux appareils sont sur le même Wi-Fi / LAN | Rien |
| 2 | **Direct (WebRTC)** | Réseaux différents, un chemin direct existe | La négociation, jamais le contenu |
| 3 | **Relais aveugle** | Aucun chemin direct possible | Des octets **déjà chiffrés** que le relais ne peut pas lire |

Si aucune ne fonctionne, DropForge le dit clairement et propose les alternatives qui
restent possibles. Il n'affirme jamais qu'un réseau autorise la connexion directe.

**Les appareils se trouvent de trois façons** : découverte automatique sur le réseau
local, **code de salle** (connexion manuelle, `#c=…` dans le fragment d'URL, jamais
transmis au serveur), ou **QR code** (le code et la clé publique voyagent ensemble).
Un nouvel appareil n'est jamais approuvé sans réponse explicite : le même nombre à
6 chiffres est affiché des deux côtés et doit être comparé.

## 3. Installer

Prérequis : **rien**. Ni compte, ni installation, ni droits administrateur. Un navigateur
récent suffit (Chrome, Edge, Firefox, Safari), sur ordinateur comme sur téléphone.

| Vous êtes sur | Prenez | Comment |
| --- | --- | --- |
| Ordinateur, téléphone, tablette | **l'application web** | l'adresse publiée (Netlify ou la vôtre, voir § 10), puis « Installer l'application » (Chrome/Edge, Android) ou Partager → « Sur l'écran d'accueil » (iOS/Safari). Le détail est au § 6 |
| Un réseau isolé, une clé USB | **l'archive hors ligne** | `dropforge-pwa-<version>.zip`, servie en **HTTPS** depuis n'importe quel dossier (`npx serve`, `python3 -m http.server`) : voir § 4 pour le cas « deux appareils sur le même Wi‑Fi » |
| Deux réseaux différents | **le relais** | `dropforge-signaling-<version>.zip` : `npm install --omit=dev && npm start` |

**Vérifier ce que vous téléchargez** — les sommes de contrôle sont publiées avec les
fichiers :

```bash
sha256sum -c SHA256SUMS
```

> **L'application Windows n'existe plus.** Jusqu'à la 0.1.2, DropForge publiait aussi un
> installateur Windows. Il est **retiré du projet** depuis la 0.1.3 : les fichiers publiés
> auparavant restent téléchargeables sur la page des versions, mais ils ne sont **plus
> maintenus**, et l'application web rend le même service — sans installation, et sans
> pouvoir empêcher l'interface de démarrer. Si vous l'avez installée, le § 7 dit comment
> l'arrêter et s'en débarrasser.

## 4. Le plus simple, et ce qui est prêt aujourd'hui : deux appareils sur le même Wi‑Fi

Une commande, une adresse, deux appareils. Rien ne sort du réseau : l'application, le
service qui met les appareils en relation, et les fichiers eux-mêmes (qui passent en
direct de l'un à l'autre).

```bash
npm run lan          # compile si besoin, démarre l'application et le service local
```

Le script affiche l'adresse à ouvrir **sur chacun des deux appareils**, par exemple
`https://192.168.1.24:4173`. La première fois, le navigateur prévient que la connexion
n'est pas privée : **Avancé → « Continuer vers 192.168.1.24 »**. C'est attendu — le
certificat est signé par votre machine, pas par une autorité publique — et ce clic
n'autorise rien d'autre que votre réseau. Sans lui, le navigateur refuse le chiffrement
et aucun transfert ne peut aboutir (voir « Pourquoi HTTPS » plus bas).

Puis, sur les deux appareils :

| Sur un appareil | Sur l'autre |
| --- | --- |
| **Recevoir** → « Recevoir d'un appareil » → le code s'affiche | **Recevoir** → saisir ce code → « Se connecter » |

Le code se compare ensuite sur les deux écrans (« Code à comparer ») : identiques, la
connexion est la bonne. **Envoyer** → « Choisir des fichiers » → « Envoyer vers
<appareil> ». `Ctrl-C` arrête tout.

Options : `--port`, `--signaling-port`, `--no-build`, et `--http` (à réserver à
`localhost` : en clair sur une adresse privée, le navigateur refuse le chiffrement).

### Pourquoi HTTPS, et pourquoi un certificat signé par votre machine

Deux obstacles se cumulent dès que deux appareils ne sont pas la même machine :

1. **Le chiffrement.** DropForge scelle ce qu'il envoie avec `crypto.subtle`, que les
   navigateurs ne fournissent que dans un **contexte sécurisé**. Sont sécurisés :
   `https://`, `http://localhost`, `http://127.0.0.1` — et rien d'autre. Une adresse
   privée en clair, `http://192.168.1.24`, n'en fait pas partie, dans Chrome comme dans
   Safari et Firefox. Servi ainsi, DropForge ne peut pas chiffrer : la remise échoue
   après que les deux appareils se sont trouvés.
2. **La mise en relation.** Les deux appareils doivent se trouver. En ligne, cela passe
   par un service de signalisation, sur une adresse en HTTPS/WebSocket — or un
   hébergement statique (Netlify, GitHub Pages) ne garde pas de WebSocket ouverte, et
   une page HTTPS n'a pas le droit d'ouvrir `ws://` vers la machine d'à côté.

`npm run lan` répond aux deux : il sert l'application en HTTPS depuis une machine du
réseau, et il sert aussi le service de mise en relation, **sur une seule adresse**. Rien
ne sort du Wi‑Fi : ni les fichiers, ni même cette mise en relation.

Le certificat est fabriqué localement (`scripts/lib/self-signed.mjs`), gardé dans
`.lan-tls/` sur cette machine (jamais versionné, clé en lecture seule pour son
propriétaire), et refait seulement s'il ne couvre plus les adresses de la machine ou
s'il approche de son expiration. Il **chiffre** la connexion ; il ne **prouve aucune
identité**, et ne le prétend pas : ce qui prouve l'identité, ici, c'est le « Code à
comparer » affiché sur les deux écrans, et le contenu est scellé de bout en bout par les
deux appareils. Si vous ne voulez pas de cet avertissement, la solution propre est un nom
de domaine qui pointe vers l'adresse locale et un vrai certificat — hors de portée d'un
script, et décrit dans `TECHNIQUE.md` § 11.

**Et un appareil qui ne peut pas installer ?** Tout ce qui a un navigateur fait
l'affaire : ouvrez l'adresse affichée, et le transfert se fait sans rien installer du
tout.

**Et pour travailler sur le code ?** `npm run dev` sert en clair sur
`http://localhost:5173` (un contexte sécurisé, donc tout fonctionne) ; `npm run dev
-- --https` sert sur le réseau avec le même certificat local, si vous voulez essayer
depuis un téléphone sans passer par le mode ci-dessus.

## 5. S'en servir

1. **Envoyer** — choisissez des fichiers ou un dossier (glisser-déposer accepté),
   choisissez l'appareil destinataire (appareil de confiance, favori, code de salle).
2. **Recevoir** — le destinataire voit les faits réels (nombre de fichiers, taille,
   espace libre, conflits de noms) **avant** de décider ; il accepte ou refuse.
3. **Suivre** — file d'attente avec pause, reprise, annulation, réessai et
   réordonnancement ; concurrence réglable de 1 à 8. Une barre indéterminée signifie
   « vitesse non fiable », pas « bloqué » : DropForge n'affiche jamais une vitesse
   qu'il n'a pas réellement mesurée.
4. **Vérifier** — chaque fichier reçu est haché (SHA-256) : « terminé » n'est affiché
   qu'après vérification. Un échec partiel est un échec, jamais un succès partiel.
5. **Historique** — cherchable, filtrable, supprimable, exportable en JSON.

**L'écran de transfert commence par une question** : **Envoyer** ou **Recevoir**.
Deux grands boutons, et rien d'autre. Choisir « Envoyer » ouvre le choix des fichiers,
puis la destination ; choisir « Recevoir » ouvre l'affichage du code d'appairage et la
saisie du code reçu. La file d'attente et les fenêtres de décision (nouvel appareil,
demande de réception) restent visibles quel que soit l'état. Dès qu'une connexion est
établie, l'écran va directement à l'envoi et rappelle en haut le nom du pair, le chemin
réellement utilisé et le code à comparer — le même code des deux côtés.

**Réglages qui comptent** : dossier de réception, politique de conflit (`demander`,
`renommer`, `ignorer`, `remplacer`), concurrence, taille maximale, appareils de
confiance uniquement, langue (français/anglais), thème (système/sombre/clair),
**adresse du relais** (voir « Le relais », ci-dessous), comportement à la fermeture,
conservation de l'historique, diagnostic (désactivé par défaut).

**Le relais** (Réglages → Adresse du relais) — trois possibilités, et l'écran dit
toujours laquelle est utilisée :

| Réglage | Ce qui est contacté | Quand le choisir |
| --- | --- | --- |
| **Automatique** (défaut) | Le relais déclaré par le déploiement, s'il y en a un ; sinon rien du tout hors développement local | Cas normal |
| **Aucun relais** | Rien, jamais — même si un relais était déclaré | Vous ne voulez aucun appel sortant : seuls les appareils du même réseau se joignent |
| **Adresse personnalisée** | Votre `ws://` ou `wss://` (par exemple `wss://relais.exemple.org/ws`) | Vous hébergez votre propre relais |

Quand il n'y a pas de relais, l'écran d'accueil et l'étape « Recevoir » le disent
franchement : deux appareils du **même réseau** peuvent encore se joindre, les autres
non. Le relais ne voit que les messages de mise en relation, jamais le contenu — les
fichiers sont chiffrés de bout en bout avant de quitter l'appareil.

**Reprise après coupure.** Une reprise n'est adoptée que si le manifeste est identique,
et les plages déjà écrites sont re-hachées avant d'être conservées. Dans un navigateur,
la reprise après fermeture de l'onglet n'est possible que si le fichier arrive dans un
**dossier choisi** (File System Access) ; sinon il est renvoyé du début, et l'interface
le dit.

**Liens de partage hébergés** (optionnel) : une copie **chiffrée avant de partir** est
déposée sur le service configuré, la clé reste dans le fragment du lien. Sans service
configuré, l'option n'est pas affichée — DropForge ne promet pas une fonction qu'il ne
peut pas tenir.

## 6. L'installer sur vos appareils

**Rien à télécharger : l'application s'installe depuis le navigateur.** Elle se lance
ensuite comme un logiciel — sa propre fenêtre, sa propre icône, pas de barre d'adresse —
et elle **fonctionne hors ligne** une fois ouverte au moins une fois.

| Où | Comment | Ce que ça donne |
| --- | --- | --- |
| Chrome, Edge (ordinateur) | icône « Installer » dans la barre d'adresse, ou menu → « Installer DropForge » | une fenêtre dédiée, une icône dans le menu Démarrer / le Launchpad |
| Android (Chrome) | menu ⋮ → « Installer l'application » | une icône sur l'écran d'accueil, sans magasin d'applications |
| iOS, iPadOS (Safari) | Partager → « Sur l'écran d'accueil » | une icône sur l'écran d'accueil |
| Firefox, Safari (ordinateur) | pas d'installation : l'onglet reste l'application | tout fonctionne, sauf l'icône |

**Mises à jour** : Réglages → **Mises à jour** → « Rechercher une mise à jour ». La
nouvelle version est *proposée*, jamais imposée : elle n'est appliquée que si vous
l'acceptez, et jamais au milieu d'un transfert. Une page ouverte dans un simple onglet
n'a rien à mettre à jour — l'application le dit (`PLATFORM_UNSUPPORTED`) au lieu
d'inventer un numéro de version.

**Ce qu'un navigateur ne permet pas, et que DropForge ne promet donc pas** :

- **Recevoir quand l'application est fermée** : aucun navigateur ne garde une page
  vivante sans onglet ouvert. Le téléphone doit être ouvert sur l'application pour
  recevoir. Le transfert en cours, lui, résiste à une mise en veille de l'écran.
- **Écrire dans un dossier sans le choisir** : seuls Chrome et Edge savent mémoriser un
  dossier d'arrivée ; ailleurs, chaque fichier arrive par téléchargement, et c'est
  annoncé dans Réglages.

**Où sont les journaux** : dans le navigateur, pas dans un fichier. Réglages →
**Diagnostic** donne la version affichée, la plateforme détectée et ce qui manque ; la
console du navigateur (F12) reste la source complète en cas de problème.

## 7. Dépannage

| Symptôme | Cause | Action |
| --- | --- | --- |
| Rien ne s'ouvre après avoir cliqué sur l'adresse | page pas encore chargée, ou service worker d'une ancienne version | rechargez (Ctrl+F5, ou ⌘⇧R) ; § 8 pour repartir d'un état propre |
| « Aucun appareil joignable pour le moment » | les deux appareils ne sont pas sur le même réseau, ou le relais n'est pas configuré | vérifiez le Wi‑Fi, puis Réglages → **Adresse du relais**. Sur le même réseau, aucun serveur n'est nécessaire : voir § 4 |
| « Aucun chemin commun disponible » | aucune méthode ne passe | vérifiez que les deux appareils sont sur le même réseau, ou utilisez le relais (le message dit lequel) |
| « Le relais est injoignable » | le service de signalisation est éteint, ou son adresse n'est plus bonne | Réglages → **Adresse du relais** : vérifiez l'adresse utilisée (elle est affichée), ou passez à « Aucun relais » et travaillez sur le même réseau. Rien n'est contacté en dehors de ce réglage |
| « Aucun relais n'est configuré » | le déploiement n'en déclare aucun, et l'adresse est en « Automatique » | normal sur l'application web publiée sans relais : les appareils du même réseau fonctionnent ; sinon indiquez votre adresse de relais dans les réglages, ou déclarez `VITE_SIGNALING_URL` à la compilation (§ 10) |
| « L'appareil est injoignable » | chemin bloqué (pare-feu, NAT) | relancez depuis le même réseau, ou passez par le relais |
| « Les codes ne correspondent pas » | le code de comparaison diffère → signal d'attaque, pas incident réseau | **refusez** et recommencez l'appairage sur un réseau de confiance |
| « Cet appareil a changé » | identifiant connu, empreinte de clé différente | refusez et supprimez l'appareil ; s'il est légitime, réappairez-le |
| « Un fichier existe déjà » | politique de conflit sur « demander » | choisissez renommer / ignorer / remplacer |
| « Le disque est plein » | espace insuffisant | libérez de l'espace ; la reprise repart des plages déjà écrites |
| Un transfert reste à « vérification » | hachage en cours (gros fichier) ou disque lent | attendez la fin ; au-delà du délai, l'état devient `interrupted` avec un code explicite |
| Un transfert s'arrête quand l'appareil se met en veille | attendu | au retour, relancez : la reprise continue si le fichier partiel est intact |
| Le navigateur ne peut pas mémoriser un dossier | API absente (Firefox, Safari) | les fichiers arrivent par téléchargement ; c'est annoncé dans Réglages |
| « Cette plateforme ne permet pas de rechercher une mise à jour » | application ouverte en onglet, pas installée | installez-la depuis le navigateur (§ 6) : c'est le service worker de la version installée qui apporte les mises à jour |
| « Rien n'est en attente » | aucune nouvelle version n'est prête à activer | normal : le navigateur livre la nouvelle version quand elle existe (§ 6) |
| « Le stockage est plein » / l'application ne garde plus rien | quota du navigateur atteint (historique, appareils, points de reprise) | Réglages → **Vider l'historique**, ou autorisez plus de stockage pour ce site (§ 9) |

**Vous avez encore l'application Windows (0.1.2 ou avant).** Elle n'est plus maintenue, et
elle ne fait rien que l'application web ne fasse. **L'arrêter complètement**, sans rien
désinstaller — c'est la commande à retenir :

```bat
taskkill /IM DropForge.exe /F
```

(PowerShell : `Get-Process DropForge | Stop-Process -Force`. Vérification :
`tasklist | findstr DropForge` ne doit plus rien afficher.)

**S'en débarrasser** : Paramètres → Applications → Applications installées → DropForge →
**Désinstaller** (ou `%LOCALAPPDATA%\DropForge\uninstall.exe`). Si la désinstallation
refuse en disant que l'application tourne — le défaut de la 0.1.1, corrigé en 0.1.2 —
arrêtez-la d'abord avec la commande ci-dessus, puis réessayez. Les mêmes gestes à la main,
si elle est déjà à moitié partie :

```bat
taskkill /F /IM DropForge.exe
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\DropForge" /f
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v DropForge /f
rmdir /s /q "%LOCALAPPDATA%\DropForge"
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\DropForge.lnk"
del "%USERPROFILE%\Desktop\DropForge.lnk"
```

Les fichiers que vous avez reçus ne sont jamais touchés — ils sont dans le dossier de
réception que vous aviez choisi.

**Le réflexe utile, dans tous les cas** : notez le **code d'erreur** affiché à l'écran
(par exemple `RELAY_UNAVAILABLE`, `INTEGRITY_FAILED`) et regardez l'onglet **Console**
(F12) ; le message de l'application dit toujours *quelle* étape a échoué.

## 8. Réparer l'application installée

**Une version ancienne qui reste affichée.** Le navigateur sert la version en cache
jusqu'à ce que le service worker reçoive la nouvelle. Réglages → **Mises à jour** →
« Rechercher une mise à jour », puis acceptez : la page se recharge sur la nouvelle
version.

**Repartir d'un état propre, sans rien perdre d'autre** — dans l'ordre, et pas plus loin
que nécessaire :

1. **Rechargement forcé** : Ctrl+F5 (⌘⇧R sur Mac). Cela suffit neuf fois sur dix.
2. **Mises à jour** → « Rechercher une mise à jour », puis acceptez celle proposée.
3. **Désinstaller puis réinstaller l'application** : trois points du navigateur →
   *Désinstaller DropForge*, puis rouvrez l'adresse et installez-la à nouveau (§ 6). Le
   service worker repart de zéro ; vos réglages, votre historique et vos appareils de
   confiance restent dans le stockage du site.
4. **Effacer les données du site** (dernier recours, et cela efface **tout**) : Paramètres
   du navigateur → Confidentialité → *Données des sites* → cherchez l'adresse de
   l'application → **Supprimer**. Vous perdez l'historique, les appareils de confiance et
   les points de reprise, mais **pas** les fichiers que vous avez reçus : ils sont dans
   votre dossier de réception, pas dans le navigateur.

**Un transfert qui repart de zéro après une interruption.** La reprise compare le fichier
partiel à celui qui a été promis ; si le fichier a changé (ou si le disque a été nettoyé
entre-temps), la reprise est refusée et le transfert repart du début — c'est voulu, et le
message le dit. Rien n'est jamais écrit à une place qui ne correspond pas à ce que
l'expéditeur a envoyé.

## 9. Vos données, et comment tout enlever

Tout vit dans le **stockage du navigateur**, pour l'adresse de l'application : rien
n'est écrit ailleurs, et rien n'est envoyé où que ce soit.

| Quoi | Où |
| --- | --- |
| Historique, appareils de confiance, réglages, points de reprise | le stockage du site (IndexedDB), dans le navigateur qui ouvre l'application |
| L'application elle-même (fichiers en cache, service worker) | le cache du navigateur — c'est ce qui permet de la lancer hors ligne |
| **Fichiers que vous recevez** | le dossier de réception que **vous** avez choisi (Téléchargements par défaut) — **aucune désinstallation n'y touche** |

**Tout enlever** : Réglages → les remises à zéro (historique, appareils, réglages, ou
tout) ; pour effacer aussi le cache de l'application, désinstallez-la depuis le navigateur
(§ 8), ou supprimez les données du site dans les paramètres du navigateur. Les fichiers
déjà reçus restent où ils sont : ils ne sont pas à DropForge.

Rien de tout cela n'est envoyé où que ce soit : voir
[`TECHNIQUE.md`](TECHNIQUE.md), section 6.

## 10. Propriétaire du dépôt

Trois choses seulement ne peuvent pas être faites par un agent : deux actions et une
décision.

| # | Action | Nécessaire pour | Coût |
| --- | --- | --- | --- |
| 1 | **Brancher l'application web** (Netlify) | Une adresse publique pour la PWA | 0 € |
| 2 | **Rebrancher GitHub Pages sur `main`** | Que la page publiée ne dépende plus d'une branche de travail | 0 € |
| 3 | **Licence du projet** | Dire ce que les autres ont le droit de faire | 0 € |

**1. L'application web.** `netlify.toml` est fourni : Add new site → Import from
GitHub → `DROPForge` (branche `main`) ; réglages appliqués automatiquement
(`npm run build:web`, dossier `apps/web/dist`, Node 22, `DROPFORGE_BASE=/`). Ensuite :

- Le service de signalisation ne peut pas tourner sur Netlify (pas de WebSocket). Il va
  ailleurs (`deploy/`, Cloudflare, une machine à vous) et s'annonce à la compilation :
  `VITE_SIGNALING_URL=wss://votre-relais.example/ws` dans les variables d'environnement
  du site, puis « Clear cache and deploy ». Sans relais : transferts sur le réseau local
  seulement, et l'interface le dit. L'adresse ne s'invente pas — une version publiée sans
  `VITE_SIGNALING_URL` n'a **aucun** relais, et l'annonce à l'écran plutôt que de tenter
  une connexion vers un hôte qui n'écoute pas.
- **En-têtes et cache** (déjà posés par `netlify.toml`) : `nosniff`, `no-referrer`,
  `SAMEORIGIN` sur tout le site ; `must-revalidate` sur `/sw.js`, `/registerSW.js`,
  `/index.html` et le manifeste — sans quoi une nouvelle version n'arriverait jamais ;
  un an `immutable` sur `/assets/*` (noms empreintés) ; 24 h sur les icônes.
- **Aucune CSP n'est posée, et c'est volontaire.** Une CSP écrite à l'avance casserait
  l'application en silence : le service worker, le WebSocket du relais et les
  téléchargements `blob:` dépendent de l'adresse du relais, choisie après coup. Si vous en
  voulez une, ajoutez-la **après** avoir testé sur un aperçu de branche, en autorisant au
  minimum `'self'` pour les scripts et le style, `connect-src` vers l'adresse `wss://` du
  relais, `blob:` pour les téléchargements, et `data:` pour les icônes.

- **Dernière étape obligatoire** : collez l'adresse obtenue (par exemple
  `https://dropforge.netlify.app`) dans [`site/app-url.txt`](../site/app-url.txt) sur une
  seule ligne, lancez `npm run site:build`, puis envoyez `index.html`. C'est cette
  constante, et elle seule, que la page d'accueil affiche en haut.

**2. La page d'accueil publique** — <https://louxos.github.io/DROPForge/> — GitHub Pages
est réglé sur **« Deploy from a branch »**, dossier `/` : Pages sert `index.html` (généré
par `scripts/build-site.mjs` depuis [`site/`](../site)), et le README seulement s'il est
absent. `.nojekyll` évite que Jekyll réécrive la page. La source enregistrée publie à
chaque envoi sur **cette branche-là**, et c'est le seul réglage du projet qu'un jeton
d'automatisation ne peut pas changer (`403 Resource not accessible by integration`) :

> **L'action du propriétaire :** GitHub Pages publie aujourd'hui depuis la branche de
> travail, pas depuis `main`. `main` porte **exactement les mêmes fichiers** ; le geste
> consiste à pointer la source dessus — Settings → Pages → *Deploy from a branch* →
> `main` / `/` → **Save** — pour que la page ne dépende plus d'une branche de session.
> Vérification : `gh api repos/<dépôt>/pages` doit répondre `"branch":"main"`, et la page
> se reconstruit toute seule en une minute. Tant que la source n'est pas changée, la page
> reste correcte : c'est la branche enregistrée qui est servie.

> **Les deux réglages de Pages s'excluent :** « Deploy from a branch » publie la page
> d'accueil ; « GitHub Actions » publierait l'application PWA à la place (c'est ce que
> fait `pages.yml` quand on lui en donne l'autorisation). Avec l'application sur
> Netlify, gardez « Deploy from a branch » — les fichiers publiés sont les mêmes dans
> les deux cas.

`npm run check:site` (inclus dans `npm run verify`) refuse une page désynchronisée de
ses sources, et `npm run site:build` régénère `index.html`, `favicon.svg` et
`.nojekyll`.

**3. Publier une version** — c'est un acte définitif : `npm run verify` d'abord, la
chaîne d'intégration verte sur le commit visé ensuite.

```bash
git tag v0.1.3 && git push origin v0.1.3
```

`.github/workflows/release.yml` exécute alors : types et tests → paquets
(`dropforge-pwa-<v>.zip`, `dropforge-signaling-<v>.zip`, `SHA256SUMS`) → publication de la
Release, dont les notes sont extraites de [`CHANGELOG.md`](../CHANGELOG.md) pour ce tag.
Une version dont l'archive ne se sert pas ne devient jamais « dernière version ».

Il n'y a **pas d'installateur à signer** : un certificat d'éditeur ne servait qu'à
supprimer l'avertissement d'un exécutable, et il n'y en a plus.

## 11. Déployer soi-même

| Besoin | Méthode | Commande |
| --- | --- | --- |
| Essayer l'application | dossier statique | `npm run build:web` puis servez `apps/web/dist` |
| Transferts à distance sur un réseau | les deux conteneurs | `cd deploy && docker compose up -d --build` → `http://localhost:8080` (`/health` pour le relais) |
| Internet, plusieurs réseaux | application + signalisation, TLS devant | reverse proxy (Caddy, Traefik, nginx) devant le conteneur `web` ; transmettez `/ws` |

Le conteneur `web` sert l'interface **et** relaie `/ws` vers la signalisation : une seule
origine, donc aucune règle CORS à assouplir. Le relais ne stocke aucun fichier : il
transmet des octets chiffrés et rien n'est conservé après la session.

**Coûts et quotas** : tout est utilisable sans payer, et le poste de coût qui existait
(la signature de code Windows) a disparu avec l'installateur. Le détail vérifié (limites
Cloudflare, R2, TURN, hébergeurs statiques) est dans [`TECHNIQUE.md`](TECHNIQUE.md),
section 11. Aucun service n'est requis pour que le produit fonctionne : le cœur
(transfert local et direct) ne dépend d'aucun serveur.
