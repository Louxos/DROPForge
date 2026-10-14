# Télécharger et installer DropForge

Trois façons d'obtenir DropForge. Choisissez selon ce que vous voulez faire — aucune
ne demande de compte ni de paiement.

## 1. Windows — l'installateur (recommandé)

L'installateur est **construit automatiquement** par GitHub Actions, sur une machine
Windows, à chaque version publiée — à partir du code de ce dépôt, sans étape manuelle.
Il n'est **pas** signé par un certificat commercial (voir le point 4) : les sommes de
contrôle sont ce qui permet de vérifier le fichier.

1. Ouvrez la page **[Releases](../../releases)** du dépôt.
2. Téléchargez `DropForge_<version>_x64-setup.exe` (installateur NSIS) ou
   `DropForge_<version>_x64_en-US.msi` (paquet MSI).
3. Vérifiez le fichier :

   ```powershell
   Get-FileHash -Algorithm SHA256 .\DropForge_0.1.1_x64-setup.exe
   ```

   Comparez avec la ligne correspondante de `SHA256SUMS-windows.txt`, joint à la
   version. Une différence signifie que le fichier a été modifié : ne l'installez pas.
4. Lancez l'installateur. Il s'installe **pour l'utilisateur courant** : aucune
   autorisation administrateur n'est demandée, aucun service ni tâche planifiée n'est
   créé. La langue de l'installation peut être choisie (français ou anglais).
   - Si le moteur d'affichage Microsoft (WebView2) manque, la version fournie le
     contient : le premier lancement fonctionne sans réseau ;
   - Windows peut afficher un avertissement d'éditeur inconnu : l'installateur n'est
     pas signé par un certificat commercial. C'est un avertissement de réputation, pas
     une erreur ; les sommes de contrôle ci-dessus permettent de vérifier le fichier, et
     `docs/OWNER-GUIDE.md` explique ce que la signature changerait.
5. Lancez DropForge. **La fenêtre s'ouvre toujours** : si l'interface rencontrait un
   problème, elle affiche l'étape concernée, la cause, le chemin du journal de
   diagnostic et un bouton « Réessayer » au lieu de rester invisible
   (`docs/TROUBLESHOOTING.md`).

### Mises à jour

Si la clé de signature est configurée dans le dépôt, l'application propose les
mises à jour et **ne les installe jamais sans votre accord**. La mise à jour est
vérifiée par signature avant installation ; une signature invalide est refusée. Si
aucune clé n'est configurée, l'application le dit et propose simplement de
retélécharger l'installateur.

## 2. Téléphone, tablette, autre ordinateur — l'application web

### a) Depuis la page hébergée (le plus simple)

Si le dépôt publie sa page GitHub Pages
(`https://<utilisateur>.github.io/DROPForge/`), ouvrez-la.

> **Activation, une seule fois** : dépôt → *Settings* → *Pages* → *Source* =
> « GitHub Actions », puis relancez le travail « Application web (GitHub Pages) ».
> Tant qu'elle n'a pas eu lieu, la chaîne d'intégration construit l'application,
> **le dit dans un avis** et ne publie rien — sans échouer pour autant, et l'archive
> ci-dessous reste le moyen d'obtenir l'application web. Le pas-à-pas est dans
> [`OWNER-GUIDE.md`](OWNER-GUIDE.md) §1.

- **Android / Chrome / Edge** : menu ⋮ → « Installer l'application » ;
- **iPhone / iPad** : bouton Partager → « Sur l'écran d'accueil » ;
- **Bureau** : icône d'installation dans la barre d'adresse.

L'application apparaît alors dans les applications de l'appareil et fonctionne hors
ligne, sans compte.

### b) Depuis l'archive téléchargeable

Toute version publiée fournit `dropforge-pwa-<version>.zip` : l'application complète,
servable depuis **n'importe quel dossier** (les chemins sont relatifs).

```bash
unzip dropforge-pwa-0.1.1.zip -d dropforge
cd dropforge && python3 -m http.server 8000
# ouvrez http://localhost:8000 — puis installez l'application depuis le navigateur
```

> Une exception : les navigateurs n'installent une application web et n'activent le
> service worker qu'en **HTTPS** (ou sur `localhost`). Servie en HTTP sur une adresse
> IP, elle fonctionne mais ne s'installe pas.

## 3. Transférer à distance — le serveur optionnel

Sur un même réseau, DropForge n'a besoin d'aucun serveur. Pour relier deux appareils
situés sur des réseaux différents, il faut un service de signalisation : il ne voit
que des messages de négociation et des octets déjà chiffrés.

```bash
# version publiée (Node 22 suffit, pas de compilation)
unzip dropforge-signaling-0.1.1.zip -d signaling
cd signaling && npm install --omit=dev && npm start
# écoute sur 0.0.0.0:8787, santé sur /health
```

Ou en conteneurs, application web comprise :

```bash
cd deploy && docker compose up -d --build   # → http://localhost:8080
```

## Vérifier ce que vous téléchargez

| Fichier | Ce que c'est | Comment vérifier |
| --- | --- | --- |
| `DropForge_<v>_x64-setup.exe` | installateur NSIS, par utilisateur | `SHA256SUMS-windows.txt` |
| `DropForge_<v>_x64_en-US.msi` | paquet MSI, par utilisateur | `SHA256SUMS-windows.txt` |
| `*.nsis.zip` + `.sig` | archive de mise à jour signée | la signature est vérifiée par l'application elle-même |
| `latest.json` | manifeste de mise à jour | contient l'empreinte et l'URL de l'archive |
| `dropforge-pwa-<v>.zip` | application web complète | `SHA256SUMS` |
| `dropforge-signaling-<v>.zip` | serveur optionnel compilé | `SHA256SUMS` |

Tous les fichiers sont attachés à la même version : une somme de contrôle devient donc
vérifiable par rapport à la page que vous consultez, pas à un fichier isolé.

## Construire soi-même

Pour ne dépendre d'aucun binaire publié :

```bash
npm install
npm run verify     # types + 369 tests
npm run build      # application web, serveur et interface Windows → dist/
npm run package    # → release/dropforge-pwa-<v>.zip + SHA256SUMS

# Windows uniquement, avec la chaîne d'outils Rust :
npm run build:windows   # → apps/desktop/src-tauri/target/release/bundle/
```

`npm run smoke:release` va plus loin qu'un test unitaire : il extrait les archives
publiées, sert l'application web depuis un sous-dossier et démarre le serveur comme
un utilisateur le ferait, puis vérifie que tout répond. C'est ce que la chaîne
d'intégration exécute avant de publier quoi que ce soit : une archive cassée ne peut
pas être mise en ligne.

C'est exactement ce que fait la chaîne d'intégration : `.github/workflows/ci.yml`
vérifie chaque changement, `pages.yml` publie l'application web, `release.yml` produit
les installateurs sur un tag (`git tag v0.1.1 && git push origin v0.1.1`).

## Ce qui n'existe pas encore — et pourquoi

- **Aucun binaire Windows n'est fourni dans le dépôt** : les installateurs sont
  produits par la chaîne d'intégration, jamais commités. Un binaire dans un dépôt
  Git ne serait ni vérifiable ni reproductible.
- **Pas de paquet macOS ni Linux** : l'application bureau est une coque Tauri Windows
  pour l'instant ; le code partagé (interface, moteur) est identique partout, mais
  aucune coque n'a été écrite ni testée pour ces systèmes.
- **L'installateur n'est pas signé « éditeur »** : la signature de code Windows coûte
  de l'argent (150 à 400 €/an), ce qui est contraire à la règle du projet. Windows
  affichera donc un avertissement au premier lancement. Voir
  `docs/FREE-DEPLOYMENT.md` § signature.
