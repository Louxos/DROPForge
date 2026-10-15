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
[6. Application Windows](#6-application-windows) ·
[7. Dépannage](#7-dépannage) ·
[8. Réparer une installation Windows coincée](#8-réparer-une-installation-windows-coincée) ·
[9. Vos données, et comment tout enlever](#9-vos-données-et-comment-tout-enlever) ·
[10. Propriétaire du dépôt](#10-propriétaire-du-dépôt) ·
[11. Déployer soi-même](#11-déployer-soi-même)

---

## 1. Ce que c'est

DropForge transfère des fichiers d'un appareil à un autre — Windows, Android, iOS,
n'importe quel navigateur — **sans compte obligatoire**, chiffré de bout en bout, et en
direct de machine à machine dès que le réseau le permet. Quand un serveur s'en mêle, il
ne voit jamais le contenu des fichiers.

Un seul nom, deux coques : une **application Windows** (Tauri 2 + Rust) et une
**application web progressive** (PWA) qui partagent exactement la même interface. Les
deux se parlent entre elles.

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

Prérequis : rien pour l'application web ; Windows 10/11 pour l'application Windows
(WebView2 est embarqué dans l'installateur, donc pas de téléchargement au premier
lancement).

| Vous êtes sur | Prenez | Comment |
| --- | --- | --- |
| Ordinateur, téléphone, tablette | **l'application web** | l'adresse publiée (Netlify ou la vôtre, voir § 9 et § 10) ; puis « Installer l'application » (Android/Chrome) ou Partager → « Sur l'écran d'accueil » (iOS/Safari) |
| Windows | **l'installateur** | `DropForge_<version>_x64-setup.exe` (par utilisateur, sans droits administrateur) ou le `.msi`, depuis la [dernière version](https://github.com/Louxos/DROPForge/releases/latest) |
| Un réseau isolé, une clé USB | **l'archive hors ligne** | `dropforge-pwa-<version>.zip`, servie en HTTPS depuis n'importe quel dossier (`npx serve`, `python3 -m http.server`) |
| Deux réseaux différents | **le relais** | `dropforge-signaling-<version>.zip` : `npm install --omit=dev && npm start` |

**Vérifier ce que vous téléchargez** — les sommes de contrôle sont publiées avec les
fichiers, et rien n'est signé par un certificat d'éditeur (payant, optionnel) :

```powershell
# Windows (PowerShell)
Get-FileHash -Algorithm SHA256 .\DropForge_0.1.2_x64-setup.exe
Get-Content .\SHA256SUMS-windows.txt
```

```bash
# Linux, macOS (application web et serveur)
sha256sum -c SHA256SUMS
```

> ⚠️ **La version 0.1.1 a deux défauts connus** (écran de démarrage qui peut rester
> affiché, désinstallation qui refuse en disant que l'application tourne). Ils sont
> corrigés en **0.1.2**. Si vous êtes sur la 0.1.1, lisez le § 6 avant d'installer quoi
> que ce soit ; si vous êtes bloqué, allez directement au § 7.

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

**Et l'application Windows ?** Elle affiche la même interface, et se connecte au même
service : lancez `npm run lan` sur une machine du réseau, puis indiquez son adresse dans
Réglages → Avancé → Adresse du relais (`wss://192.168.1.24:4173/ws`).

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
**adresse du relais** (voir « Le relais », ci-dessous), démarrage automatique (Windows),
comportement à la fermeture, conservation de l'historique, journaux de diagnostic
(désactivés par défaut).

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

## 6. Application Windows

- **Premier lancement** : la fenêtre est demandée **avant tout le reste** ; deux
  contrôles de secours côté Rust l'affichent après 700 ms puis 12 s si personne ne l'a
  demandée. Si l'interface ne démarre pas, l'écran de démarrage **est remplacé par la
  cause réelle** au bout de 15 s (voir § 6).
- **Fermer la fenêtre** ne quitte pas forcément : le réglage « continuer en
  arrière-plan » (par défaut) garde l'application dans la zone de notification, et un
  transfert en cours continue. Pour quitter : menu de l'icône de la zone de
  notification, ou Réglages → « À la fermeture de la fenêtre » → « quitter ».
- **Démarrage automatique** : Réglages → démarrage automatique. Sans argument : au
  démarrage, l'application va dans la zone de notification sans ouvrir de fenêtre.
- **Mises à jour** : vérification à la demande, jamais d'installation silencieuse ;
  une mise à jour n'est appliquée que si sa signature correspond à la clé publique
  embarquée (voir § 9).
- **Journal de diagnostic** : `%APPDATA%\org.dropforge.app\diagnostics.log`, borné,
  sans secret ni contenu de fichier. Il se transmet tel quel pour signaler un problème.

## 7. Dépannage

| Symptôme | Cause | Action |
| --- | --- | --- |
| La fenêtre ne s'ouvre pas | instance invisible, écran secondaire, zone de notification | Gestionnaire des tâches → **Détails** → `DropForge.exe` présent ? cliquez l'icône près de l'horloge. Relancer l'application ramène la fenêtre existante au premier plan |
| **L'écran reste sur « DropForge — démarrage… »** | le paquet de l'interface n'a pas démarré | attendez 15 s : l'écran affiche maintenant **la cause** et le chemin du journal. Cause fréquente : dossier de données inaccessible (antivirus) ou paquet endommagé → réinstaller la dernière version, ou utiliser l'application web |
| **« L'application est en cours d'exécution » à l'installation ou à la désinstallation** | le contrôle de Windows (Restart Manager) voit un fichier `.exe` utilisé — souvent par autre chose que l'application | § 7 |
| Plus rien de DropForge dans « Applications installées » mais l'installation refuse quand même | entrée de registre orpheline | § 7 |
| « Aucun chemin commun disponible » | aucune méthode ne passe | vérifiez que les deux appareils sont sur le même réseau, ou utilisez le relais (le message dit lequel) |
| « Le relais est injoignable » | le service de signalisation est éteint, ou son adresse n'est plus bonne | Réglages → **Adresse du relais** : vérifiez l'adresse utilisée (elle est affichée), ou passez à « Aucun relais » et travaillez sur le même réseau. Rien n'est contacté en dehors de ce réglage |
| « Aucun relais n'est configuré » | le déploiement n'en déclare aucun, et l'adresse est en « Automatique » | normal sur l'application web publiée sans relais : les appareils du même réseau fonctionnent ; sinon indiquez votre adresse de relais dans les réglages, ou déclarez `VITE_SIGNALING_URL` à la compilation (§ 8) |
| « L'appareil est injoignable » | chemin bloqué (pare-feu, NAT) | relancez depuis le même réseau, ou passez par le relais |
| « Les codes ne correspondent pas » | le code de comparaison diffère → signal d'attaque, pas incident réseau | **refusez** et recommencez l'appairage sur un réseau de confiance |
| « Cet appareil a changé » | identifiant connu, empreinte de clé différente | refusez et supprimez l'appareil ; s'il est légitime, réappairez-le |
| « Un fichier existe déjà » | politique de conflit sur « demander » | choisissez renommer / ignorer / remplacer |
| « Le disque est plein » | espace insuffisant | libérez de l'espace ; la reprise repart des plages déjà écrites |
| Un transfert reste à « vérification » | hachage en cours (gros fichier) ou disque lent | attendez la fin ; au-delà du délai, l'état devient `interrupted` avec un code explicite |
| Un transfert s'arrête quand Windows se met en veille | attendu | au retour, relancez : la reprise continue si le fichier partiel est intact |
| Le navigateur ne peut pas mémoriser un dossier | API absente (Firefox, Safari) | les fichiers arrivent par téléchargement ; c'est annoncé dans Réglages |
| « Cette plateforme ne permet pas de rechercher une mise à jour » | application web non installée | installez-la depuis le navigateur, ou utilisez la version Windows |
| « Rien n'est en attente » | aucune clé de mise à jour configurée côté dépôt | voir § 9 (clés de signature) |

**Le réflexe utile, dans tous les cas** : ouvrez
`%APPDATA%\org.dropforge.app\diagnostics.log` et lisez la dernière ligne. Elle nomme
l'étape qui a échoué (`data`, `identity`, `settings`, `updates`, `tray`, `window`,
`interface`, `render`, `startup`, `panic`). C'est plus rapide que réinstaller en boucle.

## 8. Réparer une installation Windows coincée

**Ce qui se passe.** L'installateur et le désinstallateur (modèle NSIS de Tauri) ne
cherchent pas de processus : ils demandent au **Windows Restart Manager** qui utilise
`%LOCALAPPDATA%\DropForge\DropForge.exe`. Dès qu'une réponse arrive, ils affichent
« l'application est en cours d'exécution » et s'arrêtent — **même quand DropForge ne
tourne pas**. Tiennent ce fichier, tour à tour : une instance restée en arrière-plan (le
réglage « continuer en arrière-plan » la garde vivante), le démarrage automatique, un
antivirus qui l'analyse, l'Explorateur, ou une version précédente jamais refermée.

**Pourquoi supprimer les fichiers à la main ne suffit pas.** L'entrée de
désinstallation reste dans le registre
(`HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\DropForge`). Windows continue
de proposer une désinstallation qui vise un fichier absent, et la page de réinstallation
de l'installateur, qui ne consulte **que le registre**, propose de désinstaller d'abord
une installation qui n'existe plus.

**Corrigé en 0.1.2** (et c'est le cas de la version que vous installez maintenant) : le
hook `apps/desktop/src-tauri/installer/hooks.nsh` ferme l'application, puis **écarte
l'exécutable du chemin exact que le contrôle interroge** (`DropForge.exe` →
`DropForge.exe.df-ecarte`) : un fichier renommé n'a plus d'utilisateurs, donc le
contrôle passe. Le fichier écarté est supprimé juste après, et si le renommage échoue
parce qu'un autre programme tient réellement le fichier, le journal d'installation le
dit au lieu de laisser croire à une application fantôme.

### Si vous êtes bloqué maintenant — par ordre d'effort

1. **Cliquez « OK »** (pas « Annuler ») dans la boîte « fermer l'application » : OK
   demande à Windows de fermer les programmes qui tiennent le fichier.
2. **Fermez l'application et recommencez** : `taskkill /F /IM DropForge.exe` dans une
   invite de commandes, puis relancez la désinstallation.
3. **Écartez le fichier à la main** :
   `ren "%LOCALAPPDATA%\DropForge\DropForge.exe" DropForge.exe.ecarte`, puis relancez.
4. **Le script du dépôt** — il **constate d'abord**, ne modifie rien sans `-Apply`, et
   demande confirmation à chaque étape :

   ```powershell
   # 1) constat : ne modifie rien
   powershell -ExecutionPolicy Bypass -File scripts\unblock-windows.ps1
   # 2) nettoyage, confirmé étape par étape
   powershell -ExecutionPolicy Bypass -File scripts\unblock-windows.ps1 -Apply
   # 3) et, si vous voulez aussi effacer l'historique et les appareils de confiance
   powershell -ExecutionPolicy Bypass -File scripts\unblock-windows.ps1 -Apply -RemoveData
   ```

   Il traite, dans l'ordre : processus, entrées de désinstallation, démarrage
   automatique, dossiers du programme, raccourcis, données locales (sur demande). Il ne
   touche **jamais** aux fichiers que vous avez reçus (Téléchargements, Documents,
   Bureau). Téléchargement direct :
   <https://raw.githubusercontent.com/Louxos/DROPForge/main/scripts/unblock-windows.ps1>
   — clic droit → **Propriétés** → cochez **Débloquer** avant de l'exécuter.

5. **Les mêmes gestes à la main** (invite de commandes, sans droits administrateur :
   l'installation est « par utilisateur »). Les messages « introuvable » sont normaux :
   l'élément était déjà parti.

   ```bat
   taskkill /F /IM DropForge.exe
   taskkill /F /IM dropforge.exe
   reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\DropForge" /f
   reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v DropForge /f
   rmdir /s /q "%LOCALAPPDATA%\DropForge"
   rmdir /s /q "%ProgramFiles%\DropForge"
   del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\DropForge.lnk"
   del "%USERPROFILE%\Desktop\DropForge.lnk"
   ```

   Et seulement si vous voulez aussi effacer les données locales :

   ```bat
   rmdir /s /q "%APPDATA%\org.dropforge.app"
   rmdir /s /q "%LOCALAPPDATA%\org.dropforge.app"
   ```

6. **Ne réinstallez pas en boucle** : chaque tentative laisse une entrée de registre
   supplémentaire. Terminez le nettoyage d'abord.

Après le nettoyage, la page de réinstallation ne voit plus d'installation précédente :
l'installation repart proprement.

## 9. Vos données, et comment tout enlever

| Quoi | Où |
| --- | --- |
| Historique, appareils de confiance, réglages, points de reprise | `%APPDATA%\org.dropforge.app` (SQLite) — ou IndexedDB dans le navigateur |
| Programme installé | `%LOCALAPPDATA%\DropForge` (ou `%ProgramFiles%\DropForge` si installé pour tout le monde) |
| Journal de diagnostic | `%APPDATA%\org.dropforge.app\diagnostics.log` |
| **Fichiers que vous recevez** | le dossier de réception que **vous** avez choisi (Téléchargements par défaut) — **aucune désinstallation n'y touche** |

La désinstallation propose (case **décochée**) de supprimer les données locales. Sans
cette case, historique, appareils de confiance et réglages restent en place — ce qui
sert à réinstaller sans tout reperdre. Rien de tout cela n'est envoyé où que ce soit :
voir [`TECHNIQUE.md`](TECHNIQUE.md), section 6.

## 10. Propriétaire du dépôt

Trois choses seulement ne peuvent pas être faites par un agent : deux secrets et une
décision.

| # | Action | Nécessaire pour | Coût |
| --- | --- | --- | --- |
| 1 | **Brancher l'application web** (Netlify) | Une adresse publique pour la PWA | 0 € |
| 2 | **Clés de mise à jour** (3 secrets GitHub) | Mises à jour Windows signées et vérifiées | 0 € |
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
est réglé sur **« Deploy from a branch »**, branche `main`, dossier `/` : Pages sert
`index.html` (généré par `scripts/build-site.mjs` depuis [`site/`](../site)), et le
README seulement s'il est absent. `.nojekyll` évite que Jekyll réécrive la page.

> **Les deux réglages de Pages s'excluent :** « Deploy from a branch » publie la page
> d'accueil ; « GitHub Actions » publierait l'application PWA à la place (c'est ce que
> fait `pages.yml` quand on lui en donne l'autorisation). Avec l'application sur
> Netlify, gardez « Deploy from a branch ». Si la branche publiée disparaît, repassez la
> même source sur `main` — les fichiers publiés y sont identiques.

`npm run check:site` (inclus dans `npm run verify`) refuse une page désynchronisée de
ses sources, et `npm run site:build` régénère `index.html`, `favicon.svg` et
`.nojekyll`.

**3. Les clés de mise à jour signées** (facultatives ; sans elles, aucune mise à jour
automatique n'est proposée — l'écran « À propos » le dit) :

```bash
npm run tauri signer generate -w ~/.dropforge/updater.key
```

Trois secrets dans *Settings → Secrets and variables → Actions* :
`DROPFORGE_UPDATER_KEY` (clé **privée**, à garder hors du dépôt),
`DROPFORGE_UPDATER_KEY_PASSWORD`, `DROPFORGE_UPDATER_PUBKEY` (clé publique). La chaîne
écrit alors une configuration temporaire (`.gitignore` :
`apps/desktop/src-tauri/tauri.updater.conf.json`) et publie `latest.json` avec les
signatures réellement produites. Une signature qui ne correspond pas est **rejetée** :
ne désactivez jamais cette vérification pour « faire passer » une version.

**4. Publier une version** — c'est un acte définitif : `npm run verify` et
`npm run ci`… d'abord, la chaîne d'intégration verte sur le commit visé ensuite.

```bash
git tag v0.1.2 && git push origin v0.1.2
```

`.github/workflows/release.yml` exécute alors : types et tests → paquets web
(`dropforge-pwa-<v>.zip`, `dropforge-signaling-<v>.zip`, `SHA256SUMS`) → installateur
Windows (+ artefact de mise à jour si les secrets sont là) → publication de la Release,
dont les notes sont extraites de [`CHANGELOG.md`](../CHANGELOG.md) pour ce tag.

**5. Signer l'installateur** (facultatif, payant) : un certificat de signature de code
supprime l'avertissement SmartScreen. C'est indépendant des clés de mise à jour, qui
sont gratuites.

## 11. Déployer soi-même

| Besoin | Méthode | Commande |
| --- | --- | --- |
| Essayer l'application | dossier statique | `npm run build:web` puis servez `apps/web/dist` |
| Transferts à distance sur un réseau | les deux conteneurs | `cd deploy && docker compose up -d --build` → `http://localhost:8080` (`/health` pour le relais) |
| Internet, plusieurs réseaux | application + signalisation, TLS devant | reverse proxy (Caddy, Traefik, nginx) devant le conteneur `web` ; transmettez `/ws` |

Le conteneur `web` sert l'interface **et** relaie `/ws` vers la signalisation : une seule
origine, donc aucune règle CORS à assouplir. Le relais ne stocke aucun fichier : il
transmet des octets chiffrés et rien n'est conservé après la session.

**Coûts et quotas** : tout est utilisable sans payer. Le détail vérifié (limites
Cloudflare, R2, TURN, hébergeurs statiques, le seul poste de coût réel — la signature de
code Windows) est dans [`TECHNIQUE.md`](TECHNIQUE.md), section 11. Aucun service n'est requis pour que le produit fonctionne : le cœur
(transfert local et direct) ne dépend d'aucun serveur.
