# Déployer DropForge soi-même

Trois façons, de la plus simple à la plus complète. Aucune n'est payante.

| Besoin | Méthode | Commande |
| --- | --- | --- |
| Juste essayer l'application | dossier statique | servez `apps/web/dist` (`npm run build:web`) |
| Transferts à distance, réseau local partagé | les deux conteneurs | `docker compose up -d --build` |
| Internet, plusieurs réseaux | application web + signalisation sur un domaine | ci-dessous |

## 1. Application web seule

```bash
npm install
npm run build:web
# n'importe quel serveur statique fait l'affaire :
npx vite preview --config apps/web/vite.config.ts
```

L'application fonctionne alors **sur le réseau local** sans serveur. Il n'y a ni base
de données, ni stockage de fichiers, ni compte.

## 2. Les deux conteneurs (recommandé)

```bash
cd deploy
docker compose up -d --build
# application : http://localhost:8080
# santé du relais : http://localhost:8080/health
```

Le conteneur `web` sert l'interface **et** relaie `/ws` vers la signalisation : une
seule origine, donc aucune règle CORS à assouplir.

## 3. Sur Internet

- Placez un reverse proxy TLS devant le conteneur `web` (Caddy, Traefik, nginx…).
  Le WebSocket `/ws` doit être transmis, c'est tout.
- En HTTPS, l'application installe un service worker ; en HTTP simple, elle ne le
  fait pas — c'est le navigateur qui l'exige, pas DropForge.
- Les services gratuits réellement utilisables (Cloudflare, GitHub Pages, Tailscale)
  sont comparés dans `../docs/FREE-DEPLOYMENT.md`, avec leurs quotas et leurs limites
  honnêtes.

## Ce qu'il ne faut pas attendre de ce déploiement

- Aucun fichier n'est stocké côté serveur : le relais transmet des octets chiffrés
  qu'il ne peut pas lire, et rien n'est conservé après la session.
- Le service de signalisation est **limité en mémoire** (salles, débit par connexion).
  Ce n'est pas un service public à grande échelle ; pour un usage privé, c'est
  amplement suffisant.
