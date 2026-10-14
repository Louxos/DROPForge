; Hooks de l'installateur et du désinstallateur NSIS de DropForge.
;
; Ce fichier est compilé par le modèle NSIS officiel de Tauri
; (`bundle.windows.nsis.installerHooks`, voir `tauri.conf.json`). Il ne remplace pas ce
; modèle : il ajoute seulement le geste que Windows exige pour qu'une installation et
; une désinstallation se passent proprement.
;
; Ce qui n'est **pas** fait ici, et c'est volontaire : la suppression des données
; locales. Le modèle officiel affiche déjà, sur la page de confirmation de la
; désinstallation, une case « Delete app data » (décochée par défaut) qui supprime
; `%APPDATA%\<identifiant>` et `%LOCALAPPDATA%\<identifiant>` — exactement les deux
; dossiers que DropForge utilise pour la base SQLite (identité, appareils, historique),
; les préférences système, le journal de diagnostic et les données du moteur
; d'affichage. Poser une seconde question ici ferait double emploi et, pire,
; supprimerait des données que la personne a explicitement choisi de garder.
;
; Les fichiers reçus vivent dans un dossier choisi par la personne (Téléchargements par
; défaut), jamais dans ces dossiers : aucune désinstallation ne les touche.

; Ferme une instance qui tourne : Windows refuse de remplacer un exécutable en cours
; d'utilisation, et une désinstallation pendant que l'application tourne laisserait des
; fichiers verrouillés. L'état des transferts est persisté : une interruption ici est
; reprise au prochain démarrage, elle n'est pas silencieusement perdue.
!macro DROPFORGE_STOP_RUNNING_APP
  nsExec::ExecToLog 'taskkill /IM "DropForge.exe" /F'
  Pop $0
  nsExec::ExecToLog 'taskkill /IM "dropforge.exe" /F'
  Pop $0
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro DROPFORGE_STOP_RUNNING_APP
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; Rien à ajouter : le modèle crée l'exécutable, les raccourcis (menu Démarrer, bureau)
  ; et les clés de registre, et sa page finale propose de lancer l'application.
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro DROPFORGE_STOP_RUNNING_APP
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; Rien à ajouter : la case « Delete app data » du modèle s'occupe des données, et
  ; elle seule sait ce que la personne a demandé.
!macroend
