<#
  Débloque une installation DropForge coincée sous Windows.

  À quoi ça sert : l'installateur et le désinstallateur publiés en 0.1.1 demandent au
  Windows Restart Manager qui utilise `%LOCALAPPDATA%\DropForge\DropForge.exe`. Dès
  qu'une réponse arrive, ils affichent « l'application est en cours d'exécution » et
  s'arrêtent — même quand l'application ne tourne pas. Si les fichiers ont été supprimés
  à la main, l'entrée de désinstallation reste dans le registre et Windows continue de
  proposer une désinstallation qui pointe vers un fichier absent.

  Ce script constate, explique, et — seulement si on le lui demande — nettoie :

    powershell -ExecutionPolicy Bypass -File scripts\unblock-windows.ps1
    powershell -ExecutionPolicy Bypass -File scripts\unblock-windows.ps1 -Apply

  Sans `-Apply`, rien n'est modifié : le script liste ce qu'il a trouvé et les commandes
  exactes qui seraient exécutées. Avec `-Apply`, chaque étape demande confirmation.

  Ce qu'il ne touche jamais : vos fichiers reçus (Téléchargements, Documents, Bureau),
  et le dossier de données `%APPDATA%\org.dropforge.app` sauf demande explicite
  (option `-RemoveData`). Il n'efface aucun fichier hors des dossiers du programme.
#>
[CmdletBinding()]
param(
  [switch]$Apply,
  [switch]$RemoveData,
  [switch]$Yes
)

$ErrorActionPreference = 'Continue'

function Write-Step($text) { Write-Host "`n== $text" -ForegroundColor Cyan }
function Write-Found($text) { Write-Host "   $text" }
function Write-Nothing($text) { Write-Host "   rien : $text" -ForegroundColor DarkGray }

function Confirm-Action([string]$question) {
  if (-not $Apply) { return $false }
  if ($Yes) { Write-Host "   appliqué (mode -Yes) : $question" -ForegroundColor Yellow; return $true }
  $answer = Read-Host "   $question [o/N]"
  return ($answer -eq 'o' -or $answer -eq 'O' -or $answer -eq 'y' -or $answer -eq 'Y')
}

Write-Host 'DropForge — déblocage d''une installation Windows coincée' -ForegroundColor White
if (-not $Apply) {
  Write-Host "Mode constat : rien ne sera modifié. Relancez avec -Apply pour appliquer." -ForegroundColor DarkGray
}

# 1. Processus ---------------------------------------------------------------
Write-Step 'Processus DropForge'
$processes = @(Get-Process -Name 'DropForge', 'dropforge' -ErrorAction SilentlyContinue)
if ($processes.Count -eq 0) {
  Write-Nothing 'aucun processus DropForge en cours'
} else {
  foreach ($process in $processes) {
    Write-Found ("PID {0} — {1}" -f $process.Id, $process.Path)
  }
  if (Confirm-Action 'Fermer ces processus (taskkill /F) ?') {
    foreach ($process in $processes) { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue }
    Write-Host '   fermés' -ForegroundColor Yellow
  }
}

# 2. Entrées de désinstallation ---------------------------------------------
Write-Step 'Entrées de désinstallation (c''est ce que l''installateur consulte avant de réinstaller)'
$uninstallRoots = @(
  'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
  'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
  'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall'
)
$keys = @()
foreach ($root in $uninstallRoots) {
  if (-not (Test-Path $root)) { continue }
  foreach ($key in (Get-ChildItem $root -ErrorAction SilentlyContinue)) {
    $display = (Get-ItemProperty $key.PSPath -ErrorAction SilentlyContinue).DisplayName
    if ($key.PSChildName -like '*DropForge*' -or $display -like '*DropForge*') { $keys += $key }
  }
}
if ($keys.Count -eq 0) {
  Write-Nothing 'aucune entrée DropForge dans le registre de désinstallation'
} else {
  foreach ($key in $keys) {
    $properties = Get-ItemProperty $key.PSPath -ErrorAction SilentlyContinue
    Write-Found ("{0}" -f $key.Name)
    Write-Found ("   DisplayName   : {0}" -f $properties.DisplayName)
    Write-Found ("   UninstallString : {0}" -f $properties.UninstallString)
    if ($properties.UninstallString -and -not (Test-Path (($properties.UninstallString -split '"')[1]))) {
      Write-Found '   -> le désinstallateur visé n''existe plus : c''est cette entrée qui bloque la réinstallation'
    }
  }
  if (Confirm-Action 'Supprimer ces entrées de désinstallation ?') {
    foreach ($key in $keys) { Remove-Item -Path $key.PSPath -Recurse -Force -ErrorAction SilentlyContinue }
    Write-Host '   supprimées' -ForegroundColor Yellow
  }
}

# 3. Démarrage automatique ---------------------------------------------------
Write-Step 'Démarrage automatique'
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$runEntry = $null
if (Test-Path $runKey) {
  $runEntry = (Get-ItemProperty $runKey -ErrorAction SilentlyContinue).PSObject.Properties |
    Where-Object { $_.Name -like '*DropForge*' -or ($_.Value -is [string] -and $_.Value -like '*DropForge*') }
}
if (-not $runEntry) {
  Write-Nothing 'aucune entrée de démarrage automatique'
} else {
  foreach ($entry in $runEntry) { Write-Found ("{0} = {1}" -f $entry.Name, $entry.Value) }
  if (Confirm-Action 'Retirer cette entrée ?') {
    foreach ($entry in $runEntry) { Remove-ItemProperty -Path $runKey -Name $entry.Name -ErrorAction SilentlyContinue }
    Write-Host '   retirée' -ForegroundColor Yellow
  }
}

# 4. Dossiers du programme ---------------------------------------------------
Write-Step 'Dossiers du programme'
$programFolders = @(
  (Join-Path $env:LOCALAPPDATA 'DropForge'),
  (Join-Path ${env:ProgramFiles} 'DropForge'),
  (Join-Path ${env:ProgramFiles(x86)} 'DropForge')
) | Where-Object { $_ -and (Test-Path $_) }
if (-not $programFolders) {
  Write-Nothing 'aucun dossier de programme restant'
} else {
  foreach ($folder in $programFolders) { Write-Found $folder }
  if (Confirm-Action 'Supprimer ces dossiers de programme ?') {
    foreach ($folder in $programFolders) { Remove-Item -LiteralPath $folder -Recurse -Force -ErrorAction SilentlyContinue }
    Write-Host '   supprimés (les fichiers encore verrouillés sont conservés)' -ForegroundColor Yellow
  }
}

# 5. Raccourcis --------------------------------------------------------------
Write-Step 'Raccourcis'
$shortcuts = @(
  (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\DropForge.lnk'),
  (Join-Path $env:USERPROFILE 'Desktop\DropForge.lnk'),
  (Join-Path $env:PUBLIC 'Desktop\DropForge.lnk')
) | Where-Object { Test-Path $_ }
if (-not $shortcuts) {
  Write-Nothing 'aucun raccourci restant'
} else {
  foreach ($shortcut in $shortcuts) { Write-Found $shortcut }
  if (Confirm-Action 'Supprimer ces raccourcis ?') {
    foreach ($shortcut in $shortcuts) { Remove-Item -LiteralPath $shortcut -Force -ErrorAction SilentlyContinue }
    Write-Host '   supprimés' -ForegroundColor Yellow
  }
}

# 6. Données locales (jamais par défaut) ------------------------------------
Write-Step 'Données locales (historique, appareils de confiance, réglages)'
$dataFolders = @(
  (Join-Path $env:APPDATA 'org.dropforge.app'),
  (Join-Path $env:LOCALAPPDATA 'org.dropforge.app')
) | Where-Object { Test-Path $_ }
if (-not $dataFolders) {
  Write-Nothing 'aucune donnée locale'
} else {
  foreach ($folder in $dataFolders) { Write-Found $folder }
  if ($RemoveData) {
    if (Confirm-Action 'Supprimer ces données ? (historique et appareils de confiance seront perdus)') {
      foreach ($folder in $dataFolders) { Remove-Item -LiteralPath $folder -Recurse -Force -ErrorAction SilentlyContinue }
      Write-Host '   supprimées' -ForegroundColor Yellow
    }
  } else {
    Write-Host "   conservées : utilisez -RemoveData si vous voulez aussi les supprimer" -ForegroundColor DarkGray
  }
}

Write-Host "`nCe que ce script ne touche jamais : vos fichiers reçus (Téléchargements, Documents, Bureau)." -ForegroundColor DarkGray
if (-not $Apply) {
  Write-Host "Relancez avec -Apply pour appliquer, étape par étape." -ForegroundColor White
} else {
  Write-Host "Terminé. Relancez l'installateur : la page de réinstallation ne devrait plus voir d'installation précédente." -ForegroundColor White
}
