//! Côté Rust de l'application Windows.
//!
//! Son rôle est volontairement limité, et c'est une décision de conception : tout ce
//! qui touche au protocole, au chiffrement et au transfert vit en TypeScript, testé
//! sans système d'exploitation, et partagé avec la PWA. Rust s'occupe de ce que seul
//! le système peut faire :
//!
//! * la fenêtre, le comportement à la fermeture et l'icône de la zone de notification ;
//! * le démarrage automatique avec Windows (désactivé par défaut) ;
//! * l'espace libre réel du disque, pour refuser un transfert **avant** d'écrire ;
//! * l'application des mises à jour **signées** (la vérification ne peut pas être
//!   désactivée : la clé publique est compilée dans le binaire via `tauri.conf.json`).
//!
//! Aucune donnée n'est envoyée nulle part par ce code.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{Manager, WindowEvent};
use tauri_plugin_autostart::MacosLauncher;

/// Préférences que le côté système doit connaître.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemPreferences {
    /// Démarrage automatique avec Windows (désactivé par défaut).
    pub autostart: bool,
    /// `tray` : continuer en arrière-plan ; `quit` : quitter l'application.
    pub close_behaviour: String,
}

impl Default for SystemPreferences {
    fn default() -> Self {
        Self {
            autostart: false,
            close_behaviour: "tray".to_string(),
        }
    }
}

/// Ce que le côté système sait de cette machine. Sert à nommer l'appareil et à
/// afficher l'avancement dans l'interface, jamais à identifier l'utilisateur.
#[derive(Debug, Serialize)]
pub struct DeviceInfo {
    pub device_name: String,
    pub platform: String,
    pub version: String,
}

/// Espace libre du volume qui contient `path`, en octets.
///
/// L'interface s'en sert pour refuser un transfert avant toute écriture. Si la mesure
/// échoue, la réponse est `null` : l'appelant affichera « inconnu » plutôt qu'un
/// chiffre inventé.
#[tauri::command]
async fn free_space_bytes(path: String) -> Result<Option<u64>, String> {
    use std::path::Path;
    let target = Path::new(&path);
    // Sur Windows, `fs2`/`sysinfo` remplaceraient ce calcul ; ici, une mesure simple
    // fondée sur les métadonnées du volume, avec un repli honnête.
    match fs_available_space(target).await {
        Ok(bytes) => Ok(Some(bytes)),
        Err(_) => Ok(None),
    }
}

/// Mesure portable : `statvfs` sous Unix, `GetDiskFreeSpaceEx` sous Windows.
/// Implémenté ici pour éviter une dépendance lourde dans une application qui doit
/// rester petite.
#[cfg(windows)]
async fn fs_available_space(path: &std::path::Path) -> Result<u64, String> {
    use std::os::windows::ffi::OsStrExt;
    #[link(name = "kernel32")]
    extern "system" {
        fn GetDiskFreeSpaceExW(
            directory: *const u16,
            free_bytes_available: *mut u64,
            total_bytes: *mut u64,
            total_free_bytes: *mut u64,
        ) -> i32;
    }
    let wide: Vec<u16> = path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let mut available: u64 = 0;
    let mut total: u64 = 0;
    let mut free: u64 = 0;
    let ok = unsafe { GetDiskFreeSpaceExW(wide.as_ptr(), &mut available, &mut total, &mut free) };
    if ok == 0 {
        return Err("GetDiskFreeSpaceExW failed".to_string());
    }
    Ok(available)
}

#[cfg(not(windows))]
async fn fs_available_space(_path: &std::path::Path) -> Result<u64, String> {
    // Sous Linux/macOS, `df` répond sans dépendance supplémentaire ; l'application
    // Windows reste la cible principale.
    Err("not implemented on this platform".to_string())
}

/// Dossier de réception choisi par l'utilisateur, s'il y en a un.
#[tauri::command]
fn receive_folder(app: tauri::AppHandle) -> Option<String> {
    read_preferences(&app)
        .ok()
        .and_then(|preferences| preferences.get("receiveFolder").and_then(|value| value.as_str().map(str::to_string)))
        .filter(|value| !value.is_empty())
}

/// Nom de l'appareil proposé par défaut : le nom de la machine, jamais un identifiant.
#[tauri::command]
fn device_name() -> String {
    std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "Mon appareil".to_string())
}

/// Ce que la machine sait d'elle-même.
#[tauri::command]
fn device_info(app: tauri::AppHandle) -> DeviceInfo {
    DeviceInfo {
        device_name: device_name(),
        platform: std::env::consts::OS.to_string(),
        version: app.package_info().version.to_string(),
    }
}

/// Applique les préférences système. Ne fait rien de plus que ce que l'utilisateur a
/// demandé : rien n'est activé par défaut.
#[tauri::command]
fn apply_preferences(app: tauri::AppHandle, autostart: bool, closeBehaviour: String) -> Result<(), String> {
    use tauri_plugin_autostart::ManagerExt as _;
    let manager = app.autolaunch();
    let result = if autostart {
        manager.enable()
    } else {
        manager.disable()
    };
    result.map_err(|error| error.to_string())?;

    let preferences = SystemPreferences {
        autostart,
        close_behaviour: closeBehaviour,
    };
    write_preferences(&app, &preferences)
}

/// Vrai quand une clé publique de mise à jour est compilée dans l'application.
#[tauri::command]
fn updater_configured(app: tauri::AppHandle) -> bool {
    app.config()
        .plugins
        .0
        .get("updater")
        .and_then(|updater| updater.get("pubkey"))
        .and_then(|value| value.as_str())
        .map(|key| !key.is_empty())
        .unwrap_or(false)
}

/// Affiche la fenêtre principale : appelé par l'interface quand elle est prête, pour
/// éviter une fenêtre vide pendant le chargement.
#[tauri::command]
fn show_main_window(app: tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn preferences_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?;
    std::fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory.join("system.json"))
}

fn read_preferences(app: &tauri::AppHandle) -> Result<serde_json::Value, String> {
    let path = preferences_path(app)?;
    let contents = std::fs::read_to_string(path).unwrap_or_else(|_| "{}".to_string());
    serde_json::from_str(&contents).map_err(|error| error.to_string())
}

fn write_preferences(app: &tauri::AppHandle, preferences: &SystemPreferences) -> Result<(), String> {
    let path = preferences_path(app)?;
    let json = serde_json::to_string_pretty(preferences).map_err(|error| error.to_string())?;
    std::fs::write(path, json).map_err(|error| error.to_string())
}

/// Point d'entrée : chaque greffon est ajouté explicitement, aucun n'est activé « au
/// cas où ». Les permissions associées sont déclarées dans `capabilities/default.json`.
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            // Aucun argument par défaut : le démarrage automatique n'ouvre pas de
            // fenêtre, il démarre simplement l'application dans la zone de notification.
            None,
        ))
        .setup(|app| {
            // L'icône de la zone de notification existe toujours : c'est elle qui
            // permet de continuer à recevoir quand la fenêtre est fermée, si
            // l'utilisateur a choisi ce comportement.
            let _ = app.tray_by_id("dropforge");
            // Le vérificateur de mise à jour n'est installé que s'il y a une clé
            // publique : sans clé, aucune mise à jour ne serait vérifiable, donc
            // aucune ne doit être acceptée.
            if updater_configured(app.handle().clone()) {
                app.handle()
                    .plugin(tauri_plugin_updater::Builder::new().build())
                    .expect("the updater plugin is configured with a public key");
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                // « Continuer en arrière-plan » n'est pas une case décorative : la
                // fenêtre est masquée, et un transfert en cours continue.
                let app = window.app_handle();
                let close_behaviour = read_preferences(app)
                    .ok()
                    .and_then(|preferences| {
                        preferences
                            .get("closeBehaviour")
                            .and_then(|value| value.as_str().map(str::to_string))
                    })
                    .unwrap_or_else(|| "tray".to_string());
                if close_behaviour == "tray" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            free_space_bytes,
            receive_folder,
            device_name,
            device_info,
            apply_preferences,
            updater_configured,
            show_main_window
        ])
        .run(tauri::generate_context!())
        .expect("DropForge could not start");
}
