// Empêche l'ouverture d'une console derrière la fenêtre sous Windows en release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    dropforge_lib::run()
}
