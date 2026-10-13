# Dépannage

Chaque entrée dit quoi faire, et ce que DropForge affiche dans ce cas. Si un message
ne correspond à rien ici, c'est un défaut de documentation : à signaler.

## Connexion

### « Aucun chemin commun » (`NO_COMMON_TRANSPORT`)

Les deux appareils ne partagent aucune méthode utilisable. Causes réelles :

- l'autre appareil est sur un autre réseau et le relais est injoignable ;
- le navigateur ne fournit pas WebRTC (`RTCPeerConnection` absent) ;
- le code de salle a expiré (10 minutes sans activité).

À essayer : mettre les deux appareils sur le même Wi-Fi, puis relancer l'appairage.
DropForge affiche la liste des méthodes essayées et leur échec, pas un message vague.

### « L'appareil est injoignable » (`PEER_UNREACHABLE`)

La connexion n'a pas abouti dans le délai (30 s de handshake). Vérifier :

- que le pare-feu autorise les connexions sortantes vers le relais (WebSocket 443) ;
- que le réseau n'isole pas les clients (Wi-Fi « invités » très souvent) ;
- que l'autre appareil est encore ouvert et affiche bien l'écran d'attente.

### « Le relais est injoignable »

Le service de signalisation ne répond pas. **Les transferts sur le réseau local
continuent de fonctionner** : c'est affiché tel quel. Pour retrouver un relais :

- lancer le serveur fourni : `npm run start:signaling` sur une machine du réseau ;
- ou configurer un relais distant avec `VITE_SIGNALING_URL` au moment du build.

### « Les codes ne correspondent pas » (`SAS_MISMATCH`)

Le code à 6 chiffres diffère entre les deux appareils : **c'est le signe d'une
attaque ou d'un intermédiaire**, pas d'un bug réseau. Refuser la connexion, vérifier
le réseau, recommencer. Ne jamais accepter « parce que le nom est le bon ».

### « Cet appareil a changé » (`DEVICE_IDENTITY_MISMATCH`)

L'identifiant connu réapparaît avec une **autre clé publique**. DropForge refuse et
n'essaie aucune autre méthode. Causes légitimes : l'autre appareil a réinitialisé son
identité, ou son navigateur a effacé son stockage. Dans ce cas, oublier l'appareil
dans l'onglet Appareils, puis réappairer en vérifiant le code.

## Transferts

### « Un fichier existe déjà » (`NAME_CONFLICT`)

La politique de conflit est sur « demander » et personne n'a répondu, ou la réponse ne
couvrait pas ce fichier. Choisir « Demander », « Renommer » ou « Ignorer » dans les
réglages, ou répondre dans la fenêtre. **Rien n'est écrasé sans décision explicite.**

### « Le disque est plein » (`NO_SPACE_LEFT`)

DropForge vérifie l'espace disponible *avant* d'écrire quand la plateforme l'expose
(c'est le cas sous Windows et dans Chromium). Libérer de l'espace, ou choisir un autre
dossier de réception. Un fichier partiel éventuel reste sur le disque pour la reprise.

### Un transfert reste à « vérification » (`verifying`)

La vérification lit le fichier écrit et recalcule son empreinte SHA-256. Sur un très
gros fichier et un disque lent, cela prend du temps — c'est normal et c'est ce qui
autorise l'état « terminé ». Un dépassement produit un échec explicite
(`INTEGRITY_FAILED`), jamais un faux succès.

### « Le fichier a changé pendant l'envoi » (`FILE_CHANGED`)

Le fichier a été modifié entre le moment où il a été choisi et sa lecture. Le
transfert s'arrête avec ce code : renvoyer le fichier après avoir terminé la
modification.

### « Interrompu » et pas de reprise qui démarre

Le receveur n'a pas de fichier partiel réutilisable. Dans un navigateur, la reprise
n'est possible qu'avec l'écriture dans un dossier choisi (File System Access) ; sinon
l'application l'annonce et renvoie le fichier depuis le début.

## Réception dans un navigateur

### « Ce navigateur ne peut pas mémoriser un dossier »

Firefox et Safari n'implémentent pas File System Access. Le repli est le
téléchargement : le fichier est assemblé en mémoire, vérifié, puis proposé au
téléchargement. Les très gros fichiers consomment donc de la mémoire ; l'interface
l'indique dans la fenêtre d'acceptation.

### « Le navigateur demande de confirmer l'accès au dossier »

C'est le comportement normal de Chromium : une permission accordée ne survit pas
toujours à un redémarrage. DropForge affiche un bouton « Autoriser l'accès » ; il ne
tente jamais d'écrire avant que la permission soit réellement accordée.

### Sur iPhone / iPad

Safari suspend un onglet en arrière-plan : la réception en arrière-plan est
impossible, et DropForge le dit. Garder l'application au premier plan pendant la
réception, et utiliser le téléchargement (l'écriture dans un dossier n'existe pas sur
iOS).

## Application Windows

### La fenêtre ne s'affiche pas après le lancement

L'application masque sa fenêtre tant que l'interface n'est pas prête (pas de fenêtre
blanche). Si elle reste invisible plus de quelques secondes, lancer l'application
depuis un terminal pour voir la sortie d'erreur.

### Fermer la fenêtre ne quitte pas l'application

C'est le réglage « continuer en arrière-plan ». Le changer dans Réglages →
« À la fermeture de la fenêtre », ou quitter par le menu de l'icône de la zone de
notification.

### Un transfert s'arrête quand Windows se met en veille

Attendu : le moteur marque un transfert `interrupted` plutôt que de le laisser
bloqué. Au retour, relancer le transfert reprend là où il s'était arrêté si le
fichier partiel est intact.

## Mises à jour

### « Cette plateforme ne permet pas de rechercher une mise à jour ici »

C'est vrai dans un navigateur non installé : il n'y a pas de version à mettre à jour.
Installer l'application (menu du navigateur → Installer) ou utiliser la version
Windows.

### « Rien n'est en attente »

Aucun service de mise à jour n'est configuré (`plugins.updater.pubkey` vide). Voir
`docs/UPDATE-PROCEDURE.md`.

## Diagnostics

- Les journaux détaillés sont **locaux** et désactivés par défaut (Réglages →
  Confidentialité). Ils ne contiennent ni clé, ni jeton, ni contenu de fichier, ni
  chemin complet.
- Pour un rapport de bug utile : le code d'erreur affiché, la plateforme, la méthode
  de connexion utilisée (« réseau local », « direct », « relais ») et ce qui a été
  essayé. Ces informations suffisent, sans joindre aucun fichier.
