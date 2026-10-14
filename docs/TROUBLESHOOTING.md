# Dépannage

Chaque entrée dit quoi faire, et ce que DropForge affiche dans ce cas. Si un message
ne correspond à rien ici, c'est un défaut de documentation : à signaler.

## Windows : deux défauts connus de l'installateur publié (0.1.1)

**Statut, sans embellissement.** Les deux défauts ci-dessous ont été signalés, leur cause
est identifiée dans le code de l'installateur, et les corrections sont écrites et
couvertes par les tests du dépôt (voir `docs/PLATFORM-MATRIX.md`). **Aucun installateur
corrigé n'a encore été publié** : tant que ce n'est pas le cas, n'installez pas les
fichiers de la version 0.1.1, et suivez les étapes de récupération ci-dessous.

### 1. L'écran de démarrage reste affiché, l'interface n'arrive pas

**Ce qui se passe.** La fenêtre s'ouvre — les contrôles de secours côté Rust font leur
travail — mais elle reste sur le texte « DropForge — démarrage… » : le paquet de
l'interface n'a pas démarré (fichier manquant, erreur de syntaxe, exception avant le
premier rendu), et **rien à l'écran ne le disait**. C'est le vrai défaut : l'écran de
démarrage ne disait pas pourquoi il restait là.

**Ce qui est corrigé.** Un contrôle de secours écrit dans la page
(`apps/desktop/index.html`) s'exécute **avant** le paquet de l'interface, n'importe rien
— il ne peut donc pas échouer pour la même raison — et :

1. écoute les erreurs de chargement, les exceptions et les promesses rejetées ;
2. au bout de **15 secondes**, ou dès qu'une erreur est connue, il **remplace l'écran de
   démarrage par la cause réelle**, avec le chemin du journal de diagnostic et un bouton
   pour copier le détail ;
3. écrit aussi la cause dans le journal de diagnostic via la commande `report_problem`.

**En attendant une version corrigée**, ce que le journal dit et ce que ça veut dire :

| Ligne du journal (`%APPDATA%\org.dropforge.app\diagnostics.log`) | Cause | Ce qu'on peut faire |
| --- | --- | --- |
| `interface` / `render` | Le paquet de l'interface n'a pas démarré | Utiliser l'application web (`docs/DOWNLOAD.md`) ; l'application Windows sera corrigée dans la prochaine version |
| `window` | La fenêtre n'a pas pu être affichée | Vérifier les pilotes d'affichage et la mise à jour de WebView2 |
| `data`, `identity`, `settings` | La base SQLite locale n'a pas pu être ouverte | Antivirus ou dossier protégé : autoriser `%APPDATA%\org.dropforge.app` |

### 2. « L'application est en cours d'exécution » — désinstallation refusée, réinstallation impossible

**Ce qui se passe.** L'installateur et le désinstallateur NSIS de Tauri ne cherchent pas
de processus : ils demandent au **Windows Restart Manager** qui utilise le fichier
`%LOCALAPPDATA%\DropForge\DropForge.exe`. Dès que la réponse est « des programmes
utilisent ce fichier », ils affichent « l'application est en cours d'exécution » et
s'arrêtent — **même quand l'application ne tourne pas**. Tiennent ce fichier, tour à
tour : une instance restée en arrière-plan (le réglage « continuer en arrière-plan » la
garde vivante), le démarrage automatique, un antivirus qui l'analyse, l'Explorateur, ou
un processus laissé par une version précédente.

**Pourquoi supprimer les fichiers à la main ne suffit pas.** L'entrée de désinstallation
reste dans le registre (`HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\
DropForge`) : Windows continue de proposer une désinstallation qui vise un fichier
absent, et la page de réinstallation de l'installateur, qui ne consulte **que le
registre**, propose de désinstaller d'abord une installation qui n'existe plus.

**Ce qui est corrigé.** Le hook `installer/hooks.nsh` ferme d'abord l'application
(`taskkill`), puis **écarte l'exécutable du chemin exact que le contrôle interroge**
(`DropForge.exe` → `DropForge.exe.df-ecarte`) : un fichier renommé n'a plus
d'utilisateurs, donc le contrôle passe. Le fichier écarté est supprimé juste après, et
si le renommage échoue parce qu'un autre programme tient réellement le fichier, le
journal d'installation le dit au lieu de laisser croire à une application fantôme.

**Récupérer une installation coincée, maintenant.** Dans l'ordre — chaque étape est
indépendante :

1. **Réessayer en cliquant OK** (et non Annuler) dans la boîte « fermer l'application » :
   OK demande à Windows de fermer les programmes qui tiennent le fichier.
2. **Fermer l'application puis redésinstaller** : `taskkill /F /IM DropForge.exe` dans
   une invite de commandes, puis relancer la désinstallation.
3. **Écarter le fichier à la main, puis redésinstaller** :
   `ren "%LOCALAPPDATA%\DropForge\DropForge.exe" DropForge.exe.ecarte`
4. **Nettoyage complet** (installations dont les fichiers ont été supprimés à la main) :
   le script du dépôt fait le constat puis, seulement sur demande, le nettoyage —
   processus, entrées de désinstallation, démarrage automatique, dossiers du programme,
   raccourcis. Il ne touche **jamais** aux fichiers reçus, et les données locales
   (historique, appareils de confiance, réglages) ne partent qu'avec `-RemoveData` :

   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts\unblock-windows.ps1            # constat, rien n'est modifié
   powershell -ExecutionPolicy Bypass -File scripts\unblock-windows.ps1 -Apply     # nettoyage, étape par étape
   ```

   Si vous ne voulez pas exécuter de script, les commandes équivalentes sont listées
   dans `docs/OWNER-GUIDE.md` § 5 (rubrique « réinstallation impossible »), et elles se
   lisent avant d'être collées.

5. **Ne réinstallez pas en boucle** : chaque tentative laisse une entrée de registre
   supplémentaire. Terminez le nettoyage d'abord.

## Windows : je lance DropForge et rien ne s'ouvre

C'était un vrai défaut, il est corrigé — mais la réponse reste utile si vous utilisez
une version plus ancienne, ou si un échec de démarrage se produit malgré tout.

**Ce que fait DropForge maintenant.** Il ouvre sa fenêtre même quand son interface ne
démarre pas :

1. la fenêtre est demandée **avant** tout le reste ;
2. deux contrôles de secours (Rust) l'affichent après 700 ms puis 12 s si personne ne
   l'a demandée — vous voyez alors l'écran d'attente, puis soit l'application, soit un
   écran qui dit ce qui a échoué ;
2 bis. l'écran d'attente lui-même porte un contrôle de secours **écrit dans la page** :
   au bout de 15 s, ou dès qu'une erreur de chargement est vue, il remplace le texte de
   démarrage par la cause réelle (voir la section précédente) ;
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
