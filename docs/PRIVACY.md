# Confidentialité

Résumé en une phrase : **DropForge ne collecte rien, n'envoie rien à l'auteur du
logiciel, et n'exige aucun compte.**

## Ce qui ne quitte jamais vos appareils

- Le contenu de vos fichiers (sauf le mode « lien hébergé », que vous devez activer
  explicitement — et même dans ce cas, la copie est chiffrée avant de partir).
- Vos préférences, votre historique, la liste de vos appareils de confiance.
- Vos clés privées : elles sont créées localement et ne sont jamais exportées ni
  transmises.
- Aucun identifiant de compte : il n'y en a pas.

## Ce qui est transmis, et à qui

| Destinataire | Ce qu'il voit | Pourquoi |
| --- | --- | --- |
| L'appareil d'en face | Les fichiers que vous envoyez, leurs noms et leurs tailles | C'est le but du transfert |
| Le service de signalisation (relais aveugle) | Adresses IP, horaires, volume échangé, identifiant de salle. **Pas** les noms de fichiers, **pas** le contenu : tout est chiffré de bout en bout | Mettre deux appareils en relation, et relayer si la connexion directe est impossible |
| Le service de partage (optionnel, désactivé si vous le souhaitez) | Une copie **chiffrée**, sa taille, sa date d'expiration, le nombre de téléchargements | Héberger temporairement un fichier pour un destinataire qui n'est pas en ligne |
| Serveurs STUN/TURN (uniquement si un déploiement en configure un) | Votre adresse IP publique, pour découvrir votre routeur | Trouver un chemin direct entre deux appareils éloignés |

**Aucun serveur STUN n'est utilisé par défaut.** La version livrée ne contacte que son
propre service de signalisation : sur le réseau local, les deux appareils se trouvent
directement, sans intermédiaire. Un déploiement peut en configurer un
(`VITE_ICE_URLS`) pour traverser des routeurs distants — c'est alors un choix explicite,
visible dans l'application construite, et il doit être annoncé aux personnes qui
l'utilisent (un serveur STUN voit votre adresse IP publique).

**Quand aucun chemin direct n'existe**, les deux appareils passent par le relais aveugle
du même service : il recopie des trames déjà chiffrées de bout en bout et ne peut en lire
ni le nom des fichiers, ni un octet de contenu. Ce que le service voit dans tous les cas
est dans le tableau ci-dessus : des adresses IP, des horaires, un volume.

Rien n'est envoyé à l'auteur de DropForge, ni à un service d'analyse, ni à un
gestionnaire d'erreurs distant.

## Télémétrie

Il n'y en a **aucune**, ni par défaut ni en option. Le réglage « journaux de
diagnostic » autorise seulement l'application à écrire des journaux locaux plus
détaillés, sur votre disque, pour joindre un rapport de bug si vous le souhaitez.
Aucun journal ne contient de clé, de jeton, de contenu de fichier ni de chemin
complet (ils sont masqués).

## Durée de conservation

| Donnée | Emplacement | Durée |
| --- | --- | --- |
| Historique des transferts | Local | Réglable (7 jours à toujours, défaut : toujours, supprimable à tout moment) |
| Appareils connus | Local | Jusqu'à ce que vous les oubliiez ou révoquiez |
| Points de reprise | Local | Jusqu'à la fin du transfert ou sa suppression |
| Copie hébergée d'un lien | Service de partage | Expiration choisie (5 min à 7 jours) ; le serveur supprime l'objet expiré et l'application demande la révocation immédiate si vous annulez |
| Journaux locaux | Local | Non purgés automatiquement (ils sont désactivés par défaut) |

## Vos droits, en pratique

Comme tout est local, ils s'exercent sans intermédiaire : « exporter l'historique »
produit un fichier JSON que vous lisez ou transmettez vous-même ; « tout supprimer »
efface l'historique ; « réinitialiser l'identité » crée une nouvelle empreinte et
oublie les appareils approuvés.

## Enfants, données sensibles

DropForge n'est pas un service : il n'y a ni inscription, ni profilage, ni publicité.
Il n'y a donc pas de traitement de données personnelles par l'auteur du logiciel. En
revanche, un transfert révèle à votre interlocuteur votre adresse IP ; ne l'utilisez
pas pour échanger des données que vous ne voudriez pas voir associées à votre réseau.

## Si vous hébergez vous-même le relais

Le relais que vous hébergez voit ce que verrait n'importe quel relais : adresses IP,
horaires, volumes. Il ne voit jamais les contenus. N'activez les journaux détaillés
du serveur que le temps d'un diagnostic.
