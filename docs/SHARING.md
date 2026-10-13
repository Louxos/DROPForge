# Liens de partage

DropForge connaît deux façons de partager, et la différence entre les deux est la
partie importante de cette page.

| Mode | Par défaut | Ce qui est stocké | Qui peut lire |
| --- | --- | --- | --- |
| **A — Transfert direct** | ✅ oui | **rien**, nulle part | seulement les deux appareils |
| **B — Partage hébergé temporaire** | non, désactivé par défaut | des **octets chiffrés** sur un serveur, pendant une durée limitée | seulement qui possède le lien |

Un lien de partage n'est jamais le mode par défaut : partager un fichier veut dire le
transférer, pas le publier.

## Mode A — transfert direct

Le lien d'appairage (`https://…/#c=<code>`) fait que l'autre appareil rejoins la
même salle de négociation. Tant que l'émetteur reste ouvert, le transfert se fait
d'appareil à appareil (voir `docs/THREAT-MODEL.md` et `docs/ARCHITECTURE.md`). Rien
n'est conservé après la session. C'est ce mode qui fonctionne **sans aucun serveur**
sur un réseau local.

## Mode B — partage hébergé temporaire

Il n'existe que si un service d'hébergement est configuré (`VITE_SHARE_ORIGIN`). Sans
lui, l'option est **affichée comme indisponible** dans les réglages et le transfert
direct reste proposé : rien ne promet une fonction qui n'existe pas.

### Ce que le serveur reçoit, et ce qu'il ne reçoit jamais

| Élément | Reçu par le serveur ? |
| --- | --- |
| Contenu des fichiers | ❌ jamais — chiffré sur l'appareil de l'émetteur **avant** l'envoi (AES-256-GCM, une clé de 32 octets par partage, un nonce aléatoire par bloc de 1 Mio) |
| Clé de déchiffrement | ❌ jamais — elle voyage entièrement dans le **fragment d'URL** (`#…`), que les navigateurs n'envoient pas dans la requête HTTP |
| Noms des fichiers, tailles, empreintes SHA-256 | ⚠️ oui, dans le manifeste de la partage — c'est le prix d'un téléchargement qui sait ce qu'il récupère |
| Identifiant de la partage, date d'expiration, nombre de téléchargements autorisés | ⚠️ oui — le serveur est l'autorité sur ces limites |
| Adresse IP, journaux de connexion | ⚠️ selon l'hébergeur ; c'est documenté dans sa politique, pas masqué ici |

Autrement dit : l'hébergeur **apprend quels fichiers existent et combien ils pèsent**,
et il ne peut pas lire leur contenu. Si connaître les noms suffit à vous gêner, le
mode A est le bon choix.

### Comment le destinataire obtient la clé

Le lien complet ressemble à :

```
https://partage.example.org/#df=share&v=1&s=<charge utile encodée, clé comprise>
```

- le **fragment** (tout ce qui suit `#`) n'est pas transmis au serveur par le
  navigateur, ni par le presse-papiers, ni par le QR code : il reste du côté du
  destinataire ;
- l'application destinataire lit ce fragment (`readShareUrl`) : elle y trouve
  l'identifiant de la partage, la liste des fichiers, la durée et **la clé**. Elle
  interroge ensuite le serveur pour savoir si la partage existe encore, si elle a été
  révoquée, si elle a expiré et combien de téléchargements ont eu lieu (`status`) ;
  tout écart est un refus, jamais un silence. Puis elle télécharge les objets chiffrés
  et les déchiffre **localement** ;
- une clé n'est jamais écrite dans un journal, ni dans l'historique du serveur, ni
  dans une URL de redirection. `docs/PRIVACY.md` détaille ce qui reste sur l'appareil.

Copier le lien entier est donc nécessaire : un lien tronqué (sans le fragment) ne
donne accès à rien d'autre qu'à des octets chiffrés.

### Limites, et qui les fait respecter

| Limite | Valeur | Où elle est vérifiée |
| --- | --- | --- |
| Taille totale | 512 Mio | client **avant** le premier envoi, puis serveur |
| Nombre de fichiers | 200 | idem |
| Durée de vie | 5 minutes à 7 jours (24 h par défaut) | le client refuse hors bornes ; le serveur refuse un lien expiré |
| Téléchargements | 50 par défaut | le serveur décrémente ; le client s'arrête à la limite annoncée |
| Taille d'un objet | 1 Mio par bloc chiffré | le client découpe ; le serveur limite la taille d'un objet |

Ces limites sont **les mêmes des deux côtés** (`packages/sharing/src/links.ts`), et
elles sont plus strictes que celles des offres gratuites visées : l'application refuse
donc une opération **avant** qu'elle ne coûte quoi que ce soit à l'hébergeur (voir
`docs/FREE-DEPLOYMENT.md`).

### Expiration et révocation

- L'émetteur peut **révoquer** : le serveur supprime les objets, et la clé locale est
  effacée en mémoire (`rawKey.fill(0)`), donc un fragment conservé quelque part ne
  déchiffre plus rien.
- À l'expiration, le serveur répond comme pour une partage inexistante (« introuvable
  ou expirée ») et supprime les objets (`sweepExpired`). Un lien expiré ne peut pas
  être « rallongé » depuis le client.
- Côté destinataire, la date et les limites sont vérifiées **avant le premier objet**,
  et le serveur reste l'autorité : un objet qu'il a déjà supprimé est signalé comme
  manquant (`skipped`) plutôt que remplacé par un fichier vide ou inventé. Un objet
  dont le contenu ne correspond plus à l'empreinte annoncée est refusé.

### Ce qui n'est pas fourni

Aucun service d'hébergement n'est livré avec DropForge — seulement le port
`ShareBackend` (`packages/sharing/src/links.ts`) que ce service doit implémenter :
créer une partage, envoyer un objet chiffré, finaliser, répondre sur l'état, révoquer,
servir un objet, nettoyer les expirés. Le code client, l'interface et les tests
existent ; le serveur reste à héberger (Cloudflare Workers + R2, ou n'importe quel
stockage objet) — les faits sur les offres gratuites réellement utilisables sont dans
`docs/FREE-DEPLOYMENT.md`.

**Sans ce serveur, la fonctionnalité est honnêtement annoncée comme indisponible** :
c'est la règle du projet — une option éteinte proprement vaut mieux qu'une promesse
qui échoue après l'envoi.

## Tests

`packages/sharing/src/links.test.ts` (9 tests) vérifie : construction et relecture
d'un lien, clé absente côté serveur, refus d'un lien expiré ou incomplet, refus
au-delà des limites (taille, nombre, durée), chiffrement/déchiffrement réel,
détection d'une modification du chiffré, révocation qui efface la clé locale, et
l'ordre « tout est vérifié avant le premier envoi ».
