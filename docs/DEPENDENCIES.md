# Inventaire des dépendances

> Document **généré** : `node scripts/list-dependencies.mjs`. Ne pas modifier à la main.

Ce document décrit **ce qui sera réellement installé** par `npm ci`, lu depuis
`package-lock.json` : dépendances directes, dépendances transitives, versions et
licences. Les licences des dépendances directes sont détaillées séparément dans
[`LICENCES.md`](LICENCES.md) ; ici, la question posée est différente : que contient
l'installation, et y a-t-il quelque chose de problématique dedans ?

## Résumé

| Mesure | Valeur |
| --- | --- |
| Dépendances directes | 30 |
| Dépendances transitives | 498 |
| Total installé | 528 |
| Licences distinctes | 11 |
| Licences copyleft fortes détectées | aucune |

Les paquets internes (`@dropforge/*`) ne figurent pas ici : ce sont des sources
TypeScript du dépôt, reliées par des alias, jamais publiées ni installées.

## Licences, par nombre de paquets

| Licence | Paquets |
| --- | --- |
| (MIT OR CC0-1.0) | 1 |
| Apache-2.0 | 32 |
| Apache-2.0 OR MIT | 13 |
| BlueOak-1.0.0 | 8 |
| BSD-2-Clause | 5 |
| BSD-3-Clause | 5 |
| CC-BY-4.0 | 1 |
| ISC | 21 |
| MIT | 424 |
| MIT OR Apache-2.0 | 6 |
| MPL-2.0 | 12 |

## Licences qui demandent quelque chose

### copyleft au niveau du fichier — 12 paquet(s)

Réutiliser le paquet tel quel n'impose rien. Modifier ses fichiers **et** redistribuer le résultat oblige à publier ces fichiers modifiés sous la même licence. Aucun paquet MPL n'est modifié par DropForge.

Paquets : `lightningcss`, `lightningcss-android-arm64`, `lightningcss-darwin-arm64`, `lightningcss-darwin-x64`, `lightningcss-freebsd-x64`, `lightningcss-linux-arm-gnueabihf`, `lightningcss-linux-arm64-gnu`, `lightningcss-linux-arm64-musl`, `lightningcss-linux-x64-gnu`, `lightningcss-linux-x64-musl`, `lightningcss-win32-arm64-msvc`, `lightningcss-win32-x64-msvc`

### attribution — 1 paquet(s)

Utilisation libre, y compris commerciale, à condition de citer la source. Concerne ici des données (compatibilité des navigateurs), pas du code exécuté.

Paquets : `caniuse-lite`

### domaine public — 1 paquet(s)

Aucune obligation : la licence la plus permissive possible.

Paquets : `type-fest`

## Dépendances directes

| Paquet | Version | Licence | Déclaré par |
| --- | --- | --- | --- |
| `@noble/hashes` | 2.4.0 | MIT | packages/protocol/package.json (dependencies, ^2.4.0) |
| `@playwright/test` | 1.64.0 | Apache-2.0 | package.json (devDependencies, ^1.64.0) |
| `@tauri-apps/api` | 2.12.3 | Apache-2.0 OR MIT | apps/desktop/package.json (dependencies, ^2.12.3) |
| `@tauri-apps/cli` | 2.12.2 | Apache-2.0 OR MIT | apps/desktop/package.json (devDependencies, ^2.12.2) |
| `@tauri-apps/plugin-dialog` | 2.8.2 | MIT OR Apache-2.0 | apps/desktop/package.json (dependencies, ^2.8.2) |
| `@tauri-apps/plugin-fs` | 2.7.0 | MIT OR Apache-2.0 | apps/desktop/package.json (dependencies, ^2.7.0) |
| `@tauri-apps/plugin-notification` | 2.6.0 | MIT OR Apache-2.0 | apps/desktop/package.json (dependencies, ^2.6.0) |
| `@tauri-apps/plugin-process` | 2.4.0 | MIT OR Apache-2.0 | apps/desktop/package.json (dependencies, ^2.4.0) |
| `@tauri-apps/plugin-sql` | 2.5.0 | MIT OR Apache-2.0 | apps/desktop/package.json (dependencies, ^2.5.0) |
| `@tauri-apps/plugin-updater` | 2.13.3 | MIT OR Apache-2.0 | apps/desktop/package.json (dependencies, ^2.13.3) |
| `@types/node` | 26.6.5 | MIT | package.json (devDependencies, ^26.6.5) ; apps/signaling/package.json (devDependencies, ^26.6.5) |
| `@types/qrcode` | 1.5.6 | MIT | apps/web/package.json (devDependencies, ^1.5.6) |
| `@types/react` | 19.3.0 | MIT | apps/web/package.json (devDependencies, ^19.3.0) ; apps/desktop/package.json (devDependencies, ^19.3.0) ; packages/design-system/package.json (devDependencies, ^19.3.0) |
| `@types/react-dom` | 19.3.0 | MIT | apps/web/package.json (devDependencies, ^19.3.0) ; apps/desktop/package.json (devDependencies, ^19.3.0) |
| `@types/ws` | 8.18.2 | MIT | apps/signaling/package.json (devDependencies, ^8.18.2) |
| `@vitejs/plugin-react` | 6.1.2 | MIT | apps/web/package.json (devDependencies, ^6.1.2) ; apps/desktop/package.json (devDependencies, ^6.1.2) |
| `fake-indexeddb` | 6.2.5 | Apache-2.0 | package.json (devDependencies, ^6.2.5) |
| `happy-dom` | 21.0.1 | MIT | package.json (devDependencies, ^21.0.1) |
| `i18next` | 26.4.4 | MIT | apps/web/package.json (dependencies, ^26.4.4) |
| `qrcode` | 1.5.4 | MIT | apps/web/package.json (dependencies, ^1.5.4) |
| `react` | 19.3.0 | MIT | apps/web/package.json (dependencies, ^19.3.0) ; apps/desktop/package.json (dependencies, ^19.3.0) ; packages/design-system/package.json (devDependencies, ^19.3.0) |
| `react-dom` | 19.3.0 | MIT | apps/web/package.json (dependencies, ^19.3.0) ; apps/desktop/package.json (dependencies, ^19.3.0) |
| `react-i18next` | 17.0.16 | MIT | apps/web/package.json (dependencies, ^17.0.16) |
| `tsx` | 4.23.15 | MIT | package.json (devDependencies, ^4.23.15) ; apps/signaling/package.json (devDependencies, ^4.23.15) |
| `typescript` | 7.0.2 | Apache-2.0 | package.json (devDependencies, ^7.0.2) |
| `vite` | 8.3.4 | MIT | apps/web/package.json (devDependencies, ^8.3.4) ; apps/desktop/package.json (devDependencies, ^8.3.4) ; apps/signaling/package.json (devDependencies, ^8.3.4) |
| `vite-plugin-pwa` | 2.0.0 | MIT | apps/web/package.json (devDependencies, ^2.0.0) |
| `vitest` | 5.0.4 | MIT | package.json (devDependencies, ^5.0.4) |
| `ws` | 8.22.0 | MIT | apps/signaling/package.json (dependencies, ^8.22.0) |
| `zod` | 4.6.6 | MIT | packages/protocol/package.json (dependencies, ^4.6.6) |

## Dépendances transitives

Ces paquets ne sont pas choisis directement : ils viennent des précédents. Ils sont
listés parce qu'ils font partie de l'installation et que leur licence compte autant.

| Paquet | Version | Licence | Déclaré par |
| --- | --- | --- | --- |
| `@apideck/better-ajv-errors` | 0.3.7 | MIT | — |
| `@babel/code-frame` | 7.29.7 | MIT | — |
| `@babel/compat-data` | 7.29.7 | MIT | — |
| `@babel/core` | 7.29.7 | MIT | — |
| `@babel/generator` | 7.29.8 | MIT | — |
| `@babel/helper-annotate-as-pure` | 7.29.7 | MIT | — |
| `@babel/helper-compilation-targets` | 7.29.7 | MIT | — |
| `@babel/helper-create-class-features-plugin` | 7.29.7 | MIT | — |
| `@babel/helper-create-regexp-features-plugin` | 7.29.10 | MIT | — |
| `@babel/helper-define-polyfill-provider` | 0.6.8 | MIT | — |
| `@babel/helper-globals` | 7.29.7 | MIT | — |
| `@babel/helper-member-expression-to-functions` | 7.29.7 | MIT | — |
| `@babel/helper-module-imports` | 7.29.7 | MIT | — |
| `@babel/helper-module-transforms` | 7.29.7 | MIT | — |
| `@babel/helper-optimise-call-expression` | 7.29.7 | MIT | — |
| `@babel/helper-plugin-utils` | 7.29.7 | MIT | — |
| `@babel/helper-remap-async-to-generator` | 7.29.7 | MIT | — |
| `@babel/helper-replace-supers` | 7.29.7 | MIT | — |
| `@babel/helper-skip-transparent-expression-wrappers` | 7.29.7 | MIT | — |
| `@babel/helper-string-parser` | 7.29.7 | MIT | — |
| `@babel/helper-validator-identifier` | 7.29.7 | MIT | — |
| `@babel/helper-validator-option` | 7.29.7 | MIT | — |
| `@babel/helper-wrap-function` | 7.29.7 | MIT | — |
| `@babel/helpers` | 7.29.10 | MIT | — |
| `@babel/parser` | 7.29.9 | MIT | — |
| `@babel/plugin-bugfix-firefox-class-in-computed-class-key` | 7.29.7 | MIT | — |
| `@babel/plugin-bugfix-safari-class-field-initializer-scope` | 7.29.7 | MIT | — |
| `@babel/plugin-bugfix-safari-id-destructuring-collision-in-function-expression` | 7.29.7 | MIT | — |
| `@babel/plugin-bugfix-safari-rest-destructuring-rhs-array` | 7.29.7 | MIT | — |
| `@babel/plugin-bugfix-v8-spread-parameters-in-optional-chaining` | 7.29.7 | MIT | — |
| `@babel/plugin-bugfix-v8-static-class-fields-redefine-readonly` | 7.29.7 | MIT | — |
| `@babel/plugin-proposal-private-property-in-object` | 7.21.0-placeholder-for-preset-env.2 | MIT | — |
| `@babel/plugin-syntax-import-assertions` | 7.29.7 | MIT | — |
| `@babel/plugin-syntax-import-attributes` | 7.29.7 | MIT | — |
| `@babel/plugin-syntax-unicode-sets-regex` | 7.18.6 | MIT | — |
| `@babel/plugin-transform-arrow-functions` | 7.29.7 | MIT | — |
| `@babel/plugin-transform-async-generator-functions` | 7.29.7 | MIT | — |
| `@babel/plugin-transform-async-to-generator` | 7.29.7 | MIT | — |
| `@babel/plugin-transform-block-scoped-functions` | 7.29.7 | MIT | — |
| `@babel/plugin-transform-block-scoping` | 7.29.7 | MIT | — |
| `@babel/plugin-transform-class-properties` | 7.29.7 | MIT | — |
| `@babel/plugin-transform-class-static-block` | 7.29.7 | MIT | — |
| `@babel/plugin-transform-classes` | 7.29.7 | MIT | — |
| `@babel/plugin-transform-computed-properties` | 7.29.7 | MIT | — |
| `@babel/plugin-transform-destructuring` | 7.29.7 | MIT | — |
| `@babel/plugin-transform-dotall-regex` | 7.29.7 | MIT | — |
| `@babel/plugin-transform-duplicate-keys` | 7.29.7 | MIT | — |
| `@babel/plugin-transform-duplicate-named-capturing-groups-regex` | 7.29.7 | MIT | — |
| `@babel/plugin-transform-dynamic-import` | 7.29.7 | MIT | — |
| `@babel/plugin-transform-explicit-resource-management` | 7.29.7 | MIT | — |
| `@babel/plugin-transform-exponentiation-operator` | 7.29.7 | MIT | — |
| `@babel/plugin-transform-export-namespace-from` | 7.29.7 | MIT | — |
| `@babel/plugin-transform-for-of` | 7.29.7 | MIT | — |
| `@babel/plugin-transform-function-name` | 7.29.7 | MIT | — |
| `@babel/plugin-transform-json-strings` | 7.29.7 | MIT | — |
| `@babel/plugin-transform-literals` | 7.29.7 | MIT | — |
| `@babel/plugin-transform-logical-assignment-operators` | 7.29.7 | MIT | — |
| `@babel/plugin-transform-member-expression-literals` | 7.29.7 | MIT | — |
| `@babel/plugin-transform-modules-amd` | 7.29.7 | MIT | — |
| `@babel/plugin-transform-modules-commonjs` | 7.29.7 | MIT | — |
| `@babel/plugin-transform-modules-systemjs` | 7.29.8 | MIT | — |
| `@babel/plugin-transform-modules-umd` | 7.29.7 | MIT | — |
| `@babel/plugin-transform-named-capturing-groups-regex` | 7.29.7 | MIT | — |
| `@babel/plugin-transform-new-target` | 7.29.7 | MIT | — |
| `@babel/plugin-transform-nullish-coalescing-operator` | 7.29.7 | MIT | — |
| `@babel/plugin-transform-numeric-separator` | 7.29.7 | MIT | — |
| `@babel/plugin-transform-object-rest-spread` | 7.29.7 | MIT | — |
| `@babel/plugin-transform-object-super` | 7.29.7 | MIT | — |
| `@babel/plugin-transform-optional-catch-binding` | 7.29.7 | MIT | — |
| `@babel/plugin-transform-optional-chaining` | 7.29.7 | MIT | — |
| `@babel/plugin-transform-parameters` | 7.29.7 | MIT | — |
| `@babel/plugin-transform-private-methods` | 7.29.7 | MIT | — |
| `@babel/plugin-transform-private-property-in-object` | 7.29.7 | MIT | — |
| `@babel/plugin-transform-property-literals` | 7.29.7 | MIT | — |
| `@babel/plugin-transform-regenerator` | 7.29.8 | MIT | — |
| `@babel/plugin-transform-regexp-modifiers` | 7.29.7 | MIT | — |
| `@babel/plugin-transform-reserved-words` | 7.29.7 | MIT | — |
| `@babel/plugin-transform-shorthand-properties` | 7.29.7 | MIT | — |
| `@babel/plugin-transform-spread` | 7.29.8 | MIT | — |
| `@babel/plugin-transform-sticky-regex` | 7.29.7 | MIT | — |
| `@babel/plugin-transform-template-literals` | 7.29.7 | MIT | — |
| `@babel/plugin-transform-typeof-symbol` | 7.29.7 | MIT | — |
| `@babel/plugin-transform-unicode-escapes` | 7.29.7 | MIT | — |
| `@babel/plugin-transform-unicode-property-regex` | 7.29.7 | MIT | — |
| `@babel/plugin-transform-unicode-regex` | 7.29.7 | MIT | — |
| `@babel/plugin-transform-unicode-sets-regex` | 7.29.7 | MIT | — |
| `@babel/preset-env` | 7.29.7 | MIT | — |
| `@babel/preset-modules` | 0.1.6-no-external-plugins | MIT | — |
| `@babel/runtime` | 7.29.10 | MIT | — |
| `@babel/template` | 7.29.7 | MIT | — |
| `@babel/traverse` | 7.29.10 | MIT | — |
| `@babel/types` | 7.29.8 | MIT | — |
| `@esbuild/aix-ppc64` | 0.28.2 | MIT | — |
| `@esbuild/android-arm` | 0.28.2 | MIT | — |
| `@esbuild/android-arm64` | 0.28.2 | MIT | — |
| `@esbuild/android-x64` | 0.28.2 | MIT | — |
| `@esbuild/darwin-arm64` | 0.28.2 | MIT | — |
| `@esbuild/darwin-x64` | 0.28.2 | MIT | — |
| `@esbuild/freebsd-arm64` | 0.28.2 | MIT | — |
| `@esbuild/freebsd-x64` | 0.28.2 | MIT | — |
| `@esbuild/linux-arm` | 0.28.2 | MIT | — |
| `@esbuild/linux-arm64` | 0.28.2 | MIT | — |
| `@esbuild/linux-ia32` | 0.28.2 | MIT | — |
| `@esbuild/linux-loong64` | 0.28.2 | MIT | — |
| `@esbuild/linux-mips64el` | 0.28.2 | MIT | — |
| `@esbuild/linux-ppc64` | 0.28.2 | MIT | — |
| `@esbuild/linux-riscv64` | 0.28.2 | MIT | — |
| `@esbuild/linux-s390x` | 0.28.2 | MIT | — |
| `@esbuild/linux-x64` | 0.28.2 | MIT | — |
| `@esbuild/netbsd-arm64` | 0.28.2 | MIT | — |
| `@esbuild/netbsd-x64` | 0.28.2 | MIT | — |
| `@esbuild/openbsd-arm64` | 0.28.2 | MIT | — |
| `@esbuild/openbsd-x64` | 0.28.2 | MIT | — |
| `@esbuild/openharmony-arm64` | 0.28.2 | MIT | — |
| `@esbuild/sunos-x64` | 0.28.2 | MIT | — |
| `@esbuild/win32-arm64` | 0.28.2 | MIT | — |
| `@esbuild/win32-ia32` | 0.28.2 | MIT | — |
| `@esbuild/win32-x64` | 0.28.2 | MIT | — |
| `@isaacs/cliui` | 9.0.0 | BlueOak-1.0.0 | — |
| `@jridgewell/gen-mapping` | 0.3.13 | MIT | — |
| `@jridgewell/remapping` | 2.3.5 | MIT | — |
| `@jridgewell/resolve-uri` | 3.1.2 | MIT | — |
| `@jridgewell/source-map` | 0.3.11 | MIT | — |
| `@jridgewell/sourcemap-codec` | 1.6.0 | MIT | — |
| `@jridgewell/trace-mapping` | 0.3.31 | MIT | — |
| `@napi-rs/lzma-linux-x64-gnu` | 1.5.1 | MIT | — |
| `@oxc-project/types` | 0.153.0 | MIT | — |
| `@rolldown/binding-android-arm-eabi` | 1.2.13 | MIT | — |
| `@rolldown/binding-android-arm64` | 1.2.13 | MIT | — |
| `@rolldown/binding-darwin-arm64` | 1.2.13 | MIT | — |
| `@rolldown/binding-darwin-x64` | 1.2.13 | MIT | — |
| `@rolldown/binding-freebsd-x64` | 1.2.13 | MIT | — |
| `@rolldown/binding-linux-arm-gnueabihf` | 1.2.13 | MIT | — |
| `@rolldown/binding-linux-arm64-gnu` | 1.2.13 | MIT | — |
| `@rolldown/binding-linux-arm64-musl` | 1.2.13 | MIT | — |
| `@rolldown/binding-linux-ppc64-gnu` | 1.2.13 | MIT | — |
| `@rolldown/binding-linux-s390x-gnu` | 1.2.13 | MIT | — |
| `@rolldown/binding-linux-x64-gnu` | 1.2.13 | MIT | — |
| `@rolldown/binding-linux-x64-musl` | 1.2.13 | MIT | — |
| `@rolldown/binding-openharmony-arm64` | 1.2.13 | MIT | — |
| `@rolldown/binding-win32-arm64-msvc` | 1.2.13 | MIT | — |
| `@rolldown/binding-win32-x64-msvc` | 1.2.13 | MIT | — |
| `@rolldown/pluginutils` | 1.0.1 | MIT | — |
| `@rollup/plugin-babel` | 6.1.0 | MIT | — |
| `@rollup/plugin-node-resolve` | 16.0.3 | MIT | — |
| `@rollup/plugin-replace` | 6.0.3 | MIT | — |
| `@rollup/plugin-terser` | 1.0.0 | MIT | — |
| `@rollup/pluginutils` | 5.4.0 | MIT | — |
| `@rollup/rollup-android-arm-eabi` | 4.64.5 | MIT | — |
| `@rollup/rollup-android-arm64` | 4.64.5 | MIT | — |
| `@rollup/rollup-darwin-arm64` | 4.64.5 | MIT | — |
| `@rollup/rollup-darwin-x64` | 4.64.5 | MIT | — |
| `@rollup/rollup-freebsd-arm64` | 4.64.5 | MIT | — |
| `@rollup/rollup-freebsd-x64` | 4.64.5 | MIT | — |
| `@rollup/rollup-linux-arm-gnueabihf` | 4.64.5 | MIT | — |
| `@rollup/rollup-linux-arm-musleabihf` | 4.64.5 | MIT | — |
| `@rollup/rollup-linux-arm64-gnu` | 4.64.5 | MIT | — |
| `@rollup/rollup-linux-arm64-musl` | 4.64.5 | MIT | — |
| `@rollup/rollup-linux-loong64-gnu` | 4.64.5 | MIT | — |
| `@rollup/rollup-linux-loong64-musl` | 4.64.5 | MIT | — |
| `@rollup/rollup-linux-ppc64-gnu` | 4.64.5 | MIT | — |
| `@rollup/rollup-linux-ppc64-musl` | 4.64.5 | MIT | — |
| `@rollup/rollup-linux-riscv64-gnu` | 4.64.5 | MIT | — |
| `@rollup/rollup-linux-riscv64-musl` | 4.64.5 | MIT | — |
| `@rollup/rollup-linux-s390x-gnu` | 4.64.5 | MIT | — |
| `@rollup/rollup-linux-x64-gnu` | 4.64.5 | MIT | — |
| `@rollup/rollup-linux-x64-musl` | 4.64.5 | MIT | — |
| `@rollup/rollup-openbsd-x64` | 4.64.5 | MIT | — |
| `@rollup/rollup-openharmony-arm64` | 4.64.5 | MIT | — |
| `@rollup/rollup-win32-arm64-msvc` | 4.64.5 | MIT | — |
| `@rollup/rollup-win32-ia32-msvc` | 4.64.5 | MIT | — |
| `@rollup/rollup-win32-x64-gnu` | 4.64.5 | MIT | — |
| `@rollup/rollup-win32-x64-msvc` | 4.64.5 | MIT | — |
| `@tauri-apps/cli-darwin-arm64` | 2.12.2 | Apache-2.0 OR MIT | — |
| `@tauri-apps/cli-darwin-x64` | 2.12.2 | Apache-2.0 OR MIT | — |
| `@tauri-apps/cli-linux-arm-gnueabihf` | 2.12.2 | Apache-2.0 OR MIT | — |
| `@tauri-apps/cli-linux-arm64-gnu` | 2.12.2 | Apache-2.0 OR MIT | — |
| `@tauri-apps/cli-linux-arm64-musl` | 2.12.2 | Apache-2.0 OR MIT | — |
| `@tauri-apps/cli-linux-riscv64-gnu` | 2.12.2 | Apache-2.0 OR MIT | — |
| `@tauri-apps/cli-linux-x64-gnu` | 2.12.2 | Apache-2.0 OR MIT | — |
| `@tauri-apps/cli-linux-x64-musl` | 2.12.2 | Apache-2.0 OR MIT | — |
| `@tauri-apps/cli-win32-arm64-msvc` | 2.12.2 | Apache-2.0 OR MIT | — |
| `@tauri-apps/cli-win32-ia32-msvc` | 2.12.2 | Apache-2.0 OR MIT | — |
| `@tauri-apps/cli-win32-x64-msvc` | 2.12.2 | Apache-2.0 OR MIT | — |
| `@trickfilm400/rollup-plugin-off-main-thread` | 3.0.0-pre1 | Apache-2.0 | — |
| `@types/chai` | 5.2.3 | MIT | — |
| `@types/deep-eql` | 4.0.2 | MIT | — |
| `@types/estree` | 1.0.9 | MIT | — |
| `@types/resolve` | 1.20.2 | MIT | — |
| `@types/trusted-types` | 2.0.7 | MIT | — |
| `@types/whatwg-mimetype` | 3.0.2 | MIT | — |
| `@typescript/typescript-aix-ppc64` | 7.0.2 | Apache-2.0 | — |
| `@typescript/typescript-darwin-arm64` | 7.0.2 | Apache-2.0 | — |
| `@typescript/typescript-darwin-x64` | 7.0.2 | Apache-2.0 | — |
| `@typescript/typescript-freebsd-arm64` | 7.0.2 | Apache-2.0 | — |
| `@typescript/typescript-freebsd-x64` | 7.0.2 | Apache-2.0 | — |
| `@typescript/typescript-linux-arm` | 7.0.2 | Apache-2.0 | — |
| `@typescript/typescript-linux-arm64` | 7.0.2 | Apache-2.0 | — |
| `@typescript/typescript-linux-loong64` | 7.0.2 | Apache-2.0 | — |
| `@typescript/typescript-linux-mips64el` | 7.0.2 | Apache-2.0 | — |
| `@typescript/typescript-linux-ppc64` | 7.0.2 | Apache-2.0 | — |
| `@typescript/typescript-linux-riscv64` | 7.0.2 | Apache-2.0 | — |
| `@typescript/typescript-linux-s390x` | 7.0.2 | Apache-2.0 | — |
| `@typescript/typescript-linux-x64` | 7.0.2 | Apache-2.0 | — |
| `@typescript/typescript-netbsd-arm64` | 7.0.2 | Apache-2.0 | — |
| `@typescript/typescript-netbsd-x64` | 7.0.2 | Apache-2.0 | — |
| `@typescript/typescript-openbsd-arm64` | 7.0.2 | Apache-2.0 | — |
| `@typescript/typescript-openbsd-x64` | 7.0.2 | Apache-2.0 | — |
| `@typescript/typescript-sunos-x64` | 7.0.2 | Apache-2.0 | — |
| `@typescript/typescript-win32-arm64` | 7.0.2 | Apache-2.0 | — |
| `@typescript/typescript-win32-x64` | 7.0.2 | Apache-2.0 | — |
| `@vitest/mocker` | 5.0.4 | MIT | — |
| `@vitest/spy` | 5.0.4 | MIT | — |
| `acorn` | 8.19.0 | MIT | — |
| `ajv` | 8.20.0 | MIT | — |
| `ansi-regex` | 5.0.1 | MIT | — |
| `ansi-styles` | 4.3.0 | MIT | — |
| `array-buffer-byte-length` | 1.0.2 | MIT | — |
| `arraybuffer.prototype.slice` | 1.0.4 | MIT | — |
| `assertion-error` | 2.0.1 | MIT | — |
| `async` | 3.2.6 | MIT | — |
| `async-function` | 1.0.0 | MIT | — |
| `at-least-node` | 1.0.0 | ISC | — |
| `available-typed-arrays` | 1.0.7 | MIT | — |
| `babel-plugin-polyfill-corejs2` | 0.4.17 | MIT | — |
| `babel-plugin-polyfill-corejs3` | 0.14.2 | MIT | — |
| `babel-plugin-polyfill-regenerator` | 0.6.8 | MIT | — |
| `balanced-match` | 4.0.4 | MIT | — |
| `balanced-match` | 1.0.2 | MIT | — |
| `baseline-browser-mapping` | 2.11.28 | Apache-2.0 | — |
| `brace-expansion` | 5.0.12 | MIT | — |
| `brace-expansion` | 2.1.7 | MIT | — |
| `browserslist` | 4.29.3 | MIT | — |
| `buffer-from` | 1.1.2 | MIT | — |
| `buffer-image-size` | 0.6.4 | MIT | — |
| `call-bind` | 1.0.9 | MIT | — |
| `call-bind-apply-helpers` | 1.0.2 | MIT | — |
| `call-bound` | 1.0.4 | MIT | — |
| `camelcase` | 5.3.1 | MIT | — |
| `caniuse-lite` | 1.0.30001815 | CC-BY-4.0 | — |
| `chai` | 6.3.0 | MIT | — |
| `cliui` | 6.0.0 | ISC | — |
| `color-convert` | 2.0.1 | MIT | — |
| `color-name` | 1.1.4 | MIT | — |
| `commander` | 2.20.3 | MIT | — |
| `common-tags` | 1.8.2 | MIT | — |
| `convert-source-map` | 2.0.0 | MIT | — |
| `core-js-compat` | 3.50.0 | MIT | — |
| `cross-spawn` | 7.0.6 | MIT | — |
| `crypto-random-string` | 2.0.0 | MIT | — |
| `csstype` | 3.2.3 | MIT | — |
| `data-view-buffer` | 1.0.2 | MIT | — |
| `data-view-byte-length` | 1.0.2 | MIT | — |
| `data-view-byte-offset` | 1.0.1 | MIT | — |
| `debug` | 4.4.3 | MIT | — |
| `decamelize` | 1.2.0 | MIT | — |
| `deepmerge` | 4.3.1 | MIT | — |
| `define-data-property` | 1.1.4 | MIT | — |
| `define-properties` | 1.2.1 | MIT | — |
| `detect-libc` | 2.1.2 | Apache-2.0 | — |
| `dijkstrajs` | 1.0.3 | MIT | — |
| `dunder-proto` | 1.0.1 | MIT | — |
| `ejs` | 3.1.10 | Apache-2.0 | — |
| `electron-to-chromium` | 1.5.452 | ISC | — |
| `emoji-regex` | 8.0.0 | MIT | — |
| `entities` | 7.0.1 | BSD-2-Clause | — |
| `es-abstract` | 1.24.2 | MIT | — |
| `es-abstract-get` | 1.0.0 | MIT | — |
| `es-define-property` | 1.0.1 | MIT | — |
| `es-errors` | 1.3.0 | MIT | — |
| `es-module-lexer` | 2.3.2 | MIT | — |
| `es-object-atoms` | 1.1.2 | MIT | — |
| `es-set-tostringtag` | 2.1.0 | MIT | — |
| `es-to-primitive` | 1.3.4 | MIT | — |
| `esbuild` | 0.28.2 | MIT | — |
| `escalade` | 3.2.0 | MIT | — |
| `estree-walker` | 2.0.2 | MIT | — |
| `estree-walker` | 3.0.3 | MIT | — |
| `esutils` | 2.0.3 | BSD-2-Clause | — |
| `eta` | 4.6.0 | MIT | — |
| `expect-type` | 1.4.0 | Apache-2.0 | — |
| `fast-deep-equal` | 3.1.3 | MIT | — |
| `fast-json-stable-stringify` | 2.1.0 | MIT | — |
| `fast-uri` | 3.1.8 | BSD-3-Clause | — |
| `fdir` | 6.5.0 | MIT | — |
| `filelist` | 1.0.6 | Apache-2.0 | — |
| `find-up` | 4.1.0 | MIT | — |
| `for-each` | 0.3.5 | MIT | — |
| `foreground-child` | 3.3.1 | ISC | — |
| `fs-extra` | 9.1.0 | MIT | — |
| `fsevents` | 2.3.3 | MIT | — |
| `function-bind` | 1.1.2 | MIT | — |
| `function.prototype.name` | 1.2.0 | MIT | — |
| `functions-have-names` | 1.2.3 | MIT | — |
| `generator-function` | 2.0.1 | MIT | — |
| `gensync` | 1.0.0-beta.2 | MIT | — |
| `get-caller-file` | 2.0.5 | ISC | — |
| `get-intrinsic` | 1.3.0 | MIT | — |
| `get-own-enumerable-property-symbols` | 3.0.2 | ISC | — |
| `get-proto` | 1.0.1 | MIT | — |
| `get-symbol-description` | 1.1.0 | MIT | — |
| `glob` | 11.1.0 | BlueOak-1.0.0 | — |
| `globalthis` | 1.0.4 | MIT | — |
| `gopd` | 1.2.0 | MIT | — |
| `graceful-fs` | 4.2.11 | ISC | — |
| `has-bigints` | 1.1.0 | MIT | — |
| `has-property-descriptors` | 1.0.2 | MIT | — |
| `has-proto` | 1.2.0 | MIT | — |
| `has-symbols` | 1.1.0 | MIT | — |
| `has-tostringtag` | 1.0.2 | MIT | — |
| `hasown` | 2.0.4 | MIT | — |
| `html-parse-stringify` | 4.0.1 | MIT | — |
| `idb` | 7.1.1 | ISC | — |
| `internal-slot` | 1.1.0 | MIT | — |
| `is-array-buffer` | 3.0.5 | MIT | — |
| `is-async-function` | 2.1.1 | MIT | — |
| `is-bigint` | 1.1.0 | MIT | — |
| `is-boolean-object` | 1.2.2 | MIT | — |
| `is-callable` | 1.2.7 | MIT | — |
| `is-core-module` | 2.17.0 | MIT | — |
| `is-data-view` | 1.0.2 | MIT | — |
| `is-date-object` | 1.1.0 | MIT | — |
| `is-document.all` | 1.0.0 | MIT | — |
| `is-finalizationregistry` | 1.1.1 | MIT | — |
| `is-fullwidth-code-point` | 3.0.0 | MIT | — |
| `is-generator-function` | 1.1.2 | MIT | — |
| `is-map` | 2.0.3 | MIT | — |
| `is-module` | 1.0.0 | MIT | — |
| `is-negative-zero` | 2.0.3 | MIT | — |
| `is-number-object` | 1.1.1 | MIT | — |
| `is-obj` | 1.0.1 | MIT | — |
| `is-regex` | 1.2.1 | MIT | — |
| `is-regexp` | 1.0.0 | MIT | — |
| `is-set` | 2.0.3 | MIT | — |
| `is-shared-array-buffer` | 1.0.4 | MIT | — |
| `is-stream` | 2.0.1 | MIT | — |
| `is-string` | 1.1.1 | MIT | — |
| `is-symbol` | 1.1.1 | MIT | — |
| `is-typed-array` | 1.1.15 | MIT | — |
| `is-weakmap` | 2.0.2 | MIT | — |
| `is-weakref` | 1.1.1 | MIT | — |
| `is-weakset` | 2.0.4 | MIT | — |
| `isarray` | 2.0.5 | MIT | — |
| `isexe` | 2.0.0 | ISC | — |
| `jackspeak` | 4.2.3 | BlueOak-1.0.0 | — |
| `jake` | 10.9.4 | Apache-2.0 | — |
| `js-tokens` | 4.0.0 | MIT | — |
| `jsesc` | 3.1.0 | MIT | — |
| `json-schema-traverse` | 1.0.0 | MIT | — |
| `json5` | 2.2.3 | MIT | — |
| `jsonfile` | 6.2.1 | MIT | — |
| `jsonpointer` | 5.0.1 | MIT | — |
| `leven` | 3.1.0 | MIT | — |
| `lightningcss` | 1.33.0 | MPL-2.0 | — |
| `lightningcss-android-arm64` | 1.33.0 | MPL-2.0 | — |
| `lightningcss-darwin-arm64` | 1.33.0 | MPL-2.0 | — |
| `lightningcss-darwin-x64` | 1.33.0 | MPL-2.0 | — |
| `lightningcss-freebsd-x64` | 1.33.0 | MPL-2.0 | — |
| `lightningcss-linux-arm-gnueabihf` | 1.33.0 | MPL-2.0 | — |
| `lightningcss-linux-arm64-gnu` | 1.33.0 | MPL-2.0 | — |
| `lightningcss-linux-arm64-musl` | 1.33.0 | MPL-2.0 | — |
| `lightningcss-linux-x64-gnu` | 1.33.0 | MPL-2.0 | — |
| `lightningcss-linux-x64-musl` | 1.33.0 | MPL-2.0 | — |
| `lightningcss-win32-arm64-msvc` | 1.33.0 | MPL-2.0 | — |
| `lightningcss-win32-x64-msvc` | 1.33.0 | MPL-2.0 | — |
| `locate-path` | 5.0.0 | MIT | — |
| `lodash.debounce` | 4.0.8 | MIT | — |
| `lru-cache` | 5.1.1 | ISC | — |
| `lru-cache` | 11.5.3 | BlueOak-1.0.0 | — |
| `magic-string` | 0.30.21 | MIT | — |
| `magic-string` | 0.30.21 | MIT | — |
| `magic-string` | 1.4.3 | MIT | — |
| `math-intrinsics` | 1.1.0 | MIT | — |
| `minimatch` | 5.1.9 | ISC | — |
| `minimatch` | 10.2.6 | BlueOak-1.0.0 | — |
| `minipass` | 7.1.3 | BlueOak-1.0.0 | — |
| `ms` | 2.1.3 | MIT | — |
| `nanoid` | 3.3.20 | MIT | — |
| `node-releases` | 2.0.58 | MIT | — |
| `object-inspect` | 1.13.4 | MIT | — |
| `object-keys` | 1.1.1 | MIT | — |
| `object.assign` | 4.1.7 | MIT | — |
| `obug` | 3.0.0 | MIT | — |
| `own-keys` | 1.0.2 | MIT | — |
| `p-limit` | 2.3.0 | MIT | — |
| `p-locate` | 4.1.0 | MIT | — |
| `p-try` | 2.2.0 | MIT | — |
| `package-json-from-dist` | 1.0.1 | BlueOak-1.0.0 | — |
| `path-exists` | 4.0.0 | MIT | — |
| `path-key` | 3.1.1 | MIT | — |
| `path-parse` | 1.0.7 | MIT | — |
| `path-scurry` | 2.0.2 | BlueOak-1.0.0 | — |
| `picocolors` | 1.1.1 | ISC | — |
| `picomatch` | 4.0.7 | MIT | — |
| `playwright` | 1.64.0 | Apache-2.0 | — |
| `playwright-core` | 1.64.0 | Apache-2.0 | — |
| `pngjs` | 5.0.0 | MIT | — |
| `possible-typed-array-names` | 1.1.0 | MIT | — |
| `postcss` | 8.5.29 | MIT | — |
| `pretty-bytes` | 6.1.1 | MIT | — |
| `pretty-bytes` | 5.6.0 | MIT | — |
| `reflect.getprototypeof` | 1.0.10 | MIT | — |
| `regenerate` | 1.5.0 | MIT | — |
| `regenerate-unicode-properties` | 10.3.0 | MIT | — |
| `regexp.prototype.flags` | 1.5.4 | MIT | — |
| `regexpu-core` | 6.5.3 | MIT | — |
| `regjsgen` | 0.8.0 | MIT | — |
| `regjsparser` | 0.13.4 | BSD-2-Clause | — |
| `require-directory` | 2.1.1 | MIT | — |
| `require-from-string` | 2.0.2 | MIT | — |
| `require-main-filename` | 2.0.0 | ISC | — |
| `resolve` | 1.22.13 | MIT | — |
| `rolldown` | 1.2.13 | MIT | — |
| `rollup` | 4.64.5 | MIT | — |
| `safe-array-concat` | 1.1.4 | MIT | — |
| `safe-push-apply` | 1.0.0 | MIT | — |
| `safe-regex-test` | 1.1.0 | MIT | — |
| `scheduler` | 0.28.0 | MIT | — |
| `semver` | 6.3.1 | ISC | — |
| `serialize-javascript` | 7.1.2 | BSD-3-Clause | — |
| `set-blocking` | 2.0.0 | ISC | — |
| `set-function-length` | 1.2.2 | MIT | — |
| `set-function-name` | 2.0.2 | MIT | — |
| `set-proto` | 1.0.0 | MIT | — |
| `shebang-command` | 2.0.0 | MIT | — |
| `shebang-regex` | 3.0.0 | MIT | — |
| `side-channel` | 1.1.1 | MIT | — |
| `side-channel-list` | 1.0.1 | MIT | — |
| `side-channel-map` | 1.0.1 | MIT | — |
| `side-channel-weakmap` | 1.0.2 | MIT | — |
| `signal-exit` | 4.1.0 | ISC | — |
| `smob` | 1.6.2 | MIT | — |
| `source-map` | 0.8.0 | BSD-3-Clause | — |
| `source-map` | 0.6.1 | BSD-3-Clause | — |
| `source-map-js` | 1.2.2 | BSD-3-Clause | — |
| `source-map-support` | 0.5.21 | MIT | — |
| `std-env` | 4.3.0 | MIT | — |
| `stop-iteration-iterator` | 1.1.0 | MIT | — |
| `string-width` | 4.2.3 | MIT | — |
| `string.prototype.matchall` | 4.1.0 | MIT | — |
| `string.prototype.trim` | 1.2.11 | MIT | — |
| `string.prototype.trimend` | 1.0.10 | MIT | — |
| `string.prototype.trimstart` | 1.0.8 | MIT | — |
| `stringify-object` | 3.3.0 | BSD-2-Clause | — |
| `strip-ansi` | 6.0.1 | MIT | — |
| `strip-comments` | 2.0.1 | MIT | — |
| `supports-preserve-symlinks-flag` | 1.0.0 | MIT | — |
| `temp-dir` | 2.0.0 | MIT | — |
| `tempy` | 0.6.0 | MIT | — |
| `terser` | 5.51.2 | BSD-2-Clause | — |
| `tinybench` | 6.2.2 | MIT | — |
| `tinyexec` | 1.3.1 | MIT | — |
| `tinyglobby` | 0.2.17 | MIT | — |
| `type-fest` | 0.16.0 | (MIT OR CC0-1.0) | — |
| `typed-array-buffer` | 1.0.3 | MIT | — |
| `typed-array-byte-length` | 1.0.3 | MIT | — |
| `typed-array-byte-offset` | 1.0.5 | MIT | — |
| `typed-array-length` | 1.0.8 | MIT | — |
| `unbox-primitive` | 1.1.0 | MIT | — |
| `undici-types` | 8.9.0 | MIT | — |
| `unicode-canonical-property-names-ecmascript` | 2.0.1 | MIT | — |
| `unicode-match-property-ecmascript` | 2.0.0 | MIT | — |
| `unicode-match-property-value-ecmascript` | 2.2.1 | MIT | — |
| `unicode-property-aliases-ecmascript` | 2.2.0 | MIT | — |
| `unique-string` | 2.0.0 | MIT | — |
| `universalify` | 2.0.1 | MIT | — |
| `upath` | 1.2.0 | MIT | — |
| `update-browserslist-db` | 1.3.4 | MIT | — |
| `use-sync-external-store` | 1.7.0 | MIT | — |
| `whatwg-mimetype` | 3.0.0 | MIT | — |
| `which` | 2.0.2 | ISC | — |
| `which-boxed-primitive` | 1.1.1 | MIT | — |
| `which-builtin-type` | 1.2.1 | MIT | — |
| `which-collection` | 1.0.2 | MIT | — |
| `which-module` | 2.0.1 | ISC | — |
| `which-typed-array` | 1.1.24 | MIT | — |
| `why-is-node-running` | 3.2.1 | MIT | — |
| `workbox-background-sync` | 7.4.1 | MIT | — |
| `workbox-broadcast-update` | 7.4.1 | MIT | — |
| `workbox-build` | 7.4.1 | MIT | — |
| `workbox-cacheable-response` | 7.4.1 | MIT | — |
| `workbox-core` | 7.4.1 | MIT | — |
| `workbox-expiration` | 7.4.1 | MIT | — |
| `workbox-google-analytics` | 7.4.1 | MIT | — |
| `workbox-navigation-preload` | 7.4.1 | MIT | — |
| `workbox-precaching` | 7.4.1 | MIT | — |
| `workbox-range-requests` | 7.4.1 | MIT | — |
| `workbox-recipes` | 7.4.1 | MIT | — |
| `workbox-routing` | 7.4.1 | MIT | — |
| `workbox-strategies` | 7.4.1 | MIT | — |
| `workbox-streams` | 7.4.1 | MIT | — |
| `workbox-sw` | 7.4.1 | MIT | — |
| `workbox-window` | 7.4.1 | MIT | — |
| `wrap-ansi` | 6.2.0 | MIT | — |
| `y18n` | 4.0.3 | ISC | — |
| `yallist` | 3.1.1 | ISC | — |
| `yargs` | 15.4.1 | MIT | — |
| `yargs-parser` | 18.1.3 | ISC | — |

## Comment vérifier soi-même

```bash
npm ci                     # installe exactement ces versions
npm run licences           # régénère docs/LICENCES.md (licences directes, avec leur rôle)
node scripts/list-dependencies.mjs   # régénère ce document
npm ls --all               # l'arbre complet, tel que npm le voit
```
