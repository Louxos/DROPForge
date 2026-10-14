; Hooks de l'installateur et du désinstallateur NSIS de DropForge.
;
; Ce fichier est compilé par le modèle NSIS officiel de Tauri
; (`bundle.windows.nsis.installerHooks`, voir `tauri.conf.json`). Il ne remplace pas ce
; modèle : il ajoute seulement les deux gestes que Windows exige pour qu'une
; installation et une désinstallation se passent proprement.
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

; Écarte l'exécutable principal du chemin exact que le modèle officiel interroge.
;
; Défaut réel signalé deux fois : « l'application est en cours d'exécution » alors
; qu'elle ne tourne pas, installation comme désinstallation refusées. Le contrôle du
; modèle (`CheckIfAppIsRunning`, `utils.nsh`) ne cherche pas de processus : il demande au
; **Windows Restart Manager** qui utilise le fichier `$INSTDIR\DropForge.exe`
; (`RmRegisterResources` puis `RmGetList`), et il considère toute réponse « il y a des
; utilisateurs » comme « l'application tourne ». Or ce fichier peut être tenu par autre
; chose que l'application : un antivirus qui l'analyse, l'Explorateur, un processus
; laissé par une version précédente, une instance lancée par le démarrage automatique.
; Windows répond alors `ERROR_MORE_DATA` (234) et l'installateur s'arrête ou propose de
; fermer une application qui n'existe pas.
;
; Un fichier **renommé n'a plus d'utilisateurs** : le contrôle enregistre le chemin
; `$INSTDIR\DropForge.exe`, qui n'existe plus, et passe. Le modèle écrit ensuite le
; nouvel exécutable (même nom), et le fichier écarté est supprimé juste après — jamais
; silencieusement laissé en place, jamais confondu avec les fichiers de la personne.
; Si le renommage échoue (fichier réellement verrouillé), le comportement d'origine est
; conservé : le modèle affiche son message, et le journal d'installation explique
; pourquoi.
!macro DROPFORGE_RELEASE_MAIN_BINARY
  ; 1. La voie normale : fermer l'application si elle tourne.
  !insertmacro DROPFORGE_STOP_RUNNING_APP

  ; 2. Le fichier que le contrôle du modèle interroge n'est plus à son emplacement.
  ${If} ${FileExists} "$INSTDIR\DropForge.exe"
    ClearErrors
    Rename "$INSTDIR\DropForge.exe" "$INSTDIR\DropForge.exe.df-ecarte"
    ${If} ${Errors}
      DetailPrint "DropForge : $INSTDIR\DropForge.exe est verrouillé par un autre programme ; le contrôle de Windows peut se plaindre à tort."
    ${EndIf}
  ${EndIf}
  ${If} ${FileExists} "$INSTDIR\dropforge.exe"
    ClearErrors
    Rename "$INSTDIR\dropforge.exe" "$INSTDIR\dropforge.exe.df-ecarte"
    ${If} ${Errors}
      DetailPrint "DropForge : $INSTDIR\dropforge.exe est verrouillé par un autre programme ; le contrôle de Windows peut se plaindre à tort."
    ${EndIf}
  ${EndIf}

  ; 3. Un redémarrage automatique entre les deux gestes est improbable, mais un
  ;    fichier renommé pendant qu'un processus tourne est une anomalie : on referme.
  !insertmacro DROPFORGE_STOP_RUNNING_APP

  ; 4. Le fichier écarté est retiré. S'il est encore tenu, il reste sur le disque :
  ;    ce n'est pas un échec de l'installation, et ces deux noms sont les nôtres.
  Delete "$INSTDIR\DropForge.exe.df-ecarte"
  Delete "$INSTDIR\dropforge.exe.df-ecarte"
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro DROPFORGE_RELEASE_MAIN_BINARY
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; Rien à ajouter : le modèle crée l'exécutable, les raccourcis (menu Démarrer, bureau)
  ; et les clés de registre, et sa page finale propose de lancer l'application.
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro DROPFORGE_RELEASE_MAIN_BINARY
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; Rien à ajouter : la case « Delete app data » du modèle s'occupe des données, et
  ; elle seule sait ce que la personne a demandé.
!macroend
