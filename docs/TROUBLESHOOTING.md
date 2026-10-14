# Dépannage

Chaque entrée dit quoi faire, et ce que DropForge affiche dans ce cas. Si un message
ne correspond à rien ici, c'est un défaut de documentation : à signaler.

## Windows : je lance DropForge et rien ne s'ouvre

C'était un vrai défaut, il est corrigé — mais la réponse reste utile si vous utilisez
une version plus ancienne, ou si un échec de démarrage se produit malgré tout.

**Ce que fait DropForge maintenant.** Il ouvre sa fenêtre même quand son interface ne
démarre pas :

1. la fenêtre est demandée **avant** tout le reste ;
2. deux contrôles de secours (Rust) l'affichent après 700 ms puis 12 s si personne ne
   l'a demandée — vous voyez alors l'écran d'attente, puis soit l'application, soit un
   écran qui dit ce qui a échoué ;
3. un échec affiche l'étape concernée, la cause, le chemin du journal de diagnostic et
   un bouton **Réessayer** ;
4. si vous relancez l'application alors qu'une instance tourne déjà, la fenêtre de cette
   instance revient au premier plan (au lieu d'un second processus invisible).

**Si rien ne s'ouvre encore**, dans l'ordre :

| À vérifier | Comment | Ce que cela veut dire |
| --- | --- | --- |
| L'application tourne-t-elle ? | `Gestionnaire des tâches` → onglet **Détails** → `DropForge.exe` | Présente : la fenêtre est ouverte ailleurs (autre bureau virtuel, écran secondaire hors ligne) ou minimisée dans la zone de notification. Cliquez sur l'icône DropForge près de l'horloge |
| Que dit le journal ? | Ouvrez `%APPDATA%\org.dropforge.app\diagnostics.log` (collez ce chemin dans la barre d'adresse de l'explorateur) | La dernière ligne donne l'étape et la cause : `data` (base SQLite), `identity`, `settings`, `updates`, `tray`, `window`, `interface`, `render`, `panic` |
| Le fichier existe-t-il ? | Le dossier `%APPDATA%\org.dropforge.app` doit contenir `dropforge.sqlite3` | Absent ou vide alors que le journal dit `data` : l'antivirus ou une règle de dossier a bloqué la création de la base |
| Un antivirus bloque-t-il ? | Journaux de l'antivirus | Certains outils bloquent une application non signée au premier lancement. Autorisez-la explicitement, ou signez l'installateur (`docs/OWNER-GUIDE.md` §3) |
| La version est-elle à jour ? | `Paramètres` › `À propos` | Une version installée antérieure à la correction peut encore présenter le défaut : réinstallez depuis la dernière version |

**Ce qu'il ne faut pas faire** : réinstaller en boucle. Le journal de diagnostic dit
laquelle des cinq causes ci-dessus s'applique, et c'est plus rapide qu'une
réinstallation. Le fichier ne contient aucun contenu de fichier, aucune clé et aucun
jeton : vous pouvez le transmettre tel quel.

## Connexion

### « Aucun chemin commun » (`NO_COMMON_TRANSPORT`)

Les deux appareils ne partagent aucune méthode utilisable. Causes réelles :

- l'autre appareil est sur un autre réseau et le relais est injoignable ;
- le navigateur ne fournit pas WebRTC (`RTCPeerConnection` absent) ;
- le code de salle a expiré (10 minutes sans activité).

À essayer : mettre les deux appareils sur le même Wi-Fi, puis relancer l'appairage.
DropForge affiche la liste des méthodes essayées et leur échec, pas un message vague.

### Deux appareils sur deux réseaux différents

DropForge n'utilise **aucun serveur STUN/TURN tiers**. Deux appareils qui ne sont pas sur
le même réseau local ont donc rarement un chemin direct… et c'est prévu : quand le chemin
direct échoue, les deux appareils basculent sur le **relais aveugle** du service de
signalisation — le même service, déjà contacté pour l'appairage, et rien de plus.

Le relais ne peut pas lire ce qu'il transporte : les trames qu'il recopie sont déjà
chiffrées de bout en bout (DF-HANDSHAKE puis AES-256-GCM). Il voit des adresses IP, des
horaires, un volume : jamais un nom de fichier ni un octet de contenu. L'interface
l'affiche au lieu de le cacher — « Méthode : relais aveugle » sur l'appareil connecté.

Deux conséquences à connaître :

- c'est plus lent qu'un chemin direct (tout passe par le service), et cela consomme la
  bande passante du service plutôt que la vôtre ;
- sur le même réseau local, rien de tout cela n'est utilisé : les deux appareils se
  trouvent directement, sans intermédiaire.

Un déploiement qui préfère un chemin direct entre deux réseaux distants peut configurer
un serveur STUN/TURN et reconstruire l'application :
`VITE_ICE_URLS=stun:stun.exemple.org:3478,turn:turn.exemple.org npm run build:web`.
Attention : ce serveur voit alors votre adresse IP publique (voir `docs/PRIVACY.md`), et
le relais reste le dernier recours si ce chemin échoue aussi.

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
