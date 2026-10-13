/**
 * Translation dictionaries. French is the reference (the project's language),
 * English the alternative; both must carry exactly the same keys — a test fails
 * if one is missing something, because a missing label means a code shown raw to
 * the user.
 *
 * Nothing here is generated from user data: every string is written by hand.
 */

export interface Dictionary {
  app: {
    name: string;
    tagline: string;
    loading: string;
    offline: string;
    installPrompt: string;
    installAction: string;
    installIos: string;
    installLater: string;
  };
  notify: {
    sentTitle: string;
    sentBody: string;
    receivedTitle: string;
    receivedBody: string;
    failedTitle: string;
    failedBody: string;
    interruptedTitle: string;
    interruptedBody: string;
  };
  nav: {
    transfer: string;
    devices: string;
    activity: string;
    settings: string;
  };
  transfer: {
    title: string;
    subtitle: string;
    selectFiles: string;
    selectFolder: string;
    selected: string;
    dropHint: string;
    dropTarget: string;
    dropNothing: string;
    quickSend: string;
    quickSendHint: string;
    clear: string;
    sendTo: string;
    noDevices: string;
    waitingPeer: string;
    receiveDevice: string;
    receiveDeviceHint: string;
    hosting: string;
    hostingHint: string;
    closeRoom: string;
    qrAlt: string;
    pairingCode: string;
    copyLink: string;
    linkCopied: string;
    pasteCode: string;
    connect: string;
    confirmDevice: string;
    confirmDeviceHint: string;
    compareCode: string;
    accept: string;
    refuse: string;
    queue: string;
    emptyQueue: string;
    incomingRequest: string;
    incomingFiles: string;
    conflictsFound: string;
    conflictAskSkip: string;
    conflictAskRename: string;
    conflictAskReplace: string;
    pause: string;
    resume: string;
    cancel: string;
    retry: string;
    remove: string;
    moveUp: string;
    moveDown: string;
    speed: string;
    eta: string;
    filesProgress: string;
    method: string;
    methodLan: string;
    methodWebrtc: string;
    methodRelay: string;
    sasWarning: string;
  };
  devices: {
    title: string;
    subtitle: string;
    known: string;
    trusted: string;
    untrusted: string;
    revoked: string;
    lastSeen: string;
    trust: string;
    revoke: string;
    remove: string;
    rename: string;
    empty: string;
    fingerprint: string;
    autoAccept: string;
    revokedNotice: string;
    markFavorite: string;
    unmarkFavorite: string;
    unknown: string;
  };
  activity: {
    title: string;
    subtitle: string;
    search: string;
    filterAll: string;
    filterSend: string;
    filterReceive: string;
    filterFailed: string;
    empty: string;
    emptyFiltered: string;
    deleteOne: string;
    deleteAll: string;
    deleteAllConfirm: string;
    export: string;
    stats: string;
    verified: string;
    notVerified: string;
    partialNotice: string;
  };
  settings: {
    title: string;
    subtitle: string;
    general: string;
    language: string;
    theme: string;
    themeDark: string;
    themeLight: string;
    themeSystem: string;
    notifications: string;
    notificationsUnsupported: string;
    enableNotifications: string;
    autostart: string;
    autostartWindowsOnly: string;
    closeBehaviour: string;
    closeTray: string;
    closeQuit: string;
    transfers: string;
    receiveFolder: string;
    receiveFolderChoose: string;
    receiveFolderNone: string;
    conflictPolicy: string;
    policyAsk: string;
    policyRename: string;
    policySkip: string;
    policyOverwrite: string;
    concurrency: string;
    maxTransferSize: string;
    noLimit: string;
    trustedDevicesOnly: string;
    privacy: string;
    diagnostics: string;
    hostedSharing: string;
    hostedSharingUnavailable: string;
    historyRetention: string;
    keepForever: string;
    days: string;
    reset: string;
    resetConfirm: string;
    saved: string;
    about: string;
    aboutText: string;
    license: string;
    checkUpdate: string;
    installUpdate: string;
    relaunch: string;
    updateIdle: string;
    updateChecking: string;
    updateAvailable: string;
    updateUpToDate: string;
    updateInstalling: string;
    updateReady: string;
    updateUnsupported: string;
    updateUnregistered: string;
    updateCheckFailed: string;
    updateNothingToInstall: string;
    updateWebNote: string;
    storageEstimate: string;
    installed: string;
    notInstalled: string;
    receiveFolderAllow: string;
    receiveFolderReady: string;
    receiveFolderNeedsPermission: string;
    receiveFolderUnsupported: string;
    privacyText: string;
    diagnosticsNote: string;
    hostedSharingNote: string;
    resetIdentity: string;
    resetIdentityNote: string;
    identityReset: string;
  };
  states: {
    queued: string;
    connecting: string;
    transferring: string;
    paused: string;
    interrupted: string;
    verifying: string;
    completed: string;
    cancelled: string;
    failed: string;
  };
  capabilities: {
    title: string;
    available: string;
    unavailable: string;
    hasWebrtc: string;
    hasDirectoryPicker: string;
    hasDirectoryRead: string;
    hasNotifications: string;
    hasStorageEstimate: string;
    hasServiceWorker: string;
    hasBackgroundReceive: string;
    backgroundReceiveNote: string;
    hasDownloadStream: string;
    downloadFallbackNote: string;
    iosNote: string;
    disclaimer: string;
  };
  common: {
    close: string;
    confirm: string;
    cancel: string;
    yes: string;
    no: string;
    unknown: string;
    unknownDevice: string;
    seconds: string;
    minutes: string;
    bytes: string;
    copy: string;
    copied: string;
    details: string;
    hide: string;
  };
  errors: Record<string, string>;
}

export const FR: Dictionary = {
  app: {
    name: 'DropForge',
    tagline: 'Transférer des fichiers entre vos appareils, sans compte.',
    loading: 'Chargement…',
    offline: 'Le relais est injoignable : seuls les transferts sur le réseau local fonctionneront.',
    installPrompt: 'Installer DropForge sur cet appareil',
    installAction: 'Installer',
    installIos: 'Sur iPhone ou iPad : bouton Partager, puis « Sur l’écran d’accueil ».',
    installLater: 'Plus tard',
  },
  notify: {
    sentTitle: 'Envoi terminé',
    sentBody: '{{count}} fichier(s) envoyés vers {{peer}}.',
    receivedTitle: 'Réception terminée',
    receivedBody: '{{count}} fichier(s) reçus de {{peer}}.',
    failedTitle: 'Transfert échoué',
    failedBody: '{{peer}} — {{reason}}',
    interruptedTitle: 'Transfert interrompu',
    interruptedBody: '{{peer}} — la connexion a été perdue. La reprise repartira de ce qui a été écrit.',
  },
  nav: {
    transfer: 'Transfert',
    devices: 'Appareils',
    activity: 'Historique',
    settings: 'Réglages',
  },
  transfer: {
    title: 'Transfert',
    subtitle: 'Vos fichiers passent directement entre vos appareils, chiffrés de bout en bout.',
    selectFiles: 'Choisir des fichiers',
    selectFolder: 'Choisir un dossier',
    selected: '{{count}} élément(s) sélectionné(s) — {{size}}',
    dropHint: 'Vous pouvez aussi déposer des fichiers ou un dossier ici.',
    dropTarget: 'Déposez pour ajouter',
    dropNothing: 'Rien n’a pu être lu dans ce dépôt.',
    quickSend: 'Envoi rapide',
    quickSendHint: 'En une seule action : connecte l’appareil si besoin, puis envoie la sélection.',
    clear: 'Vider la sélection',
    sendTo: 'Envoyer vers',
    noDevices: 'Aucun appareil joignable pour le moment.',
    waitingPeer: 'En attente d’un appareil…',
    receiveDevice: 'Recevoir d’un appareil',
    receiveDeviceHint: 'Affichez un code : l’autre appareil le saisit, ou scanne le QR code.',
    hosting: 'En attente d’un appareil…',
    hostingHint: 'Sur l’autre appareil, ouvrez DropForge et saisissez ce code (ou scannez le QR code).',
    closeRoom: 'Fermer l’attente',
    qrAlt: 'QR code d’appairage',
    pairingCode: 'Code d’appairage',
    copyLink: 'Copier le lien',
    linkCopied: 'Lien copié',
    pasteCode: 'Coller un code ou un lien',
    connect: 'Se connecter',
    confirmDevice: 'Nouvel appareil',
    confirmDeviceHint:
      'Comparez le code ci-dessous avec celui affiché sur l’autre appareil. S’ils sont identiques, la connexion est sûre.',
    compareCode: 'Code à comparer',
    accept: 'Accepter',
    refuse: 'Refuser',
    queue: 'File d’attente',
    emptyQueue: 'Aucun transfert en cours.',
    incomingRequest: 'Demande de réception',
    incomingFiles: '{{count}} fichier(s), {{size}}',
    conflictsFound: 'Certains fichiers existent déjà sur cet appareil.',
    conflictAskSkip: 'Ignorer',
    conflictAskRename: 'Renommer',
    conflictAskReplace: 'Remplacer',
    pause: 'Pause',
    resume: 'Reprendre',
    cancel: 'Annuler',
    retry: 'Réessayer',
    remove: 'Retirer',
    moveUp: 'Monter',
    moveDown: 'Descendre',
    speed: 'Vitesse',
    eta: 'Temps restant',
    filesProgress: 'Fichiers',
    method: 'Chemin utilisé',
    methodLan: 'Réseau local',
    methodWebrtc: 'Connexion directe (WebRTC)',
    methodRelay: 'Relais aveugle',
    sasWarning: 'Les codes ne correspondent pas : refusez la connexion.',
  },
  devices: {
    title: 'Appareils',
    subtitle: 'Les appareils que cet appareil a déjà vus, et ceux que vous avez approuvés.',
    known: 'Connu',
    trusted: 'Approuvé',
    untrusted: 'Non approuvé',
    revoked: 'Approbation révoquée',
    lastSeen: 'Vu {{when}}',
    trust: 'Approuver',
    revoke: 'Révoquer',
    remove: 'Oublier',
    rename: 'Renommer',
    empty: 'Aucun appareil connu pour l’instant.',
    fingerprint: 'Empreinte',
    autoAccept: 'Accepter automatiquement',
    revokedNotice: 'Cet appareil devra être approuvé de nouveau avant tout nouveau transfert.',
    markFavorite: 'Mettre en favori',
    unmarkFavorite: 'Retirer des favoris',
    unknown: 'Cet appareil n’est pas connu de cette installation.',
  },
  activity: {
    title: 'Historique',
    subtitle: 'Tout reste sur cet appareil. Vous pouvez supprimer n’importe quelle entrée.',
    search: 'Rechercher un appareil, un nom de fichier…',
    filterAll: 'Tout',
    filterSend: 'Envoyés',
    filterReceive: 'Reçus',
    filterFailed: 'Échecs',
    empty: 'Aucun transfert enregistré.',
    emptyFiltered: 'Aucun transfert ne correspond à cette recherche.',
    deleteOne: 'Supprimer',
    deleteAll: 'Tout supprimer',
    deleteAllConfirm: 'Supprimer définitivement tout l’historique ?',
    export: 'Exporter en JSON',
    stats: '{{transfers}} transfert(s) — {{sent}} envoyés, {{received}} reçus',
    verified: 'Vérifié',
    notVerified: 'Non vérifié',
    partialNotice: 'Une partie des fichiers n’a pas été envoyée ni vérifiée.',
  },
  settings: {
    title: 'Réglages',
    subtitle: 'Tout est local : aucun réglage n’est envoyé nulle part.',
    general: 'Général',
    language: 'Langue',
    theme: 'Thème',
    themeDark: 'Sombre',
    themeLight: 'Clair',
    themeSystem: 'Système',
    notifications: 'Notifications',
    notificationsUnsupported: 'Ce navigateur ne permet pas les notifications.',
    enableNotifications: 'Activer les notifications',
    autostart: 'Lancer au démarrage de Windows',
    autostartWindowsOnly: 'Disponible uniquement dans l’application Windows.',
    closeBehaviour: 'À la fermeture de la fenêtre',
    closeTray: 'Continuer en arrière-plan',
    closeQuit: 'Quitter DropForge',
    transfers: 'Transferts',
    receiveFolder: 'Dossier de réception',
    receiveFolderChoose: 'Choisir un dossier',
    receiveFolderNone: 'Demander à chaque fois',
    conflictPolicy: 'En cas de conflit de nom',
    policyAsk: 'Demander à chaque fois',
    policyRename: 'Renommer automatiquement',
    policySkip: 'Ignorer le fichier',
    policyOverwrite: 'Remplacer (déconseillé)',
    concurrency: 'Transferts simultanés',
    maxTransferSize: 'Taille maximale par transfert',
    noLimit: 'Aucune limite locale',
    trustedDevicesOnly: 'N’accepter que les appareils approuvés',
    privacy: 'Confidentialité',
    diagnostics: 'Journaux de diagnostic locaux',
    hostedSharing: 'Autoriser les liens hébergés (temporaires)',
    hostedSharingUnavailable:
      'Aucun service d’hébergement n’est configuré : cette option n’est donc proposée qu’en lecture. Le transfert direct et les codes d’appairage restent disponibles et ne dépendent d’aucun serveur payant.',
    historyRetention: 'Conserver l’historique',
    keepForever: 'Toujours',
    days: '{{count}} jours',
    reset: 'Réinitialiser les réglages',
    resetConfirm: 'Rétablir tous les réglages par défaut ?',
    saved: 'Réglages enregistrés',
    about: 'À propos',
    aboutText: 'DropForge {{version}} — logiciel libre, sans compte et sans service payant.',
    license: 'La licence du projet reste à définir ; les licences des composants utilisés sont listées dans docs/LICENCES.md.',
    checkUpdate: 'Rechercher une mise à jour',
    installUpdate: 'Installer maintenant',
    relaunch: 'Redémarrer',
    updateIdle: 'Aucune recherche de mise à jour n’a encore été lancée.',
    updateChecking: 'Recherche d’une mise à jour…',
    updateAvailable: 'Une nouvelle version est prête à être installée.',
    updateUpToDate: 'DropForge est à jour.',
    updateInstalling: 'Installation de la mise à jour…',
    updateReady: 'Mise à jour installée. Redémarrez pour l’utiliser.',
    updateUnsupported: 'Cette plateforme ne permet pas de rechercher une mise à jour ici.',
    updateUnregistered: 'Aucune version installée à mettre à jour : rechargez la page pour la dernière version.',
    updateCheckFailed: 'Recherche impossible : le réseau est injoignable.',
    updateNothingToInstall: 'Aucune mise à jour n’est en attente.',
    updateWebNote: 'Dans le navigateur, la version installée est mise à jour automatiquement ; rechargez la page pour la dernière version. Les mises à jour signées concernent l’application Windows.',
    storageEstimate: 'Données locales de l’application : {{usage}} utilisés sur {{quota}} autorisés par le navigateur.',
    installed: 'Application installée sur cet appareil.',
    notInstalled: 'Affiché dans un onglet : installez l’application pour un usage hors ligne.',
    receiveFolderAllow: 'Autoriser l’accès',
    receiveFolderReady: 'Dossier de réception prêt.',
    receiveFolderNeedsPermission: 'Le navigateur demande de confirmer l’accès au dossier avant le prochain transfert.',
    receiveFolderUnsupported: 'Ce navigateur ne peut pas mémoriser un dossier : les fichiers reçus seront proposés en téléchargement.',
    privacyText: 'Vos fichiers ne passent jamais par un serveur DropForge : ils sont chiffrés de bout en bout entre vos appareils. L’historique, la liste des appareils et les réglages restent dans le stockage local de cette application.',
    diagnosticsNote: 'Aucune télémétrie n’est envoyée, dans tous les cas : ce réglage ne fait qu’autoriser des journaux locaux plus détaillés, utiles pour un rapport de bug.',
    hostedSharingNote: 'Les liens hébergés stockent une copie chiffrée sur le serveur de partage choisi, avec une expiration. Désactivez cette option pour n’utiliser que les transferts directs.',
    resetIdentity: 'Réinitialiser l’identité de cet appareil',
    resetIdentityNote: 'Une nouvelle empreinte sera générée : tous les appareils devront être appairés de nouveau.',
    identityReset: 'Nouvelle identité créée. Les appareils approuvés ont été oubliés.',
  },
  states: {
    queued: 'En attente',
    connecting: 'Connexion',
    transferring: 'Transfert',
    paused: 'En pause',
    interrupted: 'Interrompu',
    verifying: 'Vérification',
    completed: 'Terminé',
    cancelled: 'Annulé',
    failed: 'Échec',
  },
  capabilities: {
    title: 'Ce que ce navigateur sait faire',
    available: 'Disponible',
    unavailable: 'Indisponible',
    hasWebrtc: 'Connexions directes entre appareils',
    hasDirectoryPicker: 'Écrire directement dans un dossier choisi',
    hasDirectoryRead: 'Envoyer un dossier entier',
    hasNotifications: 'Notifications système',
    hasStorageEstimate: 'Estimation de l’espace disponible',
    hasServiceWorker: 'Fonctionnement hors ligne de l’interface',
    hasBackgroundReceive: 'Recevoir en arrière-plan',
    backgroundReceiveNote:
      'Sur le web, un transfert ne continue que si l’onglet reste ouvert. DropForge ne promet pas le contraire : l’application Windows, elle, continue en arrière-plan.',
    hasDownloadStream: 'Téléchargement direct d’un gros fichier',
    downloadFallbackNote:
      'Sans accès direct au disque, les fichiers reçus sont proposés au téléchargement : le navigateur les écrit lui-même, et la vérification d’intégrité a lieu avant le téléchargement.',
    iosNote:
      'Sur iOS, les transferts s’arrêtent si vous quittez Safari. Gardez l’onglet ouvert pendant la réception.',
    disclaimer:
      'Cette liste est mesurée sur votre appareil, pas promise : les fonctions indisponibles sont désactivées dans l’interface au lieu d’échouer après coup.',
  },
  common: {
    close: 'Fermer',
    confirm: 'Confirmer',
    cancel: 'Annuler',
    yes: 'Oui',
    no: 'Non',
    unknown: 'Inconnu',
    unknownDevice: 'Appareil inconnu',
    seconds: 's',
    minutes: 'min',
    bytes: 'octets',
    copy: 'Copier',
    copied: 'Copié',
    details: 'Détails',
    hide: 'Masquer',
  },
  errors: {
    NO_COMMON_TRANSPORT: 'Aucun chemin disponible entre les deux appareils pour le moment.',
    RELAY_UNAVAILABLE: 'Le relais est injoignable. Sur le même réseau Wi‑Fi, le transfert direct fonctionne sans lui.',
    RELAY_QUOTA_REACHED: 'Le relais a atteint sa limite gratuite. Utilisez le réseau local, ou réessayez plus tard.',
    PEER_UNREACHABLE: 'L’autre appareil est injoignable pour le moment.',
    CONNECTION_LOST: 'La connexion a été interrompue.',
    CONNECTION_TIMEOUT: 'La connexion a mis trop de temps à s’établir.',
    HANDSHAKE_FAILED: 'La connexion sécurisée a échoué. Si cela se reproduit, vérifiez le code affiché sur les deux appareils.',
    DEVICE_NOT_TRUSTED: 'Cet appareil n’est pas approuvé.',
    DEVICE_IDENTITY_MISMATCH: 'L’appareil qui répond n’est pas celui qui a été annoncé. Connexion refusée par précaution.',
    DEVICE_REVOKED: 'Cet appareil a été révoqué sur cet ordinateur.',
    PAIRING_CODE_INVALID: 'Ce code d’appairage n’est pas valide.',
    PAIRING_CODE_EXPIRED: 'Ce code d’appairage a expiré : demandez-en un nouveau.',
    PAIRING_SECRET_MISMATCH: 'Le lien d’appairage ne correspond pas à cet appareil.',
    SAS_MISMATCH: 'Les codes de sécurité ne correspondent pas. Refusez la connexion.',
    NO_SPACE_LEFT: 'Il n’y a plus assez d’espace libre sur l’appareil de destination.',
    PERMISSION_DENIED: 'L’autorisation nécessaire a été refusée.',
    PATH_UNSAFE: 'Un fichier annoncé sortait du dossier de réception : il a été refusé.',
    NAME_CONFLICT: 'Un fichier du même nom existe déjà et aucune décision n’a été prise.',
    WRITE_FAILED: 'L’écriture du fichier a échoué.',
    RESUME_MISMATCH: 'La reprise n’est pas possible pour ce fichier : il sera retransféré en entier.',
    READ_FAILED: 'Un fichier n’a pas pu être lu.',
    SOURCE_CHANGED: 'Un fichier a changé pendant le transfert.',
    QUOTA_EXCEEDED: 'L’espace de stockage alloué à ce site est plein.',
    STORAGE_UNAVAILABLE: 'Le stockage local est indisponible.',
    TRANSFER_DECLINED: 'Le transfert a été refusé par l’autre appareil.',
    TRANSFER_CANCELLED: 'Le transfert a été annulé.',
    INTEGRITY_FAILED: 'La vérification d’intégrité a échoué : le fichier reçu ne correspond pas.',
    UNSUPPORTED_OPERATION: 'Cette opération n’est pas prise en charge ici.',
    TOO_MANY_FILES: 'Trop de fichiers dans ce transfert.',
    TOO_LARGE: 'Ce transfert est trop volumineux pour la destination choisie.',
    TOO_MANY_TRANSFERS: 'Trop de transferts en cours : attendez qu’un autre se termine.',
    BUSY: 'L’autre appareil est occupé.',
    CRYPTO_UNAVAILABLE: 'Ce navigateur ne fournit pas le chiffrement nécessaire.',
    IDENTITY_UNAVAILABLE: 'L’identité de cet appareil est indisponible.',
    PLATFORM_UNSUPPORTED: 'Cette fonction n’est pas disponible sur cet appareil.',
    BACKGROUND_UNSUPPORTED:
      'Un navigateur ne peut pas transférer en arrière-plan : gardez l’onglet ouvert pendant l’échange.',
    APP_CLOSED: 'L’application s’est fermée avant la fin du transfert.',
    HOSTED_SHARING_DISABLED: 'Les liens hébergés sont désactivés dans vos réglages.',
    LINK_EXPIRED: 'Ce lien a expiré.',
    LINK_REVOKED: 'Ce lien a été révoqué par son expéditeur.',
    LINK_NOT_FOUND: 'Ce lien n’existe plus.',
    LINK_QUOTA_REACHED: 'Ce lien a atteint sa limite de téléchargements.',
  },
};

export const EN: Dictionary = {
  app: {
    name: 'DropForge',
    tagline: 'Move files between your devices, with no account.',
    loading: 'Loading…',
    offline: 'The relay is unreachable: only local network transfers will work.',
    installPrompt: 'Install DropForge on this device',
    installAction: 'Install',
    installIos: 'On iPhone or iPad: the Share button, then “Add to Home Screen”.',
    installLater: 'Later',
  },
  notify: {
    sentTitle: 'Send complete',
    sentBody: '{{count}} file(s) sent to {{peer}}.',
    receivedTitle: 'Receive complete',
    receivedBody: '{{count}} file(s) received from {{peer}}.',
    failedTitle: 'Transfer failed',
    failedBody: '{{peer}} — {{reason}}',
    interruptedTitle: 'Transfer interrupted',
    interruptedBody: '{{peer}} — the connection was lost. Resuming starts from what was already written.',
  },
  nav: {
    transfer: 'Transfer',
    devices: 'Devices',
    activity: 'Activity',
    settings: 'Settings',
  },
  transfer: {
    title: 'Transfer',
    subtitle: 'Files travel directly between your devices, end-to-end encrypted.',
    selectFiles: 'Choose files',
    selectFolder: 'Choose a folder',
    selected: '{{count}} item(s) selected — {{size}}',
    dropHint: 'You can also drop files or a folder here.',
    dropTarget: 'Drop to add',
    dropNothing: 'Nothing could be read from that drop.',
    quickSend: 'Quick send',
    quickSendHint: 'One action: connects the device if needed, then sends the selection.',
    clear: 'Clear selection',
    sendTo: 'Send to',
    noDevices: 'No device is reachable right now.',
    waitingPeer: 'Waiting for a device…',
    receiveDevice: 'Receive from a device',
    receiveDeviceHint: 'Show a code: the other device types it in, or scans the QR code.',
    hosting: 'Waiting for a device…',
    hostingHint: 'On the other device, open DropForge and type this code (or scan the QR code).',
    closeRoom: 'Stop waiting',
    qrAlt: 'Pairing QR code',
    pairingCode: 'Pairing code',
    copyLink: 'Copy link',
    linkCopied: 'Link copied',
    pasteCode: 'Paste a code or a link',
    connect: 'Connect',
    confirmDevice: 'New device',
    confirmDeviceHint:
      'Compare the code below with the one shown on the other device. If they match, the connection is safe.',
    compareCode: 'Code to compare',
    accept: 'Accept',
    refuse: 'Refuse',
    queue: 'Queue',
    emptyQueue: 'No transfer running.',
    incomingRequest: 'Incoming request',
    incomingFiles: '{{count}} file(s), {{size}}',
    conflictsFound: 'Some files already exist on this device.',
    conflictAskSkip: 'Skip',
    conflictAskRename: 'Rename',
    conflictAskReplace: 'Replace',
    pause: 'Pause',
    resume: 'Resume',
    cancel: 'Cancel',
    retry: 'Retry',
    remove: 'Remove',
    moveUp: 'Move up',
    moveDown: 'Move down',
    speed: 'Speed',
    eta: 'Time left',
    filesProgress: 'Files',
    method: 'Path used',
    methodLan: 'Local network',
    methodWebrtc: 'Direct connection (WebRTC)',
    methodRelay: 'Blind relay',
    sasWarning: 'The codes do not match: refuse the connection.',
  },
  devices: {
    title: 'Devices',
    subtitle: 'Devices this installation has seen, and the ones you approved.',
    known: 'Known',
    trusted: 'Approved',
    untrusted: 'Not approved',
    revoked: 'Approval revoked',
    lastSeen: 'Seen {{when}}',
    trust: 'Approve',
    revoke: 'Revoke',
    remove: 'Forget',
    rename: 'Rename',
    empty: 'No device known yet.',
    fingerprint: 'Fingerprint',
    autoAccept: 'Accept automatically',
    revokedNotice: 'This device will have to be approved again before any new transfer.',
    markFavorite: 'Mark as favourite',
    unmarkFavorite: 'Remove from favourites',
    unknown: 'This installation does not know that device.',
  },
  activity: {
    title: 'Activity',
    subtitle: 'Everything stays on this device. You can delete any entry.',
    search: 'Search a device or a file name…',
    filterAll: 'All',
    filterSend: 'Sent',
    filterReceive: 'Received',
    filterFailed: 'Failed',
    empty: 'No transfer recorded.',
    emptyFiltered: 'No transfer matches this search.',
    deleteOne: 'Delete',
    deleteAll: 'Delete all',
    deleteAllConfirm: 'Permanently delete the whole history?',
    export: 'Export as JSON',
    stats: '{{transfers}} transfer(s) — {{sent}} sent, {{received}} received',
    verified: 'Verified',
    notVerified: 'Not verified',
    partialNotice: 'Some files were not sent or not verified.',
  },
  settings: {
    title: 'Settings',
    subtitle: 'Everything is local: no setting is sent anywhere.',
    general: 'General',
    language: 'Language',
    theme: 'Theme',
    themeDark: 'Dark',
    themeLight: 'Light',
    themeSystem: 'System',
    notifications: 'Notifications',
    notificationsUnsupported: 'This browser does not allow notifications.',
    enableNotifications: 'Enable notifications',
    autostart: 'Start with Windows',
    autostartWindowsOnly: 'Only available in the Windows application.',
    closeBehaviour: 'When closing the window',
    closeTray: 'Keep running in the background',
    closeQuit: 'Quit DropForge',
    transfers: 'Transfers',
    receiveFolder: 'Receiving folder',
    receiveFolderChoose: 'Choose a folder',
    receiveFolderNone: 'Ask every time',
    conflictPolicy: 'On a name conflict',
    policyAsk: 'Ask every time',
    policyRename: 'Rename automatically',
    policySkip: 'Skip the file',
    policyOverwrite: 'Replace (not recommended)',
    concurrency: 'Simultaneous transfers',
    maxTransferSize: 'Maximum size per transfer',
    noLimit: 'No local limit',
    trustedDevicesOnly: 'Accept approved devices only',
    privacy: 'Privacy',
    diagnostics: 'Local diagnostic logs',
    hostedSharing: 'Allow hosted (temporary) links',
    hostedSharingUnavailable:
      'No hosting service is configured, so this option is shown read-only. Direct transfers and pairing codes remain available and need no paid server.',
    historyRetention: 'Keep history for',
    keepForever: 'Forever',
    days: '{{count}} days',
    reset: 'Reset settings',
    resetConfirm: 'Restore every default setting?',
    saved: 'Settings saved',
    about: 'About',
    aboutText: 'DropForge {{version}} — free software, no account and no paid service.',
    license: 'The project’s licence is still to be decided; the licences of the components it uses are listed in docs/LICENCES.md.',
    checkUpdate: 'Check for an update',
    installUpdate: 'Install now',
    relaunch: 'Restart',
    updateIdle: 'No update check has been run yet.',
    updateChecking: 'Checking for an update…',
    updateAvailable: 'A new version is ready to install.',
    updateUpToDate: 'DropForge is up to date.',
    updateInstalling: 'Installing the update…',
    updateReady: 'Update installed. Restart to use it.',
    updateUnsupported: 'This platform cannot check for updates here.',
    updateUnregistered: 'Nothing is installed to update: reload the page for the latest version.',
    updateCheckFailed: 'Check failed: the network is unreachable.',
    updateNothingToInstall: 'No update is waiting.',
    updateWebNote: 'In a browser, the installed version updates itself; reload the page for the latest build. Signed updates concern the Windows application.',
    storageEstimate: 'Local application data: {{usage}} used of {{quota}} allowed by the browser.',
    installed: 'Application installed on this device.',
    notInstalled: 'Running in a tab: install the application for offline use.',
    receiveFolderAllow: 'Allow access',
    receiveFolderReady: 'Receiving folder ready.',
    receiveFolderNeedsPermission: 'The browser will ask you to confirm access to the folder before the next transfer.',
    receiveFolderUnsupported: 'This browser cannot remember a folder: received files will be offered as downloads.',
    privacyText: 'Your files never go through a DropForge server: they are encrypted end to end between your devices. History, known devices and settings stay in this application’s local storage.',
    diagnosticsNote: 'No telemetry is ever sent: this setting only allows more detailed local logs, useful for a bug report.',
    hostedSharingNote: 'Hosted links store an encrypted copy on the sharing server you choose, with an expiry. Turn this off to use direct transfers only.',
    resetIdentity: 'Reset this device’s identity',
    resetIdentityNote: 'A new fingerprint will be generated: every device will have to be paired again.',
    identityReset: 'New identity created. Trusted devices have been forgotten.',
  },
  states: {
    queued: 'Queued',
    connecting: 'Connecting',
    transferring: 'Transferring',
    paused: 'Paused',
    interrupted: 'Interrupted',
    verifying: 'Verifying',
    completed: 'Completed',
    cancelled: 'Cancelled',
    failed: 'Failed',
  },
  capabilities: {
    title: 'What this browser can do',
    available: 'Available',
    unavailable: 'Unavailable',
    hasWebrtc: 'Direct connections between devices',
    hasDirectoryPicker: 'Write straight into a chosen folder',
    hasDirectoryRead: 'Send a whole folder',
    hasNotifications: 'System notifications',
    hasStorageEstimate: 'Free space estimate',
    hasServiceWorker: 'Offline user interface',
    hasBackgroundReceive: 'Receive in the background',
    backgroundReceiveNote:
      'On the web a transfer only continues while the tab stays open. DropForge does not claim otherwise: the Windows app does continue in the background.',
    hasDownloadStream: 'Streaming download of a large file',
    downloadFallbackNote:
      'Without direct disk access, received files are offered as a download: the browser writes them itself, and the integrity check happens before the download.',
    iosNote: 'On iOS, transfers stop if you leave Safari. Keep the tab open while receiving.',
    disclaimer:
      'This list is measured on your device, not promised: features that are unavailable are disabled in the interface instead of failing later.',
  },
  common: {
    close: 'Close',
    confirm: 'Confirm',
    cancel: 'Cancel',
    yes: 'Yes',
    no: 'No',
    unknown: 'Unknown',
    unknownDevice: 'Unknown device',
    seconds: 's',
    minutes: 'min',
    bytes: 'bytes',
    copy: 'Copy',
    copied: 'Copied',
    details: 'Details',
    hide: 'Hide',
  },
  errors: {
    NO_COMMON_TRANSPORT: 'No path is available between the two devices right now.',
    RELAY_UNAVAILABLE: 'The relay is unreachable. On the same Wi-Fi the direct transfer works without it.',
    RELAY_QUOTA_REACHED: 'The relay reached its free limit. Use the local network, or try again later.',
    PEER_UNREACHABLE: 'The other device cannot be reached right now.',
    CONNECTION_LOST: 'The connection was interrupted.',
    CONNECTION_TIMEOUT: 'The connection took too long to establish.',
    HANDSHAKE_FAILED: 'The secure connection failed. If it happens again, check the code shown on both devices.',
    DEVICE_NOT_TRUSTED: 'This device is not approved.',
    DEVICE_IDENTITY_MISMATCH: 'The device that answered is not the one that was announced. Connection refused as a precaution.',
    DEVICE_REVOKED: 'This device was revoked on this computer.',
    PAIRING_CODE_INVALID: 'This pairing code is not valid.',
    PAIRING_CODE_EXPIRED: 'This pairing code expired: ask for a new one.',
    PAIRING_SECRET_MISMATCH: 'The pairing link does not belong to this device.',
    SAS_MISMATCH: 'The security codes do not match. Refuse the connection.',
    NO_SPACE_LEFT: 'There is not enough free space left on the receiving device.',
    PERMISSION_DENIED: 'The permission needed for this action was refused.',
    PATH_UNSAFE: 'An announced file was trying to leave the receiving folder: it was refused.',
    NAME_CONFLICT: 'A file with the same name already exists and no decision was made.',
    WRITE_FAILED: 'Writing the file failed.',
    RESUME_MISMATCH: 'This file cannot be resumed: it will be sent again from the start.',
    READ_FAILED: 'A file could not be read.',
    SOURCE_CHANGED: 'A file changed while it was being transferred.',
    QUOTA_EXCEEDED: 'The storage this site is allowed to use is full.',
    STORAGE_UNAVAILABLE: 'Local storage is unavailable.',
    TRANSFER_DECLINED: 'The other device refused the transfer.',
    TRANSFER_CANCELLED: 'The transfer was cancelled.',
    INTEGRITY_FAILED: 'The integrity check failed: the received file does not match.',
    UNSUPPORTED_OPERATION: 'This operation is not supported here.',
    TOO_MANY_FILES: 'Too many files in this transfer.',
    TOO_LARGE: 'This transfer is too large for the chosen destination.',
    TOO_MANY_TRANSFERS: 'Too many transfers running: wait for another one to finish.',
    BUSY: 'The other device is busy.',
    CRYPTO_UNAVAILABLE: 'This browser does not provide the required encryption.',
    IDENTITY_UNAVAILABLE: 'This device identity is unavailable.',
    PLATFORM_UNSUPPORTED: 'This feature is not available on this device.',
    BACKGROUND_UNSUPPORTED:
      'A browser cannot transfer in the background: keep the tab open during the exchange.',
    APP_CLOSED: 'The application closed before the transfer finished.',
    HOSTED_SHARING_DISABLED: 'Hosted links are disabled in your settings.',
    LINK_EXPIRED: 'This link has expired.',
    LINK_REVOKED: 'This link was revoked by its sender.',
    LINK_NOT_FOUND: 'This link no longer exists.',
    LINK_QUOTA_REACHED: 'This link reached its download limit.',
  },
};

export const DICTIONARIES = { fr: FR, en: EN } as const;
export type Locale = keyof typeof DICTIONARIES;
