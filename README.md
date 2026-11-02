<p align="center">
  <img src="apps/web/public/icons/icon-192.png" alt="DropForge" width="96" height="96" />
</p>

# DropForge

**Transférez vos fichiers simplement, rapidement, et en toute sécurité.**

DropForge envoie des fichiers entre vos appareils — Windows, Android, iOS, n'importe quel
navigateur — sans compte obligatoire, sans service payant, et en privilégiant le transfert
direct d'un appareil à l'autre. Quand un serveur s'en mêle, il ne voit jamais le contenu
des fichiers.

<p align="center">
  <em>Une application web installable (PWA) : rien à télécharger, rien à installer —
  l'interface s'installe depuis le navigateur, sur ordinateur comme sur téléphone.</em>
</p>

---

## Documentation — quatre documents, pas plus

| Document | Contenu |
| --- | --- |
| **[docs/GUIDE.md](docs/GUIDE.md)** | Installer, s'en servir, mode « même Wi‑Fi », **dépannage**, publier, déployer |
| **[docs/TECHNIQUE.md](docs/TECHNIQUE.md)** | Architecture, comportement, données, sécurité, plateformes, tests, **état réel du projet**, annexes générées (dépendances, licences) |
| **[CHANGELOG.md](CHANGELOG.md)** | Ce qui a changé, version par version — c'est aussi le texte des notes de version publiées |
| **[Site public](https://louxos.github.io/DROPForge/)** | La vitrine, et **[l'application](https://louxos.github.io/DROPForge/app/)** — les deux servies par GitHub Pages |

## Télécharger

| Vous êtes sur | Prenez | Comment |
| --- | --- | --- |
| **Ordinateur, téléphone, tablette** | l'application web | <https://louxos.github.io/DROPForge/app/> — puis « Installer l'application » / « Sur l'écran d'accueil ». Hébergée par GitHub Pages, sur le même site que cette page (voir [docs/GUIDE.md](docs/GUIDE.md) § 10) |
| **Un réseau isolé** | l'archive hors ligne | `dropforge-pwa-<version>.zip` de la dernière version, servi en **HTTPS** depuis n'importe quel dossier |
| **Deux réseaux différents** | le serveur optionnel | `dropforge-signaling-<version>.zip` : `npm install --omit=dev && npm start` |
| **Un serveur à vous** | les conteneurs | `cd deploy && docker compose up -d --build` → `http://localhost:8080` |

Installation depuis le navigateur, sommes de contrôle et dépannage :
[docs/GUIDE.md](docs/GUIDE.md) § 2 et § 7.

## État réel du projet

DropForge n'est **pas** encore une 1.0, et il le dit. Version actuelle : **0.2.0**.

| Partie | Statut |
| --- | --- |
| Moteur de transfert (chiffrement de bout en bout, reprise, vérification SHA-256, file d'attente) | ✅ Implémenté et **testé** (470 tests automatisés, 43 fichiers) |
| Interface partagée React/TypeScript (FR/EN, thèmes sombre et clair) | ✅ Implémentée et **testée** au niveau du contrôleur et du rendu |
| Application web progressive (PWA) installable | ✅ Implémentée et **testée** — pas encore essayée sur un téléphone réel |
| Site publié sur GitHub Pages (accueil, application sous `/app/`, page 404) | ✅ Construit, vérifié **avant et après** chaque publication, sans hébergeur tiers |
| Serveur de signalisation / relais aveugle (Node) | ✅ Implémenté et **testé** |
| Tests dans un vrai navigateur (E2E) | ✅ **Exécutés à chaque envoi** : Chromium, Firefox, WebKit (iPhone), transfert réel avec octets reçus hachés et comparés |
| Tests sur appareils mobiles réels | ❌ Non exécutés — l'émulation est couverte, pas un vrai iPhone/Android |
| Liens de partage hébergés | ⚠️ Code client implémenté et testé ; nécessite un hébergement (optionnel) |

Le détail exigence par exigence, avec ce qui manque pour une 1.0 :
[docs/TECHNIQUE.md](docs/TECHNIQUE.md) § 10.

## Comment DropForge se connecte

Dans l'ordre, **la première méthode qui fonctionne réellement** :

1. **Réseau local** — les deux appareils sont sur le même réseau : le transfert ne sort
   jamais du réseau local.
2. **Direct (WebRTC)** — réseaux différents : un canal chiffré de bout en bout est négocié
   avec l'aide d'un serveur de signalisation qui ne voit passer que de la négociation.
3. **Relais aveugle** — quand la connexion directe est impossible : le serveur relaie des
   octets déjà chiffrés qu'il ne peut pas lire.

Si aucune méthode ne fonctionne, DropForge le dit clairement et propose une alternative.
**Il n'affirme jamais qu'un réseau autorise la connexion directe.**

## Démarrage rapide (développement)

Prérequis : **Node 22+** et npm. Rien d'autre : ni Rust, ni machine Windows.

```bash
npm install

npm run dev            # application web + signalisation (une seule commande)
npm run dev:web        # application web seule → http://localhost:5173
npm run dev:signaling  # signalisation seule → http://localhost:8787

npm run verify         # ce que la chaîne exige : types, contrôle du site, 470 tests
npm test               # 43 fichiers, 470 tests
npm run test:e2e       # navigateurs réels (Chromium, Firefox, WebKit) — à installer une fois :
npm run test:e2e:install

npm run build          # application web + serveur
npm run package        # archives web + serveur et sommes de contrôle dans release/

npm run build:pages    # le site publié : accueil + application + page 404, dans _site/
npm run preview:pages  # ce site, servi sous /DROPForge/ comme sur GitHub Pages
npm run check:pages    # construit et vérifie le site sous son vrai chemin
```

Pour utiliser DropForge entre deux appareils, ouvrez l'application sur les deux. Le serveur
de signalisation n'est nécessaire que pour les transferts **distants** : sur le même réseau
local, l'application fonctionne sans lui.

## Structure du dépôt

| Emplacement | Contenu |
| --- | --- |
| `packages/*` | Le métier, sans React ni DOM : `protocol`, `security`, `app-core`, `transfer-engine`, `connection-manager`, `device-manager`, `history`, `settings`, `sharing`, `notifications`, `design-system` |
| `apps/web` | Application web progressive (React + Vite) — l'interface partagée |
| `apps/signaling` | Serveur de signalisation / relais aveugle (Node, WebSocket) |
| `deploy/` | nginx, Dockerfiles et `docker-compose.yml` : tout sur une seule origine |
| `site/` | Gabarits de la page publique et de la page 404, avec leur feuille de style |
| `_site/` | Le site assemblé par `npm run build:pages` (jamais versionné) : accueil, 404, application sous `app/` |
| `e2e/` | Tests de bout en bout dans de vrais navigateurs |
| `scripts/` | Outils : icônes, paquets, page publiée, inventaire des dépendances, fichiers d'aide du navigateur |

## Sécurité et confidentialité

Aucun compte obligatoire, aucune télémétrie — ni par défaut ni en option. Le contenu est
chiffré de bout en bout (WebCrypto et `@noble/hashes`, aucun algorithme maison), les clés
privées ne quittent pas l'appareil, et les journaux ne contiennent ni secret ni contenu de
fichier. Ce qui **n'est pas** protégé est écrit noir sur blanc :
[docs/TECHNIQUE.md](docs/TECHNIQUE.md) § 5 et § 6.

## Contributions

Les contributions, idées et retours sont bienvenus. Avant de proposer une modification,
vérifiez l'état réel dans [docs/TECHNIQUE.md](docs/TECHNIQUE.md) § 10 : une fonctionnalité
marquée « partiel » ou « non testé » ne doit pas être présentée comme terminée.

## Licence

La licence du projet reste **à définir**. Tant qu'aucun fichier `LICENSE` n'est présent, le
code n'est pas automatiquement réutilisable, modifiable ni redistribuable. Les licences des
dépendances (toutes permissives) sont dans
[docs/TECHNIQUE.md](docs/TECHNIQUE.md) § 13.

## Soutenir le projet

En suivant son évolution, en partageant vos idées, en signalant les problèmes et en
contribuant à son amélioration.

Merci de votre intérêt pour DropForge.
