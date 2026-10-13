# Déploiement gratuit (et ses limites réelles)

Objectif : que DropForge reste **entièrement utilisable sans payer**, y compris pour
la personne qui l'héberge. Ce document liste ce qui est vérifié, à quelle date, et ce
qui se passe quand un quota est atteint.

> Vérifié le **13 octobre 2026** auprès des sources citées. Les offres gratuites
> changent : revérifiez avant de vous engager, et notez la date de votre vérification.

## 1. Ce qui fonctionne sans aucun serveur

| Fonction | Prérequis | Coût |
| --- | --- | --- |
| Transfert sur le même réseau local | Deux appareils sur le même Wi-Fi/LAN | 0 |
| Transfert direct par Internet (WebRTC) | STUN public (aucun compte) | 0 |
| Appairage par code ou QR | Rien de plus que ci-dessus | 0 |

Ces trois fonctions ne dépendent d'**aucun service payant** ni d'aucun compte, et le
relais n'est même pas nécessaire sur un réseau local. C'est la définition du cœur du
produit : si tout le reste disparaît, DropForge continue de fonctionner chez soi.

## 2. Relais et signalisation (nécessaire hors réseau local)

Deux pairs derrière des routeurs stricts ont besoin d'un relais. Trois chemins, du
plus simple au plus « zéro maintenance » :

### a) Le relais fourni dans ce dépôt, sur une machine à vous (le plus libre)

`apps/signaling` est un serveur Node/WebSocket autonome. Sur un PC Windows déjà
allumé, ou un mini-serveur, il n'ajoute aucun coût. Il faut simplement que les
appareils puissent l'atteindre (port ouvert, ou VPN/tunnel existant).

```bash
npm run start:signaling        # PORT=8787 par défaut, HOST à définir selon le réseau
```

### b) Cloudflare Workers + Durable Objects (offre gratuite)

Faits vérifiés le 13/10/2026 ([limites Durable Objects](https://developers.cloudflare.com/durable-objects/platform/limits/)) :

| Ressource | Offre gratuite |
| --- | --- |
| Exécution d'un pair | Les Durable Objects **sont disponibles en offre gratuite**, uniquement avec le stockage SQLite |
| Stockage Durable Objects | 5 Go par compte |
| Classes | 100 par compte |
| Taille d'un message WebSocket | 32 Mio |
| CPU par invocation | 30 s (remis à zéro à chaque message) |
| Requêtes Workers | 100 000 par jour (offre gratuite) |
| Messages WebSocket entrants | facturés avec un ratio 20:1 (20 messages = 1 requête facturée) |
| Cartes/classes par Worker | — |

⚠️ **Risque documenté** : un rapport communautaire d'octobre 2026 signale que
l'application du quota gratuit sur les WebSockets peut être plus stricte que la
ratios annoncés, une salle de jeu ayant été bloquée avant les 100 000 requêtes
([fil Cloudflare Community](https://community.cloudflare.com/t/durable-objects-free-quota-block-below-100k-after-websocket-20-1-adjustment/967650)).
Conséquences pour DropForge, et c'est ainsi que le produit est conçu :

- le relais est un **accessoire** : sa disparition ne casse pas les transferts locaux
  ni directs, et l'interface l'annonce (« relais injoignable : seuls les transferts
  sur le réseau local fonctionneront ») ;
- les salles ont un TTL de 10 minutes et 2 pairs : un relais gratuit pour un usage
  familial reste largement dans les quotas ;
- si le quota est atteint, la réponse est un message d'erreur clair côté client, pas
  une tentative payante.

### c) TURN (relais de secours quand la connexion directe est impossible)

État vérifié le 13/10/2026 ([tarifs Cloudflare Realtime](https://developers.cloudflare.com/realtime/sfu/platform/pricing/),
[FAQ TURN](https://developers.cloudflare.com/realtime/turn/faq/)) :

- Cloudflare Realtime TURN : **1 000 Go/mois gratuits**, puis 0,05 $/Go. Le palier
  gratuit est **partagé** avec le service SFU, et l'activation de Realtime demande un
  compte Cloudflare **avec moyen de paiement**.
- Hugging Face propose 10 Go/mois de TURN gratuit via FastRTC, avec un jeton HF.
- `stun.cloudflare.com` et les serveurs STUN publics sont **gratuits et illimités** ;
  c'est ce que DropForge utilise par défaut.

**Décision produit** : TURN n'est **pas requis** et n'est pas activé par défaut. Aucun
service TURN n'est aujourd'hui « gratuitement illimité et sans carte bancaire », donc
en dépendre violerait la règle « rien de payant ne doit être nécessaire ». Quand la
connexion directe échoue, DropForge l'explique et propose les alternatives qui
restent (« demandez à l'autre appareil d'être sur le même réseau », « réessayez avec
le relais »), au lieu de promettre un chemin qui n'existe pas.

Le code accepte une configuration TURN si vous en avez une (voir
`VITE_SIGNALING_URL` et les serveurs ICE de `apps/web/src/platform/webrtc-link.ts`) :
c'est un réglage, pas une dépendance.

## 3. Héberger la PWA (interface web installable)

| Hébergeur | Offre gratuite vérifiée | Quand ça coince |
| --- | --- | --- |
| **Cloudflare Pages** | 500 builds/mois, 1 build simultané, bande passante statique **non mesurée**, 20 000 fichiers, 25 Mio par fichier, sans carte bancaire ([source](https://temps.sh/blog/cloudflare-pages-free-tier-limits-2026)) | Les fonctions dynamiques (Pages Functions) retombent sur le quota Workers (100 000 requêtes/jour) — DropForge n'en a pas besoin : tout est statique |
| **GitHub Pages** | Gratuit pour un dépôt public | Pas d'en-têtes personnalisés, pas de WebSocket : le relais doit être ailleurs |
| **Netlify / Vercel** | Palier gratuit existant | Limites de bande passante mensuelles : à revérifier avant de s'y fier |

La PWA se construit en un fichier de configuration : `npm run build:web` produit un
dossier `apps/web/dist` **sans aucune ressource externe** (pas de police distante, pas
de CDN, pas d'analyse d'audience). Il suffit de servir ce dossier.

## 4. Liens de partage hébergés (optionnel)

Fonction **désactivable** et désactivée par défaut sur les installations où aucun
service n'est configuré (`allowHostedSharing`). Quand elle est disponible :

| Besoin | Option gratuite vérifiée | Limite |
| --- | --- | --- |
| Stockage des copies chiffrées | **Cloudflare R2** : 10 Go/mois, 1 M opérations de classe A, 10 M de classe B, **egress gratuit** ([tarifs R2](https://developers.cloudflare.com/r2/pricing/)) | L'activation de R2 demande un moyen de paiement ; les limites sont donc doublées d'un plafond côté application (512 Mio par lien, 50 téléchargements) pour refuser **avant** tout dépassement facturable |

Garde-fous appliqués par le code, dans cet ordre :

1. limite de taille et de nombre de fichiers **avant** l'upload (`packages/sharing`) ;
2. expiration obligatoire, entre 5 minutes et 7 jours ;
3. révocation côté serveur à la demande, et suppression des objets expirés ;
4. autorisation vérifiée (jeton par lien, pas de liste publique) ;
5. chiffrement **côté expéditeur** : le service ne peut pas lire le contenu ;
6. aucun dépassement automatique : un refus est renvoyé au lieu d'un débit.

Si aucun service de partage n'est configuré, l'application n'affiche pas l'option :
elle ne promet pas une fonction qu'elle ne peut pas tenir.

## 5. Application Windows : le seul poste de coût possible

- **Développement** : gratuit (Rust, Node, Tauri).
- **Signature de code Windows** : c'est le seul coût réel du projet, et il est
  **optionnel** — un exécutable non signé s'installe avec un avertissement de Windows.
  Les certificats OV coûtent quelques centaines d'euros par an ; les certificats EV
  davantage, et certains organismes demandent une vérification d'entreprise. À
  documenter dans `docs/UPDATE-PROCEDURE.md` au moment de distribuer.
- **Mises à jour signées** : la signature **Tauri** (paire de clés Ed25519) est
  gratuite et indépendante de la signature de code Windows. Elle est obligatoire pour
  que l'auto-mise à jour fonctionne : la clé publique est intégrée à l'application et
  la vérification ne peut pas être désactivée.

## 6. Récapitulatif honnête

| Fonction | Gratuit sans compte | Gratuit avec compte | Jamais garanti |
| --- | --- | --- | --- |
| Transferts locaux | ✅ | — | — |
| Transferts directs Internet | ✅ (STUN public) | — | Les réseaux très restrictifs peuvent l'empêcher |
| Relais hors réseau local | ✅ (auto-hébergé) | ✅ (Cloudflare) | Quota journalier |
| Connexion derrière NAT strict | ✅ (auto-hébergé) | ⚠️ TURN gratuit = palier partagé, carte requise | Pas de TURN illimité gratuit : c'est une limite du marché, pas du produit |
| PWA installable | ✅ (hébergement auto) | ✅ (Pages/GitHub Pages) | — |
| Liens hébergés | ✅ (auto-hébergé) | ✅ (R2, 10 Go) | Au-delà : refus, jamais de facture surprise |
| Mises à jour signées | ✅ | — | Signature de code Windows payante (optionnelle) |
