# Publier DropForge sur Netlify

**Ce que Netlify publie : l'application web (PWA), et rien d'autre.** C'est le seul
morceau de DropForge qui se sert dans un navigateur. Le fichier `netlify.toml` à la
racine du dépôt contient déjà tout ce qu'il faut — Netlify le lit tout seul.

| Ce que vous voulez | Où ça se publie |
| --- | --- |
| L'application web installable (téléphone, tablette, autre ordinateur) | **Netlify**, avec ce fichier |
| L'installateur Windows (`.exe`, `.msi`) | Page des versions GitHub (`v0.1.1`), produite par la tâche « Application Windows » |
| Le service de signalisation (le relais) | **Ailleurs** — voir § 3. Les fonctions Netlify sont des requêtes HTTP courtes : elles ne peuvent pas garder une connexion WebSocket ouverte |

## 1. Créer le site

1. Netlify → **Add new site** → **Import an existing project** → GitHub → `Louxos/DROPForge`.
2. **Branche** : celle que vous voulez publier (`arena/32d42310-dropforge` pour l'état
   actuel, `main` une fois fusionnée).
3. Les réglages de compilation sont déjà dans `netlify.toml` :

   | Réglage | Valeur | Où c'est écrit |
   | --- | --- | --- |
   | Commande de compilation | `npm run build:web` | `[build] command` |
   | Dossier publié | `apps/web/dist` | `[build] publish` |
   | Node | 22 | `[build.environment] NODE_VERSION` |
   | Chemin de base | `/` | `[build.environment] DROPFORGE_BASE` |

   Si Netlify vous propose d'autres valeurs, laissez celles du fichier — elles l'emportent.
4. **Deploy**. Le site s'ouvre en HTTPS, et c'est tout : l'application s'installe
   (service worker, manifeste, icône d'accueil), fonctionne **hors ligne**, et se met à
   jour par le bouton « Rechercher une mise à jour » des Réglages.

Il n'y a **aucune ressource externe** dans le site publié : pas de police distante, pas
de CDN, pas de script d'analyse, pas de compte. Le dossier `apps/web/dist` se suffit à
lui-même.

> **Dernière étape, une fois le site créé** : collez l'adresse obtenue (par exemple
> `https://dropforge.netlify.app`) dans [`site/app-url.txt`](site/app-url.txt), lancez
> `npm run site:build`, puis envoyez `index.html`. C'est cette unique constante que la
> page d'accueil publiée (`https://louxos.github.io/DROPForge/`) affiche en haut, dans
> son bloc « L'application web ».

## 2. Ce qui marche, et ce qui ne marche pas, une fois publié

| Fonction | État | Pourquoi |
| --- | --- | --- |
| Ouvrir l'application, l'installer, s'en servir hors ligne | ✅ | Rien ne dépend du réseau pour se charger |
| Transfert entre deux appareils **du même réseau local** | ✅ | Les appareils se trouvent directement ; le service de signalisation local n'est pas nécessaire |
| Transfert par code d'appairage entre deux réseaux différents | ❌ | Il faut un service de signalisation joignable (§ 3) |
| Mise à jour de l'application | ✅ | Le service worker est revalidé à chaque visite (`netlify.toml`), l'installation propose la nouvelle version |
| Installateur Windows | — | Il n'est pas ici : voir la page des versions GitHub |

Sans service de signalisation, l'écran Transfert affiche **« Aucun appareil joignable
pour le moment »** et les Réglages expliquent pourquoi. C'est la vérité : rien n'est
simulé, aucun bouton ne semble marcher puis échoue.

## 3. Rendre les transferts possibles hors réseau local

L'application cherche le service de signalisation sur **sa propre origine**
(`wss://votre-site.netlify.app/ws`). Netlify ne l'héberge pas et ne peut pas le
relayer : les redirections de Netlify transmettent du HTTP, pas les WebSocket. Il faut
donc un relais ailleurs, puis le déclarer :

1. Déployez le relais (conteneur fourni ou paquet publié) :

   ```bash
   # ce dépôt, la voie la plus simple :
   cd deploy && docker compose up -d --build
   # ou, sans Docker : le paquet `dropforge-signaling-<version>.zip` de la Release
   #   npm ci --omit=dev && PORT=8787 node apps/signaling/src/main.js
   ```

   Il doit être joignable en **`wss://`** (TLS) : un navigateur servi en HTTPS refuse
   une connexion `ws://` non chiffrée. Un reverse proxy (Caddy, Traefik, nginx) devant
   le relais suffit — le `README.md` de `deploy/` explique comment.

2. Dans Netlify : **Site configuration → Environment variables → Add a variable**

   | Clé | Valeur (exemple) |
   | --- | --- |
   | `VITE_SIGNALING_URL` | `wss://relais.mondomaine.fr/ws` |

   Puis **Deploys → Trigger deploy → Clear cache and deploy site** (la valeur est
   compilée dans l'application, elle n'est pas lue à l'exécution).

3. Vérifiez : sur le relais, `https://relais.mondomaine.fr/health` doit répondre
   `{"ok":true,…}`. Dans l'application, le code d'appairage affiché par un appareil doit
   être accepté par un autre, même sur un autre réseau.

> Sur iOS et Android, un transfert entre deux appareils **du même réseau** fonctionne
> sans relais. C'est le cas d'usage principal ; le relais sert aux autres.

## 4. Domaine personnalisé

**Domain management → Add a domain.** Netlify fournit le certificat TLS. Rien à changer
dans le dépôt : le chemin de base est `/`, quel que soit le domaine. Si vous changez
d'adresse, pensez à mettre à jour `VITE_SIGNALING_URL` si le relais est servi sous un
autre domaine — sinon, rien.

## 5. Aperçus de branche (deploy previews)

Chaque aperçu est servi depuis **sa propre adresse**, donc depuis une autre origine :

- l'identité de l'appareil y est différente (elle est stockée par origine) : un aperçu
  n'est pas « le même appareil » que le site de production ;
- un appareil appairé sur l'aperçu devra être approuvé de nouveau sur la production
  (c'est le principe : une identité, un appareil, une approbation) ;
- si vous voulez tester un aperçu de bout en bout, donnez-lui aussi
  `VITE_SIGNALING_URL` — ses variables d'environnement sont celles du contexte de
  déploiement.

## 6. Mises à jour et cache

Deux en-têtes de `netlify.toml` portent une promesse du produit :

- `/sw.js` et `/registerSW.js` : `must-revalidate`. Un service worker servi depuis le
  cache du navigateur, c'est une nouvelle version que **personne ne voit jamais** ;
- `/assets/*` et `/workbox-*.js` : `immutable` un an. Ces fichiers portent une empreinte
  de contenu dans leur nom : leur contenu ne change pas sous le même nom.

Une nouvelle compilation publie de nouveaux noms de fichiers ; le service worker les
précache, et l'application propose la mise à jour au lieu de recharger la page en plein
transfert (c'est `registerType: 'prompt'` dans `apps/web/vite.config.ts`).

## 7. En-têtes de sécurité, et pourquoi il n'y a pas de CSP

`netlify.toml` pose `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` et
`X-Frame-Options: SAMEORIGIN` pour tout le site.

Il n'y a **pas** de `Content-Security-Policy` : une politique mal écrite casserait
l'application en silence (service worker, WebSocket, téléchargements par `blob:`), et
elle doit citer l'adresse du relais, choisie après coup. Pour la durcir vous-même, la
politique minimale qui fonctionne est :

```
default-src 'self';
connect-src 'self' wss: https:;      /* wss: couvre le relais, quel qu'il soit */
img-src 'self' data: blob:;
style-src 'self' 'unsafe-inline';    /* styles posés par React */
script-src 'self';
worker-src 'self' blob:;             /* service worker */
frame-ancestors 'self';
```

Vérifiez-la **sur un aperçu** avant de la mettre en production : la console du
navigateur dit immédiatement ce qui a été bloqué.

## 8. Coûts et limites

Le site est entièrement statique : aucune fonction Netlify, aucune base de données,
aucun stockage. Il faut donc regarder le palier gratuit de Netlify (bande passante et
minutes de compilation mensuelles) : ces quotas changent, et `docs/FREE-DEPLOYMENT.md`
renvoie à leur page tarifaire plutôt que de citer des chiffres qui vieillissent. Le
relais, lui, tourne ailleurs (§ 3) — c'est lui qui a besoin d'un serveur permanent.

Si un jour Netlify devient payant pour votre usage, rien ne dépend de Netlify : le même
dossier `apps/web/dist` se sert depuis n'importe quel hébergeur statique, y compris
`python3 -m http.server` sur un ordinateur du réseau local.

## 9. En cas de problème

| Symptôme | Cause probable | Solution |
| --- | --- | --- |
| Page blanche | Le dossier publié n'est pas `apps/web/dist` | Vérifiez `[build] publish` dans `netlify.toml` ; la compilation doit afficher `dist/index.html` |
| La page charge mais rien ne s'installe | Le site n'est pas en HTTPS, ou le service worker a été refusé | L'adresse `*.netlify.app` est toujours en HTTPS ; vérifiez la console |
| « Aucun appareil joignable » | Aucun service de signalisation joignable | § 3 : déployez le relais et posez `VITE_SIGNALING_URL` (puis redéployez sans cache) |
| Un lien `/reglages` renvoie 404 | La réécriture n'a pas été appliquée | Elle est dans `netlify.toml` (`[[redirects]]`) : vérifiez que le fichier est bien à la racine du dépôt |
| Une mise à jour ne se voit pas | Le site a été servi depuis un cache intermédiaire | Vérifiez l'en-tête `Cache-Control` de `/sw.js` (doit être `must-revalidate`) |
