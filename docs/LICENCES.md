# Licences des dépendances

> Document **généré** : `node scripts/list-licences.mjs`. Ne pas modifier à la main.

La licence de DropForge lui-même **n’est pas encore choisie** : c’est une décision
du propriétaire du projet, et `package.json` renvoie ici en attendant. Ce document
liste les licences des **dépendances directes réellement installées**, pour qu’une
future décision soit prise en connaissance de cause : toutes sont compatibles avec
une redistribution, y compris commerciale.

| Licence | Paquets |
| --- | --- |
| Apache-2.0 | `fake-indexeddb` 6.2.5, `typescript` 7.0.2 |
| MIT | `@noble/hashes` 2.4.0, `@types/node` 26.6.5, `@types/react` 19.3.0, `@types/react-dom` 19.3.0, `@types/ws` 8.18.2, `@vitejs/plugin-react` 6.1.2, `i18next` 26.4.4, `react` 19.3.0, `react-dom` 19.3.0, `react-i18next` 17.0.16, `tsx` 4.23.15, `vite` 8.3.4, `vite-plugin-pwa` 2.0.0, `vitest` 5.0.4, `ws` 8.22.0, `zod` 4.6.6 |

## Remarques

- Les dépendances **transitives** ne sont pas listées ici : `npm ls --all` les énumère.
  Toutes celles utilisées par l'application sont sous MIT, ISC, BSD, Apache-2.0 ou 0BSD.
- `@tauri-apps/*` est distribué sous Apache-2.0 OR MIT ; Tauri lui-même est sous
  Apache-2.0 OR MIT. Aucun composant n’impose de redevance ni de compte payant.
- Aucune bibliothèque de chiffrement « maison » : seules WebCrypto (plateforme) et
  `@noble/curves` / `@noble/hashes` (MIT, auditées publiquement) sont utilisées.
