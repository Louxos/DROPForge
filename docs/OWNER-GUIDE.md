# Guide du propriétaire

Trois choses ne peuvent pas être faites depuis le dépôt : elles demandent les droits du
propriétaire du projet sur GitHub (et, pour la dernière, un achat). Ce guide les prend
dans l'ordre d'importance — chaque étape est indépendante, et **rien ne casse si vous
vous arrêtez après la première**.

| Action | Nécessaire pour | Coût | Temps |
| --- | --- | --- | --- |
| 1. Activer GitHub Pages | Ouvrir DropForge dans un navigateur, sur téléphone | 0 € | 2 min |
| 2. Configurer les clés de mise à jour | Mises à jour Windows signées et vérifiées | 0 € | 10 min |
| 3. Signer l'installateur (certificat d'éditeur) | Supprimer l'avertissement SmartScreen | payant | variable |
| 4. Choisir la licence du projet | Clarifier ce que les autres ont le droit de faire | 0 € | 5 min |

---

## 1. Activer GitHub Pages : DropForge dans un navigateur

**Pourquoi c'est la première étape.** Aujourd'hui, DropForge est téléchargeable (archive
web et installateur), mais la page web hébergée n'existe pas : GitHub Pages doit être
activé **une fois**, et cette activation n'est pas accessible avec les droits d'un agent
d'intégration — elle est réservée au propriétaire du dépôt. Le travail d'intégration
continue de réussir sans elle : il constate l'absence, l'écrit dans son journal, et
s'arrête proprement au lieu d'échouer à chaque envoi.

**Ce qu'il faut faire**

1. Ouvrez `https://github.com/Louxos/DROPForge/settings/pages`.
2. Dans **Build and deployment**, réglez **Source** sur **GitHub Actions**.
   *(Ne choisissez pas « Deploy from a branch » : le projet publie un artefact construit,
   pas une branche.)*
3. Attendez que la page l'indique, puis relancez la publication :
   `https://github.com/Louxos/DROPForge/actions/workflows/pages.yml` → bouton
   **Re-run all jobs** (ou envoyez n'importe quel changement sur `main`).

**Ce que vous obtenez**

- L'application est servie sur `https://louxos.github.io/DROPForge/` : ouvrez cette
  adresse sur un téléphone, et « Installer l'application » (Android/Chrome) ou
  Partager → « Sur l'écran d'accueil » (iOS/Safari) suffit à l'installer ;
- le service worker met l'application en cache : elle se rouvre ensuite même sans réseau ;
- deux appareils peuvent se transférer des fichiers avec cette seule adresse.

**Si le travail « Application web (GitHub Pages) » dit encore que Pages n'est pas
activé** : c'est que l'étape 2 n'a pas été enregistrée, ou que l'onglet a été quitté
avant validation. Recommencez l'étape 2, puis relancez le travail.

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

## Ce qui se passe quand une étape est faite

| Après l'étape | Ce qui change, concrètement |
| --- | --- |
| 1. Pages activé | Le travail `pages.yml` publie au lieu de s'arrêter : l'adresse devient active, l'application s'installe depuis un navigateur |
| 2. Clés configurées | Les versions publiées proposent une mise à jour, signée et vérifiée |
| 3. Certificat | Plus d'avertissement SmartScreen au premier lancement |
| 4. Licence choisie | Le code devient réellement réutilisable selon les termes choisis |

## Rappel : ce qui reste à faire de votre côté, sans GitHub

`docs/PLATFORM-MATRIX.md` tient la liste exacte. En résumé : **lancer l'application
installée sur Windows** et dérouler `docs/TESTING.md` (le poste de travail est la seule
chose que la chaîne d'intégration ne peut pas faire à votre place), puis installer la
PWA sur un téléphone réel. Tout ce qui est découvert là doit être reporté dans
`docs/PLATFORM-MATRIX.md` — c'est le seul document qui décrit l'état réel.
