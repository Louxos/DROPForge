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
//! # Règle de survie de la fenêtre
//!
//! Une application de bureau dont la fenêtre ne s'ouvre pas est cassée, quelles que
//! soient les performances du moteur : c'est la panne la plus grave possible. La
//! fenêtre est donc déclarée masquée (pour éviter un écran blanc) mais son affichage
//! est **garanti côté Rust**, indépendamment de l'interface :
//!
//! 1. l'interface appelle `show_main_window` dès qu'elle est utilisable ;
//! 2. un contrôle de secours affiche la fenêtre après 700 ms même si l'interface n'a
//!    rien demandé — elle affiche alors l'écran d'attente de `index.html`, jamais un
//!    rectangle vide ;
//! 3. un second contrôle insiste après 12 s et l'écrit dans le journal ;
//! 4. une seconde tentative de lancement affiche la fenêtre existante au lieu de
//!    démarrer un processus invisible (greffon « single instance »).
//!
//! Chaque échec de démarrage est écrit dans `diagnostics.log`, à côté des données de
//! l'application — jamais un contenu de fichier, jamais une clé.

use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconEvent};
use tauri::{AppHandle, Manager, WindowEvent};
use tauri_plugin_autostart::MacosLauncher;

/// Identifiant de l'application, dupliqué depuis `tauri.conf.json`.
///
/// Il sert à écrire un journal de diagnostic **avant** que Tauri ne soit prêt, donc
/// avant que `path().app_config_dir()` ne réponde. La duplication est vérifiée à
/// chaque `npm run verify` (`scripts/check-desktop-config.mjs`), pour qu'elle ne puisse
/// pas diverger silencieusement.
const APP_IDENTIFIER: &str = "org.dropforge.app";

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

/// État de la coque : ce qui, côté système, peut manquer sans que l'application doive
/// mentir à ce sujet.
#[derive(Default)]
struct ShellState {
    /// Vrai quand l'icône de la zone de notification existe réellement. Sans elle,
    /// se cacher reviendrait à disparaître : la fermeture quitte alors l'application.
    tray: AtomicBool,
}

/* ------------------------------------------------------------------ *
 * Journal de diagnostic
 * ------------------------------------------------------------------ */

/// Emplacement du journal de diagnostic : le même dossier que les données locales.
fn diagnostics_path(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|directory| directory.join("diagnostics.log"))
}

/// Emplacement de secours, calculé sans Tauri : `%APPDATA%\<identifiant>`.
///
/// C'est exactement ce que `app_config_dir()` renvoie sous Windows ; le calcul
/// indépendant sert aux échecs qui surviennent avant l'initialisation de Tauri.
fn fallback_diagnostics_path() -> Option<PathBuf> {
    std::env::var_os("APPDATA")
        .map(|directory| PathBuf::from(directory).join(APP_IDENTIFIER).join("diagnostics.log"))
}

/// Écrit une ligne horodatée dans le journal de diagnostic.
///
/// Aucune donnée sensible n'y a sa place : ni clé, ni jeton, ni contenu de fichier.
/// Le contenu est borné et les retours à la ligne sont neutralisés, pour qu'un message
/// d'erreur ne puisse pas fabriquer de fausses entrées.
fn write_diagnostic_line(path: &Path, scope: &str, message: &str) {
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs())
        .unwrap_or(0);
    let cleaned: String = message
        .replace(['\r', '\n'], " ")
        .chars()
        .take(4000)
        .collect();
    if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "[{stamp}] {scope}: {cleaned}");
    }
}

/// Journalise côté application (chemin résolu par Tauri, ou repli).
fn log_problem(app: &AppHandle, scope: &str, message: &str) {
    if let Some(path) = diagnostics_path(app).or_else(fallback_diagnostics_path) {
        write_diagnostic_line(&path, scope, message);
    }
}

/* ------------------------------------------------------------------ *
 * Fenêtre
 * ------------------------------------------------------------------ */

/// Ramène la fenêtre principale au premier plan. Renvoie `true` si elle a dû être
/// affichée (elle était masquée ou absente de l'écran).
fn reveal_main_window(app: &AppHandle) -> bool {
    let Some(window) = app.get_webview_window("main") else {
        return false;
    };
    let hidden = !window.is_visible().unwrap_or(false);
    if hidden {
        let _ = window.show();
    }
    // Le focus est redemandé même si la fenêtre était visible : c'est ce qui rend un
    // second clic sur l'icône utile plutôt qu'ignoré.
    let _ = window.set_focus();
    hidden
}

/// Contrôle de secours : affiche la fenêtre si, au bout du délai, l'interface ne l'a
/// toujours pas fait. C'est ce qui garantit qu'un échec de l'interface ne laisse
/// jamais l'application invisible.
fn spawn_window_watchdog(app: AppHandle, delay: Duration, scope: &'static str) {
    std::thread::spawn(move || {
        std::thread::sleep(delay);
        if reveal_main_window(&app) {
            log_problem(
                &app,
                scope,
                "fenêtre affichée par le contrôle de secours : l'interface n'a pas demandé son affichage",
            );
        }
    });
}

/// Affiche la fenêtre principale : appelé par l'interface quand elle est prête, pour
/// éviter une fenêtre vide pendant le chargement. L'appel est facultatif — le contrôle
/// de secours fait le travail si l'interface ne va pas jusqu'au bout.
#[tauri::command]
fn show_main_window(app: AppHandle) {
    reveal_main_window(&app);
}

/// Journalise un problème signalé par l'interface et renvoie le chemin du journal,
/// pour que la personne puisse le transmettre. Le message est nettoyé et borné ici :
/// l'interface ne peut pas écrire n'importe quoi dans le journal.
#[tauri::command]
fn report_problem(app: AppHandle, scope: String, message: String) -> Option<String> {
    let scope: String = scope.chars().take(64).collect();
    log_problem(&app, &scope, &message);
    diagnostics_path(&app)
        .or_else(fallback_diagnostics_path)
        .map(|path| path.display().to_string())
}

/// Chemin du journal de diagnostic, à montrer à la personne qui utilise l'application.
#[tauri::command]
fn diagnostics_path_command(app: AppHandle) -> Option<String> {
    diagnostics_path(&app)
        .or_else(fallback_diagnostics_path)
        .map(|path| path.display().to_string())
}

/* ------------------------------------------------------------------ *
 * Système
 * ------------------------------------------------------------------ */

/// Espace libre du volume qui contient `path`, en octets.
///
/// L'interface s'en sert pour refuser un transfert avant toute écriture. Si la mesure
/// échoue, la réponse est `null` : l'appelant affichera « inconnu » plutôt qu'un
/// chiffre inventé.
#[tauri::command]
async fn free_space_bytes(path: String) -> Result<Option<u64>, String> {
    let target = Path::new(&path);
    match fs_available_space(target).await {
        Ok(bytes) => Ok(Some(bytes)),
        Err(_) => Ok(None),
    }
}

/// Mesure portable : `statvfs` sous Unix, `GetDiskFreeSpaceEx` sous Windows.
/// Implémenté ici pour éviter une dépendance lourde dans une application qui doit
/// rester petite.
#[cfg(windows)]
async fn fs_available_space(path: &Path) -> Result<u64, String> {
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
async fn fs_available_space(path: &Path) -> Result<u64, String> {
    // Sous Linux/macOS : `df` répond sans dépendance supplémentaire. L'application
    // Windows reste la cible principale ; ce repli permet de lancer la coque en
    // développement, et il est volontairement mesuré (une commande, pas une boucle).
    let output = std::process::Command::new("df")
        .arg("-k")
        .arg(path)
        .output()
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err("df failed".to_string());
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let line = text.lines().nth(1).ok_or_else(|| "df returned no data".to_string())?;
    let available_kib: u64 = line
        .split_whitespace()
        .nth(3)
        .ok_or_else(|| "df returned an unexpected shape".to_string())?
        .parse()
        .map_err(|error: std::num::ParseIntError| error.to_string())?;
    Ok(available_kib * 1024)
}

/// Dossier de réception choisi par l'utilisateur, s'il y en a un.
#[tauri::command]
fn receive_folder(app: AppHandle) -> Option<String> {
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
fn device_info(app: AppHandle) -> DeviceInfo {
    DeviceInfo {
        device_name: device_name(),
        platform: std::env::consts::OS.to_string(),
        version: app.package_info().version.to_string(),
    }
}

/// Applique les préférences système. Ne fait rien de plus que ce que l'utilisateur a
/// demandé : rien n'est activé par défaut.
#[tauri::command]
fn apply_preferences(app: AppHandle, autostart: bool, close_behaviour: String) -> Result<(), String> {
    use tauri_plugin_autostart::ManagerExt as _;
    let manager = app.autolaunch();
    let result = if autostart {
        manager.enable()
    } else {
        manager.disable()
    };
    if let Err(error) = result {
        // Un échec d'inscription au démarrage automatique est signalé à l'interface,
        // qui l'affiche : le réglage ne peut pas sembler appliqué alors qu'il ne l'est
        // pas.
        log_problem(&app, "autostart", &error.to_string());
        return Err(error.to_string());
    }

    let preferences = SystemPreferences {
        autostart,
        close_behaviour,
    };
    write_preferences(&app, &preferences)
}

/// Vrai quand une clé publique de mise à jour est compilée dans l'application.
#[tauri::command]
fn updater_configured(app: AppHandle) -> bool {
    app.config()
        .plugins
        .0
        .get("updater")
        .and_then(|updater| updater.get("pubkey"))
        .and_then(|value| value.as_str())
        .map(|key| !key.is_empty())
        .unwrap_or(false)
}

fn preferences_path(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?;
    std::fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory.join("system.json"))
}

fn read_preferences(app: &AppHandle) -> Result<serde_json::Value, String> {
    let path = preferences_path(app)?;
    let contents = std::fs::read_to_string(path).unwrap_or_else(|_| "{}".to_string());
    serde_json::from_str(&contents).map_err(|error| error.to_string())
}

fn write_preferences(app: &AppHandle, preferences: &SystemPreferences) -> Result<(), String> {
    let path = preferences_path(app)?;
    let json = serde_json::to_string_pretty(preferences).map_err(|error| error.to_string())?;
    std::fs::write(path, json).map_err(|error| error.to_string())
}

/// Installe le menu de l'icône de la zone de notification.
///
/// Un échec n'arrête **pas** l'application : c'est exactement le genre de panne qui
/// rendrait une application de bureau invisible alors que le reste fonctionne. L'échec
/// est journalisé, et l'état retient qu'aucune icône n'existe pour que la fermeture de
/// la fenêtre quitte vraiment au lieu de se cacher dans le vide.
fn install_tray(app: &AppHandle) -> bool {
    let Some(tray) = app.tray_by_id("dropforge") else {
        log_problem(app, "tray", "aucune icône de zone de notification n'est déclarée");
        return false;
    };

    // Le menu est construit ici, pas dans `tauri.conf.json` : depuis Tauri 2.2 la
    // configuration ne porte plus de menu d'icône (vérifié contre le schéma officiel,
    // `npm run check:desktop`). Les entrées sont celles que la personne attend.
    let prepared = (|| -> Result<(), Box<dyn std::error::Error>> {
        let show = MenuItem::with_id(app, "show", "Ouvrir DropForge", true, None::<&str>)?;
        let quit = MenuItem::with_id(app, "quit", "Quitter", true, None::<&str>)?;
        let separator = PredefinedMenuItem::separator(app)?;
        let menu = Menu::with_items(app, &[&show, &separator, &quit])?;
        tray.set_menu(Some(menu))?;
        Ok(())
    })();

    if let Err(error) = prepared {
        log_problem(app, "tray", &error.to_string());
        return false;
    }

    // « Quitter » quitte vraiment : un transfert en cours est interrompu, et
    // l'application le dira au prochain démarrage (état persisté).
    tray.on_menu_event(|app, event| match event.id().as_ref() {
        "show" => {
            reveal_main_window(app);
        }
        "quit" => app.exit(0),
        _ => {}
    });

    // Clic gauche : ramener la fenêtre.
    //
    // Le dépôt de fichiers *sur l'icône* n'est pas proposé : l'énumération
    // d'événements de Tauri 2.12 (Click, DoubleClick, Enter, Move, Leave) n'expose
    // aucun événement de dépôt. Glisser-déposer dans la **fenêtre** fonctionne et
    // reste le moyen prévu (voir `docs/TECHNIQUE.md`).
    tray.on_tray_icon_event(|tray, event| {
        if let TrayIconEvent::Click {
            button: MouseButton::Left,
            button_state: MouseButtonState::Up,
            ..
        } = event
        {
            reveal_main_window(tray.app_handle());
        }
    });

    true
}

/// Point d'entrée : chaque greffon est ajouté explicitement, aucun n'est activé « au
/// cas où ». Les permissions associées sont déclarées dans `capabilities/default.json`.
pub fn run() {
    let builder = tauri::Builder::default();

    // Une seconde tentative de lancement ne doit pas créer un second processus
    // invisible : elle ramène la fenêtre existante au premier plan. C'est le geste que
    // fait naturellement quelqu'un dont la fenêtre a été fermée par erreur.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
        reveal_main_window(app);
    }));

    let result = builder
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
            app.manage(ShellState::default());

            // Toute panne signalée par le noyau Tauri part dans le journal, sous une
            // forme lisible, avant que l'application ne s'arrête.
            if let Some(path) = diagnostics_path(app.handle()).or_else(fallback_diagnostics_path) {
                std::panic::set_hook(Box::new(move |info| {
                    write_diagnostic_line(&path, "panic", &info.to_string());
                }));
            }

            let tray_available = install_tray(app.handle());
            app.state::<ShellState>()
                .tray
                .store(tray_available, Ordering::Relaxed);

            // Le vérificateur de mise à jour n'est installé que s'il y a une clé
            // publique : sans clé, aucune mise à jour ne serait vérifiable, donc
            // aucune ne doit être acceptée. Un échec d'installation est journalisé
            // plutôt que de faire tomber l'application.
            if updater_configured(app.handle().clone()) {
                if let Err(error) = app
                    .handle()
                    .plugin(tauri_plugin_updater::Builder::new().build())
                {
                    log_problem(app.handle(), "updater", &error.to_string());
                }
            }

            // Les deux contrôles de secours de la fenêtre (voir la documentation du
            // module) : le premier évite qu'un échec de l'interface ne rende
            // l'application invisible, le second insiste et laisse une trace.
            spawn_window_watchdog(app.handle().clone(), Duration::from_millis(700), "window");
            spawn_window_watchdog(app.handle().clone(), Duration::from_secs(12), "window-late");
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                // « Continuer en arrière-plan » n'est pas une case décorative : la
                // fenêtre est masquée, et un transfert en cours continue. Sans icône de
                // zone de notification, se cacher reviendrait à disparaître : la
                // fermeture est alors un vrai quit.
                let app = window.app_handle();
                let tray_available = app.state::<ShellState>().tray.load(Ordering::Relaxed);
                let close_behaviour = read_preferences(app)
                    .ok()
                    .and_then(|preferences| {
                        preferences
                            .get("closeBehaviour")
                            .and_then(|value| value.as_str().map(str::to_string))
                    })
                    .unwrap_or_else(|| "tray".to_string());
                if tray_available && close_behaviour == "tray" {
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
            show_main_window,
            report_problem,
            diagnostics_path_command
        ])
        .run(tauri::generate_context!());

    if let Err(error) = result {
        // Dernier recours : l'application n'a pas démarré, mais la raison est écrite
        // quelque part de lisible par la personne qui la lance.
        if let Some(path) = fallback_diagnostics_path() {
            write_diagnostic_line(&path, "startup", &error.to_string());
        }
        eprintln!("DropForge n'a pas pu démarrer : {error}");
    }
}
