# Guide du propriétaire

Trois choses ne peuvent pas être faites depuis le dépôt : elles demandent les droits du
propriétaire du projet sur GitHub (et, pour la dernière, un achat). Ce guide les prend
dans l'ordre d'importance — chaque étape est indépendante, et **rien ne casse si vous
vous arrêtez après la première**.

| Action | Nécessaire pour | Coût | Temps |
| --- | --- | --- | --- |
| 1. GitHub Pages : page d'accueil publique | Page premium du projet, avec l'adresse de l'application web | 0 € | 2 min |
| 2. Configurer les clés de mise à jour | Mises à jour Windows signées et vérifiées | 0 € | 10 min |
| 3. Signer l'installateur (certificat d'éditeur) | Supprimer l'avertissement SmartScreen | payant | variable |
| 4. Choisir la licence du projet | Clarifier ce que les autres ont le droit de faire | 0 € | 5 min |

---

## 1. GitHub Pages : la page d'accueil publique (faite), et le choix à connaître

**État réel.** GitHub Pages est activé. Sa source est réglée sur **« Deploy from a
branch »**, branche `arena/32d42310-dropforge`, dossier `/` — c'est le réglage qui
publie la **page d'accueil du projet** :

> **https://louxos.github.io/DROPForge/**

Cette page est la vitrine : le logo, ce que DropForge fait, ce qu'il ne fait pas, l'état
réel du projet, l'avertissement sur l'application Windows, et — tout en haut — le bloc
« L'application web » avec son adresse et les deux chemins possibles (ouvrir
l'application web, ou télécharger le logiciel).

**Votre action, quand l'application web sera en ligne** (Netlify, [`docs/NETLIFY.md`](NETLIFY.md)) :

1. ouvrez `docs/site/app-url.txt` et collez l'adresse sur une seule ligne, par exemple
   `https://dropforge.netlify.app` ;
2. lancez `npm run site:build` — la page est régénérée à la racine (`index.html`) et
   `npm run check:site` refuse une adresse impossible (pas de `http://`, pas de lien
   mort, pas cette page elle-même) ;
3. envoyez `index.html` sur la branche publiée par Pages ; la publication prend une minute.

Tant que ce fichier ne contient qu'une adresse vide, la page affiche
« **Application web · bientôt** » à la place du bouton : jamais un lien mort.

**Le choix à connaître — les deux réglages de Pages s'excluent.** GitHub Pages ne sert
qu'un seul contenu à la racine du site :

| Source réglée dans Pages | Ce qui est servi à l'adresse | Le reste |
| --- | --- | --- |
| **Deploy from a branch** → `arena/32d42310-dropforge` → `/` *(réglage actuel)* | la page d'accueil `index.html` | l'application web reste sur Netlify (ou dans l'archive hors ligne) |
| **GitHub Actions** | l'application web progressive construite par `pages.yml` (installable directement depuis cette adresse) | la page d'accueil n'est plus servie par Pages |

Les deux sont valables ; ils ne peuvent pas cohabiter. La configuration actuelle est
celle qui correspond à la demande faite ici : **une page premium sur GitHub Pages, et
l'application sur Netlify**. Si vous préférez un jour servir l'application depuis
GitHub Pages, réglez **Source** sur **GitHub Actions** dans
`https://github.com/Louxos/DROPForge/settings/pages` et relancez le travail
`pages.yml` : l'application prend la place de la page d'accueil.

**Après la fusion de la branche de travail dans `main`** : si la branche
`arena/32d42310-dropforge` venait à disparaître, la publication s'arrêterait. Dans ce
cas, repassez la même source sur **`main`** (les fichiers publiés y seront identiques).

**Si un jour la page d'accueil n'affiche plus le bon contenu** : vérifiez qu'`index.html`
et `.nojekyll` sont bien présents à la racine (`npm run site:build` les recrée, et
`npm run check:site` — inclus dans `npm run verify` — refuse une page désynchronisée de
ses sources).

> HTTPS est fourni par GitHub Pages. Ce n'est pas un détail : sans HTTPS le navigateur
> refuse le presse-papiers, les notifications, le service worker et l'installation. Une
> application servie en HTTP simple ne peut pas fonctionner complètement.

---

## 2. Configurer les mises à jour signées (Windows)

**Pourquoi.** L'application Windows sait se mettre à jour, mais uniquement si elle peut
**vérifier** la mise à jour. La clé publique de vérification est compilée dans le
binaire : sans elle, DropForge refuse toute mise à jour et le dit. Sans les secrets
ci-dessous, l'installateur publié fonctionne, mais ne propose aucune mise à jour.

**Ce qu'il faut faire**

1. Sur votre machine, générez une paire de clés (l'outil vient avec les dépendances) :

   ```bash
   npm run tauri -w @dropforge/desktop -- signer generate -w ~/.dropforge/updater.key
   ```

   Il produit `updater.key` (clé **privée**, à ne jamais mettre dans le dépôt) et
   `updater.key.pub` (clé **publique**).

   > Choisissez un mot de passe quand l'outil le propose, et conservez-le : il est
   > demandé à chaque publication. **Sauvegardez les deux fichiers ailleurs que sur
   > cette machine** : perdre la clé privée signifie ne plus pouvoir publier de mise à
   > jour que les installations existantes accepteront (il faudrait alors réinstaller
   > l'application à la main, et l'annoncer).

2. Ajoutez trois secrets de dépôt :
   `https://github.com/Louxos/DROPForge/settings/secrets/actions` → **New repository
   secret**, une fois par ligne :

   | Nom | Valeur |
   | --- | --- |
   | `DROPFORGE_UPDATER_KEY` | le contenu complet de `updater.key` |
   | `DROPFORGE_UPDATER_KEY_PASSWORD` | le mot de passe choisi (vide si aucun) |
   | `DROPFORGE_UPDATER_PUBKEY` | le contenu complet de `updater.key.pub` |

3. Publiez une version : `git tag v0.1.1 && git push origin v0.1.1` (ou lancez le
   travail **Release** avec la version souhaitée). À partir de cette version, les
   installations proposent la mise à jour, l'utilisateur décide, et l'application ne
   l'applique qu'après avoir vérifié la signature.

**Ce que la chaîne fait à votre place** : elle compile avec la clé privée, signe
l'archive de mise à jour, publie `latest.json` et les sommes de contrôle, et **ne
publie jamais** la clé privée (elle ne quitte pas l'étape de compilation).

---

## 3. Signer l'installateur (facultatif, payant)

**Ce que cela change.** Aujourd'hui, Windows affiche « Éditeur inconnu » au premier
lancement, parce que l'installateur n'est pas signé par un certificat d'éditeur. Rien
n'est cassé : le fichier vient de GitHub, ses sommes de contrôle sont publiées, et vous
pouvez les vérifier (`docs/DOWNLOAD.md`). C'est un avertissement de réputation, pas une
erreur.

**Options, à vérifier au moment où vous décidez** (les offres changent) :

| Option | Principe | Coût |
| --- | --- | --- |
| Certificat OV/EV classique | Un certificat, installé sur la machine qui signe | payant, annuel |
| Azure Trusted Signing | Signature par un service, identité vérifiée | abonnement, à vérifier |
| SignPath Foundation | Signature gratuite pour les projets open source éligibles | 0 € si éligible |

**Comment l'intégrer, une fois un certificat obtenu** : DropForge ne met pas de secret
en dur. Deux chemins, au choix dans `.github/workflows/release.yml` :

- `bundle.windows.certificateThumbprint` : l'empreinte du certificat, installé dans le
  magasin de la machine qui compile (le certificat lui-même arrive par un secret) ;
- `bundle.windows.signCommand` : une commande de signature externe, pour un service.

Dans les deux cas, la vérification de signature des **mises à jour** reste celle de la
clé publique compilée dans le binaire : elle ne peut pas être désactivée, et elle est
indépendante de la signature de l'installateur.

---

## 4. Choisir la licence du projet

Le dépôt n'a **pas** de licence. Tel quel, personne ne peut légalement réutiliser,
modifier ou redistribuer le code, même s'il est public. `package.json` le dit et renvoie
vers `docs/LICENCES.md`.

Pour choisir en connaissance de cause : `docs/DEPENDENCIES.md` liste toutes les
dépendances et leurs licences (aucune copyleft forte), et `docs/LICENCES.md` détaille
les dépendances directes.

Si vous voulez rester simple :

- **MIT** : la plus permissive, la plus courte, celle qui demande le moins de lecture ;
- **Apache-2.0** : équivalent en pratique, avec en plus une clause explicite sur les
  brevets ;
- **GPL-3.0** : tout dérivé distribué doit rester libre — cohérent avec un projet
  gratuit, plus contraignant pour les réutilisations.

Une fois choisie : ajoutez le fichier `LICENSE` à la racine, remplacez
`"license": "SEE LICENSE IN docs/LICENCES.md"` dans `package.json` par l'identifiant
choisi (`MIT`, `Apache-2.0`, `GPL-3.0-only`…), et retirez la phrase correspondante du
`README.md`.

---

## 5. Réinitialiser Windows quand une installation précédente coince

**Dépannage, pas une action du cahier des charges** — mais c'est ce qui débloque un
poste. Symptômes couverts : « l'application est en cours d'exécution » alors qu'elle ne
tourne pas, désinstallation refusée, réinstallation impossible après une suppression de
fichiers faite à la main. La cause et la correction dans l'installateur sont expliquées
dans [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md) (section « deux défauts connus »).

**Le script du dépôt** fait le constat, puis le nettoyage — seulement si on le lui
demande, et étape par étape :

```powershell
powershell -ExecutionPolicy Bypass -File scripts\unblock-windows.ps1         # constat : rien n'est modifié
powershell -ExecutionPolicy Bypass -File scripts\unblock-windows.ps1 -Apply  # nettoyage, confirmé à chaque étape
```

Il ne supprime que les dossiers du programme, les raccourcis, l'entrée de
désinstallation, l'entrée de démarrage automatique et les processus DropForge. Les
**fichiers reçus** (Téléchargements, Documents, Bureau) ne sont jamais touchés, et les
**données locales** (historique, appareils de confiance, réglages) ne partent qu'avec
`-RemoveData`.

**Commandes équivalentes**, à lire avant de les coller (invite de commandes du
propriétaire du poste, sans droits administrateur : l'installation est « par
utilisateur ») :

```bat
taskkill /F /IM DropForge.exe
taskkill /F /IM dropforge.exe
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\DropForge" /f
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v DropForge /f
rmdir /s /q "%LOCALAPPDATA%\DropForge"
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\DropForge.lnk"
del "%USERPROFILE%\Desktop\DropForge.lnk"
```

Pour supprimer **aussi** l'historique et les appareils de confiance :

```bat
rmdir /s /q "%APPDATA%\org.dropforge.app"
rmdir /s /q "%LOCALAPPDATA%\org.dropforge.app"
```

Ensuite, la page de réinstallation de l'installateur ne voit plus d'installation
précédente : l'installation repart proprement.

## Ce qui se passe quand une étape est faite

| Après l'étape | Ce qui change, concrètement |
| --- | --- |
| 1. Pages publié | `https://louxos.github.io/DROPForge/` sert la page d'accueil du projet (mode branche). Les deux réglages possibles sont décrits au § 1 |
| 2. Clés configurées | Les versions publiées proposent une mise à jour, signée et vérifiée |
| 3. Certificat | Plus d'avertissement SmartScreen au premier lancement |
| 4. Licence choisie | Le code devient réellement réutilisable selon les termes choisis |

## Rappel : ce qui reste à faire de votre côté, sans GitHub

`docs/PLATFORM-MATRIX.md` tient la liste exacte. En résumé : **lancer l'application
installée sur Windows** et dérouler `docs/TESTING.md` (le poste de travail est la seule
chose que la chaîne d'intégration ne peut pas faire à votre place), puis installer la
PWA sur un téléphone réel. Tout ce qui est découvert là doit être reporté dans
`docs/PLATFORM-MATRIX.md` — c'est le seul document qui décrit l'état réel.
