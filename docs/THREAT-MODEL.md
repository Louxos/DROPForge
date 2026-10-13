# Modèle de menace

Méthode : lister ce qui a de la valeur, qui peut attaquer, puis ce qui est
réellement protégé — et surtout **ce qui ne l'est pas**. Un modèle de menace qui ne
dit pas ce qu'il ne couvre pas n'aide personne.

## 1. Ce qui a de la valeur

| Actif | Où il vit | Ce qu'une fuite permettrait |
| --- | --- | --- |
| Contenu des fichiers | Appareils de l'utilisateur | Lecture des documents transférés |
| Clés privées d'identité | Stockage local non exportable (WebCrypto) | Usurpation de l'appareil |
| Clés de session | Mémoire, dérivées par handshake | Déchiffrement d'une session en cours |
| Historique, appareils, réglages | Base locale | Reconnaissance de l'activité de l'utilisateur |
| Clé d'un lien de partage | Fragment de l'URL | Déchiffrement de la copie hébergée |

## 2. Adversaires considérés

| Adversaire | Capacités supposées | Hors de portée |
| --- | --- | --- |
| **Réseau passif** | Écoute du trafic | Rien : tout est chiffré de bout en bout |
| **Relais/signalisation hostile** | Lit, modifie, rejoue, bloque ce qui passe | Ne peut pas lire un nom de fichier ni un octet de contenu ; ne peut pas se faire passer pour un pair sans la clé privée |
| **Appareil inconnu sur le réseau** | Se connecte, envoie des annonces, propose des transferts | Ne peut pas faire accepter un transfert : l'utilisateur doit confirmer, et la clé doit correspondre au souvenir local |
| **Utilisateur malveillant avec un lien** | Possède l'URL complète d'un partage hébergé | Rien de plus que ce que le lien donne : il est fait pour ça, il expire et se révoque |
| **Attaquant local (autre logiciel du poste)** | Lit les fichiers que le processus peut lire | Non traité ici : c'est le modèle de sécurité de l'OS, pas celui de DropForge |
| **Fournisseur d'hébergement** | Voit les métadonnées de connexion (IP, volumes, horaires) | Ne peut pas lire le contenu ni les noms de fichiers |

## 3. Ce qui est protégé, et comment

| Menace | Protection | Où |
| --- | --- | --- |
| Lecture en transit | AES-256-GCM sur chaque trame, clés dérivées par ECDH éphémère + HKDF-SHA-256 | `packages/security/src/session.ts` |
| Usurpation d'identité | Handshake qui exige une preuve de possession de la clé ; l'empreinte annoncée est comparée à celle du souvenir local | `packages/security/src/handshake.ts`, `packages/connection-manager` |
| Attaque de l'homme du milieu au premier appairage | Code de comparaison (SAS) à 6 chiffres affiché des deux côtés, dérivé du transcript complet : s'il diffère, la connexion doit être refusée | `packages/security` + écran de confirmation |
| Rejeu de trames | Compteur par direction dans le nonce ; une trame rejouée est rejetée (`SESSION_REPLAY`) | `packages/security/src/session.ts` |
| Falsification d'une trame | AEAD authentifié par trame ; une trame modifiée ne se déchiffre pas | idem |
| Faux « terminé » | SHA-256 par fichier, état `verifying` obligatoire avant `completed` | `packages/transfer-engine` |
| Écriture hors du dossier choisi | Normalisation des chemins, refus des absolus et de `..`, refus signalé par fichier | `packages/protocol/src/paths.ts` |
| Écrasement silencieux | Modes `create-new` / `replace` / `resume` explicites, questions avant remplacement | `packages/transfer-engine`, `apps/web/src/platform/browser-fs.ts` |
| Abus du relais | 2 pairs par salle, TTL 10 min, 20 messages/s, tailles bornées, relais seulement après accord des deux pairs | `apps/signaling/src/rooms.ts` |
| Fuite par les journaux | Aucun secret, clé, jeton ou contenu journalisé ; chemins masqués (`redactPath`) | `packages/protocol/src/paths.ts`, `packages/protocol/src/logger` |
| Fuite par le code d'appairage dans un journal | Le code voyage dans le **fragment** de l'URL, jamais envoyé au serveur | `apps/web/src/app/controller.ts` (`pairingLinkFor`) |
| Fichiers hébergés lisibles par le serveur | Chiffrement côté expéditeur avant envoi ; clé jamais transmise au serveur | `packages/sharing` |
| Télémétrie | Il n'y en a aucune : le réglage « diagnostics » ne produit que des journaux locaux | `packages/settings`, `docs/PRIVACY.md` |
| Catalogue d'erreurs fuyant | 42 codes génériques, traduits ; les messages bruts du système ne sont jamais montrés | `packages/app-core/src/errors.ts` |

## 4. Ce qui n'est PAS protégé (à lire avant d'affirmer que c'est sûr)

1. **Le poste lui-même.** Un logiciel malveillant présent sur l'appareil peut lire
   les fichiers que DropForge écrit. DropForge ne chiffre pas le disque.
2. **Un appareil déjà approuvé et compromis.** Il dispose de la confiance accordée ;
   la révocation est manuelle.
3. **Le premier appairage sans vérification du code.** Si l'utilisateur ne compare
   pas le SAS, un attaquant positioned sur le chemin pourrait s'intercaler au premier
   appairage. C'est pourquoi l'écran demande explicitement de comparer, et pourquoi le
   SAS est dérivé du transcript complet (clés + échanges), pas d'un élément négociable.
4. **Les métadonnées de connexion** (adresses IP, horaires, volumes) sont visibles par
   l'hébergeur du relais. L'anonymat réseau n'est pas un objectif : utilisez Tor ou un
   VPN si nécessaire, DropForge ne s'en occupe pas.
5. **Le contenu dans le dossier de réception.** Une fois écrit, le fichier est un
   fichier normal, avec les permissions du système.
6. **Le service d'hébergement d'un lien temporaire** voit la taille, la date et
   l'adresse IP des visiteurs ; il ne voit ni le contenu ni le nom du fichier.
7. **La disponibilité.** Un attaquant qui contrôle le réseau peut toujours bloquer un
   transfert (déni de service). DropForge le dit clairement et propose les alternatives
   qui restent possibles (réseau local, autre méthode).
8. **Le partage hébergé suppose un tiers.** Il est désactivé par défaut dans les
   réglages, et l'application explique ce qu'il implique avant de l'activer.

## 5. Choix cryptographiques

- **Primitives uniquement issues de la plateforme** : WebCrypto (Ed25519, X25519,
  HKDF-SHA-256, AES-256-GCM, SHA-256) ; repli P-256 si Ed25519 n'est pas disponible.
  Aucun algorithme n'est implémenté par le projet.
- **Hachage en flux** : `@noble/hashes` (MIT) pour le SHA-256 incrémental des gros
  fichiers, avec la même primitive que le hachage en une passe.
- **Dérivation** : `ikm = ECDH(éphémères)` ; `salt = sha256(transcript)` ;
  `info = dropforge/v1/{i2r,r2i,sas}` — les trois secrets sont indépendants.
- **Nonce** : préfixe de direction (4 octets) + compteur 64 bits big-endian, jamais
  réutilisé pour une même clé.
- **Taille de code d'appairage** : 6 chiffres (~20 bits). Suffisant contre une attaque
  en ligne pendant la fenêtre d'appairage : une seule tentative par connexion, et le
  code change à chaque appairage. **Insuffisant** contre un attaquant qui pourrait
  rejouer des milliers d'appairages : ce n'est pas le modèle, l'identité est vérifiée
  par clé et la confiance est mémorisée.

## 6. Signalement

Une vulnérabilité se signale en privé (voir `README.md`). Merci de ne pas publier de
détails exploitables dans une issue publique.
