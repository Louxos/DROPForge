# Spécification de comportement

Ce document fixe les règles que le code doit respecter. Il est la référence des
commentaires du code qui écrivent « voir docs/SPEC.md ».

## 1. États d'un transfert

```
                        ┌──────────┐
                        │  queued  │
                        └────┬─────┘
                             ▼
                     ┌───────────────┐   échec réseau, mise en veille,
                     │  connecting   │──▶┌──────────────┐
                     └───────┬───────┘   │ interrupted  │
                             ▼           └──────┬───────┘
                     ┌───────────────┐◀─────────┘ reprise
                     │ transferring  │◀──┐
                     └───┬───┬───┬───┘   │ reprise
              pause ─────┘   │   └───── annulation ──┐
                             │ vérification          │
                             ▼                       ▼
                     ┌───────────────┐        ┌────────────┐
                     │  verifying    │        │ cancelled  │
                     └───────┬───────┘        └────────────┘
                             ▼
                     ┌───────────────┐        ┌────────────┐
                     │  completed    │        │   failed   │
                     └───────────────┘        └────────────┘
```

Règles non négociables :

- **Aucun transfert ne passe à `completed` sans être passé par `verifying`.** La
  vérification d'intégrité (SHA-256 par fichier) est ce qui autorise cet état.
- **Un état terminal n'est écrit que par `finishRecord`.** Une mesure de progression
  tardive ne peut ni rouvrir ni rétrograder un transfert terminé.
- **Un refus est un échec, pas une annulation** : côté expéditeur, un refus du
  destinataire donne `failed` avec le code du refus (`TRANSFER_DECLINED`,
  `NO_SPACE_LEFT`, `BUSY`, `TOO_LARGE`), jamais `cancelled`.
- **`partial` se dégrade en `failed`.** Un transfert dont une partie des fichiers
  n'est pas arrivée ou pas vérifiée n'est jamais présenté comme réussi.
- **États transitoires finis** : `connecting` a un délai maximal (30 s de handshake,
  45 s d'inactivité), `verifying` aussi ; un dépassement produit `interrupted` ou
  `failed` avec un code explicite.

## 2. Erreurs

Toute erreur porte un **code stable** (`packages/app-core/src/errors.ts`, 42 codes),
un message compréhensible, une sévérité et un indicateur `retryable`. L'interface
affiche la traduction du code, jamais le message brut d'une exception.

| Situation | Code | Reprise proposée |
| --- | --- | --- |
| Réseau coupé pendant l'envoi | `CONNECTION_LOST` | Oui |
| Aucune méthode commune | `NO_COMMON_TRANSPORT` | Non (explication affichée) |
| Périphérique non approuvé | `DEVICE_NOT_TRUSTED` | Non |
| Clé différente du souvenir | `DEVICE_IDENTITY_MISMATCH` | Non, et aucune tentative sur un autre chemin |
| Appareil révoqué | `DEVICE_REVOKED` | Non |
| Chemin refusé (traversée, absolu) | `PATH_ESCAPE` / `UNSAFE_PATH` | Non |
| Conflit de nom non tranché | `NAME_CONFLICT` | Oui, après décision |
| Disque plein | `NO_SPACE_LEFT` | Oui |
| Fichier modifié pendant l'envoi | `FILE_CHANGED` | Oui |
| Anti-rejeu / trame inattendue | `SESSION_REPLAY` | Non |
| Espace de stockage local indisponible | `STORAGE_UNAVAILABLE` | Non |

## 3. Fichiers et chemins

- Aucun écrasement silencieux : `create-new`, `replace` (décision explicite) ou
  `resume` (fichier partiel au bon gabarit). Le mode `resume` refuse un fichier dont
  la taille ne correspond pas au manifeste.
- Les chemins sont normalisés et restreints (relatifs, sans `..`, sans absolu,
  ≤ 1024 octets) ; un chemin inutilisable est **refusé et signalé** au lieu de faire
  échouer tout le transfert.
- Un conflit découvert *après* la décision (fichier créé entre-temps) n'écrase
  jamais : DropForge renomme (au plus 5 essais) et le dit.
- Limites réelles respectées : 256 Kio par morceau, 10 000 fichiers, 2 Tio par
  transfert, 50 000 entrées par dossier, 32 niveaux de profondeur (navigateur).

## 4. Découverte et appairage

- Découverte locale : annonces signées, cache de 20 s, 64 entrées maximum.
- Code de salle : `[A-Za-z0-9_-]{4,32}`, généré aléatoirement, transmis dans le
  **fragment** d'URL (jamais dans le chemin, donc jamais dans un journal serveur).
- Appairage QR : la clé publique voyage avec le code ; le handshake vérifie la
  possession de la clé et le code de comparaison (SAS) affiché des deux côtés doit
  être identique. Un SAS différent est un signal d'attaque, pas un incident réseau.
- **Tout nouvel appareil est annoncé et attend une réponse.** Aucun transfert n'est
  accepté avant. Un appareil n'est mémorisé que si l'utilisateur le demande.

## 5. File d'attente

- Concurrence configurables de 1 à 8 (défaut 2).
- `pause`, `resume`, `cancel`, `retry`, réordonnancement par priorité.
- `retry` ne ré-enqueue que les échecs réellement réessayables (3 essais maximum).
- Un élément en pause n'est pas « en cours » : l'interface le montre comme en pause,
  même si la machine à états n'a pas encore bougé.
- Annuler un élément qui n'a pas encore démarré **termine son enregistrement**
  (`cancelled`) au lieu de le laisser indéfiniment « en file d'attente » : la file
  dit à l'appelant si le travail avait commencé, et l'appelant en tire la
  conséquence. Aucun transfert ne reste dans un état non terminal une fois annulé.

## 6. Progression, vitesse, temps restant

- La vitesse n'est affichée que si elle est **mesurée et fiable** (fenêtre glissante
  avec un minimum d'échantillons et de durée) ; sinon la barre est indéterminée.
- Le pourcentage est plafonné à 99 % jusqu'à la vérification finale (jamais « 100 % »
  avant que le fichier soit réellement complet et vérifié).
- Le temps restant n'est affiché que si la vitesse est fiable.

## 7. Reprise

- Une reprise n'est adoptée que si l'empreinte du manifeste est **identique** ; les
  plages déjà écrites sont alignées sur les morceaux et re-hachées avant d'être
  conservées.
- L'état de reprise est persisté localement (sans contenu de fichier).
- Limites documentées : dans un navigateur, une reprise après fermeture de l'onglet
  n'est possible que si l'écriture se fait dans un dossier choisi (File System
  Access) ; sinon le fichier est renvoyé depuis le début, et l'interface le dit.

## 8. Liens de partage

| Mode | Disponibilité | Comportement |
| --- | --- | --- |
| Direct (défaut) | Toujours | L'expéditeur reste connecté ; le destinataire reçoit en direct |
| Hébergé temporaire | Optionnel, désactivable | Copie **chiffrée avant l'envoi** sur le service configuré |

Contraintes du mode hébergé : expiration effective (5 min à 7 jours, défaut 24 h),
révocation côté serveur, autorisation vérifiée, ≤ 512 Mio, ≤ 200 fichiers,
≤ 50 téléchargements, morceaux de 1 Mio. La clé de déchiffrement n'est **jamais**
envoyée au serveur : elle voyage dans le fragment du lien, connu du seul
destinataire, et l'interface explique comment l'utilisateur doit transmettre le lien.

## 9. Notifications

Une notification système n'est envoyée que pour une conclusion qui mérite
d'interrompre la personne :

| Situation | Notification |
| --- | --- |
| Envoi terminé et vérifié | « Envoi terminé » avec le nombre de fichiers et le destinataire |
| Réception terminée et vérifiée | « Réception terminée » de la même façon |
| Échec | « Transfert échoué » **avec la raison**, tirée du code d'erreur réel |
| Connexion perdue | « Transfert interrompu », la reprise est expliquée |
| Annulation par l'utilisateur | **aucune** : la personne vient de le faire elle-même |
| Échec sans raison rapportée par le moteur | la notification le dit, au lieu d'inventer une cause |

Le service applique de lui-même la préférence, la permission et la limitation de
débit ; aucun de ces contrôles ne peut être contourné par un appelant.

## 10. Réglages

Langue (fr/en), thème (système/sombre/clair), notifications, démarrage automatique
Windows, comportement à la fermeture, dossier de réception, politique de conflit,
concurrence, limite de taille locale, appareils approuvés uniquement, ports locaux
optionnels, conservation de l'historique, partage hébergé, journaux de diagnostic.
Une valeur inventée est **refusée** (`UNSUPPORTED_OPERATION`) et les valeurs
numériques sont bornées ; un réglage non applicable à la plateforme est désactivé
avec son explication.

## 11. Mises à jour

- Vérification à la demande, jamais d'installation silencieuse.
- L'application Windows n'applique qu'une mise à jour **signée** vérifiée contre la
  clé publique intégrée ; cette vérification ne peut pas être désactivée.
- Dans le navigateur, la version installée est mise à jour par le service worker :
  DropForge signale qu'une nouvelle version est prête et n'active qu'après accord.
