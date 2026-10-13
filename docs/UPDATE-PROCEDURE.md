# Mises à jour

DropForge se met à jour de deux façons, selon l'installation. Dans les deux cas :
**rien ne s'installe sans une action de la personne qui utilise l'application.**

| Installation | Mécanisme | Ce qui est vérifié |
| --- | --- | --- |
| Application Windows (Tauri) | Plugin Tauri Updater, mise à jour signée | Signature de la mise à jour contre la clé publique compilée dans l'application |
| Application web installée (PWA) | Service worker généré au build | L'intégrité vient du mode `prompt` : la nouvelle version attend, l'utilisateur décide |

## Application Windows

### Ce qui existe déjà dans le dépôt

- `apps/desktop/src/platform/tauri-updater.ts` — vérification, téléchargement,
  installation **seulement** si l'appelant le demande explicitement, puis
  redémarrage.
- `apps/desktop/src-tauri/src/lib.rs` — le plugin de mise à jour n'est **enregistré
  que si** une clé publique non vide est présente dans la configuration.
- `tauri.conf.json` → `plugins.updater` : `pubkey` vide, `endpoints` vide,
  `createUpdaterArtifacts: true`.

Tant que la clé est vide, la fonction `updater_configured()` renvoie `false`,
l'interface affiche « aucune mise à jour n'est configurée » et **rien n'est tenté**.
C'est ce qui est livré aujourd'hui.

### Mettre en place les mises à jour signées (à faire pour publier)

1. **Créer une paire de clés** :

   ```bash
   npm run tauri signer generate -w ~/.dropforge/updater.key
   ```

   Garder la clé privée **hors du dépôt**, avec les droits les plus stricts
   (`chmod 600`). La clé publique peut être publiée.

2. **Compiler la clé publique dans l'application** : renseigner `pubkey` dans
   `apps/desktop/src-tauri/tauri.conf.json` avec le contenu de la clé publique.
   À partir de cet instant, une mise à jour dont la signature ne correspond pas est
   **rejetée** : c'est le comportement voulu, ne jamais désactiver cette vérification
   pour « faire passer » une version.

3. **Publier un fichier de manifeste** (JSON) accessible en HTTPS, par exemple sur
   GitHub Releases, et renseigner son URL dans `endpoints`. DropForge interroge cette
   URL au démarrage (et à la demande), jamais un domaine découvert dynamiquement.

4. **Produire la mise à jour** :

   ```bash
   npm run tauri build -w @dropforge/desktop
   ```

   Avec `createUpdaterArtifacts: true`, la compilation produit l'installateur **et**
   l'artefact de mise à jour signée. Le manifeste doit être mis à jour avec les
   empreintes et les signatures réellement produites, jamais recopiées à la main d'une
   version précédente.

5. **Vérifier, sur une machine différente** : une version ancienne propose la
   nouvelle ; l'installation ne démarre qu'après accord ; une signature volontairement
   fausse est refusée ; une version identique ou plus ancienne n'est pas proposée.

### Ce qui n'est pas fourni

- Aucune clé, aucun certificat, aucun hébergement. Ces éléments sont propres à chaque
  publication et ne doivent pas figurer dans un dépôt public.
- Le coût d'un certificat de signature de code Windows est documenté dans
  `docs/FREE-DEPLOYMENT.md` : cette signature concerne l'installation, les mises à
  jour signées ci-dessus sont indépendantes et gratuites.

## Application web (PWA)

- `vite-plugin-pwa` en mode `prompt` : la nouvelle version est téléchargée, l'ancienne
  reste active, et l'interface propose « Redémarrer pour mettre à jour ».
- Aucun rechargement automatique au milieu d'un transfert.
- Comme il n'y a pas de vérification cryptographique côté navigateur, l'intégrité
  repose sur HTTPS et sur l'origine qui sert l'application : ne pas héberger
  l'application depuis une origine non maîtrisée.

## Versions et compatibilité

- La version de l'application est lue depuis `package.json` ; elle apparaît dans
  « À propos ».
- Les données locales ont un numéro de schéma. Une version plus ancienne de
  l'application **refuse de démarrer** sur une base écrite par une version plus
  récente (plutôt que de la corrompre) ; le message indique la marche à suivre.
- Les migrations sont additives et testées (`indexed-db-store.test.ts`, et côté
  Windows la même logique dans `tauri-store.ts`).

## Politique de version

- `1.0.0` = première version publiée, stable sur le périmètre de
  `docs/PLATFORM-MATRIX.md`.
- Les versions `0.x` restent possibles tant que la compilation Rust et un
  installateur signé n'ont pas été validés sur Windows.

## Installation et désinstallation

Ce que DropForge écrit sur une machine Windows, et où :

| Élément | Emplacement | Supprimé à la désinstallation |
| --- | --- | --- |
| Application et ressources | dossier d'installation choisi par l'installateur | ✅ |
| Base locale (historique, appareils, réglages) | `%APPDATA%\<identifiant de l'application>` | ✅ (l'installateur supprime les données de l'application, pas les fichiers reçus) |
| Fichiers reçus | dossier de réception choisi par la personne, ou Téléchargements | ❌ **jamais** : ce sont vos fichiers |
| Démarrage automatique | clé `Run` de l'utilisateur, posée **uniquement** si le réglage est activé | ✅ (et désactivée aussitôt que l'interrupteur est éteint) |
| Identité et appareils de confiance | dans la base locale | ✅ |

Points vérifiés par conception, à confirmer à l'installation (voir `docs/TESTING.md`) :

- **Installation par utilisateur** : aucun droit administrateur demandé pour
  l'installation courante.
- **Aucun service ni tâche planifiée** n'est créé : DropForge ne démarre que parce
  que l'utilisateur l'a lancé, ou parce qu'il a activé le démarrage automatique.
- **Aucun pilote, aucune extension de l'explorateur** : le désinstallateur n'a rien
  d'autre à retirer que les fichiers listés ci-dessus.
- **Les fichiers reçus sont hors de portée du désinstallateur** : supprimer
  l'application ne peut pas supprimer vos données.
