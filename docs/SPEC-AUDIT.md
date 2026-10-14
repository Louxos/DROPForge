# Audit du prompt maître — ce qui est fait, ce qui ne l'est pas

Ce document répond à une seule question : **tout ce qui est décrit dans le `prompt`
a-t-il été fait ?** Il ne décrit pas ce qui serait souhaitable, il constate. Chaque
ligne donne l'état réel, la preuve (fichier, commande, tâche d'intégration) et ce qui
manque.

États utilisés :

| État | Sens |
| --- | --- |
| **✅ fait** | Implémenté, couvert par des tests, vérifié par la chaîne d'intégration à chaque envoi. |
| **🟡 partiel** | Une partie existe et fonctionne ; le reste est nommé, avec la raison. |
| **⚠️ non prouvé** | Existe et se compile, mais aucune vérification automatique ne peut le prouver (essai humain, appareil réel, service tiers). |
| **🔒 propriétaire** | Ne peut être fait que par le propriétaire du dépôt (secret, réglage de compte, décision légale). |
| **❌ écarté** | Impossible ou incompatible avec la gratuité ; l'alternative retenue est indiquée. |

---

## 1. Vision

| Exigence | État | Preuve / limite |
| --- | --- | --- |
| Transfert simple entre Windows, Android, iPhone/iPad | ✅ / ⚠️ | Application Windows compilée et empaquetée par la tâche « Application Windows » ; PWA installable pour Android/iOS (`manifest.webmanifest`, service worker). **Aucun essai sur appareil réel** n'a été fait. |
| Aucun compte utilisateur | ✅ | Il n'existe ni écran de connexion, ni champ de courriel, ni jeton : `docs/PRIVACY.md`. |
| Gratuit pour le propriétaire et les utilisateurs | ✅ | Aucune dépendance payante, aucun service payant indispensable : `docs/FREE-DEPLOYMENT.md`, `docs/DEPENDENCIES.md`. |
| Ne jamais promettre une capacité illimitée | ✅ | Les capacités mesurées sont affichées (« Ce que ce navigateur sait faire ») et l'option indisponible est **désactivée avec sa raison**, jamais un bouton qui échoue après coup. |

## 2. Plateformes et technologies

| Exigence | État | Preuve / limite |
| --- | --- | --- |
| Windows : Tauri 2, Rust pour le système, React + TypeScript pour l'interface | ✅ | `apps/desktop/src-tauri` (Rust : fenêtre, SQLite, dossier de réception, zone de notification) et `apps/desktop/src` (React/TS). `npm run build:windows` dans la tâche Windows. |
| PWA installable, adaptée aux limites réelles des navigateurs | ✅ | `apps/web/public/manifest.webmanifest`, service worker, `docs/PLATFORM-MATRIX.md` § PWA. |
| Interface partagée, couches natives distinctes | ✅ | `packages/design-system` + `packages/app-core` partagés ; seules la couche de plateforme et la coque diffèrent (`apps/web/src/platform`, `apps/desktop/src/platform`). |
| Dépendances maintenues, licences compatibles, gratuites | ✅ | `docs/DEPENDENCIES.md` : 30 dépendances directes, 498 transitives, 11 licences, **aucune licence copyleft forte**. |
| Hébergement statique et services distants gratuits seulement | ✅ / ❌ | GitHub Pages et Releases (gratuits) : `docs/FREE-DEPLOYMENT.md`. Le partage hébergé n'a **aucun** service retenu (voir §6) : il est désactivé proprement plutôt que facturé. |

## 3. Design premium

| Exigence | État | Preuve |
| --- | --- | --- |
| Thème sombre par défaut, thème clair disponible | ✅ | `color-scheme: dark` par défaut, bascule dans les Réglages, testée. |
| Palette charbon/noir, accents violet et bleu électrique maîtrisés | ✅ | Jetons dans `packages/design-system/src/styles.css` ; le logo utilise exactement `#7c5cff` → `#389cff`. |
| Typographie soignée, espace généreux, bordures discrètes | ✅ | Échelle d'espacement et rayons partagés. |
| Animations élégantes et performantes | ✅ | Transitions courtes, `@media (prefers-reduced-motion: reduce)` respecté. |
| Symbole de marque minimaliste + nom | ✅ | Source unique `packages/design-system/src/brand-mark.mjs` : icône du `.exe` (7 tailles, 16→256 px), installateur, fenêtre, zone de notification, écran d'attente, favicon, manifeste, icône iOS. Régénération par `npm run icons`. |
| Sidebar sur PC, barre fixe en bas sur mobile | ✅ | `apps/web/src/app/shell.tsx`, `apps/web/src/styles/app.css` ; vérifié par le test de bout en bout sur écran de téléphone. |
| États de chargement, vides, erreurs, permissions, déconnexion, réussite | ✅ | `NoticeStack`, écran d'échec de démarrage (`FatalScreen`), états vides explicites (« Aucun appareil joignable pour le moment »). |
| Jamais de fausse progression ni de fausses données | ✅ | Une barre sans mesure est **indéterminée** et n'affiche aucun pourcentage (`df-progress--indeterminate`) ; la vitesse et l'estimation ne s'affichent que si elles sont mesurées. |

## 4. Fonctionnalités

| Exigence | État | Preuve / limite |
| --- | --- | --- |
| Tous les types de fichiers de la plateforme | ✅ | Contenu binaire opaque, nom et type conservés. |
| Sélection multiple et dossiers selon l'OS | 🟡 | Multiple : ✅ partout. Dossiers : ✅ Windows (dialogue natif) et Chromium (File System Access) ; ❌ Firefox et iOS (aucun accès au disque) — affiché comme indisponible. |
| Transferts dans les deux sens | ✅ | `packages/transfer-engine` : expéditeur et destinataire symétriques, testés. |
| Découverte locale, QR code, connexion manuelle | 🟡 | Association par code/QR (±vérification d'identité) ✅ et connexion manuelle ✅ ; la découverte est **logique** (annonces signées via le service de signalisation) — le transport natif mDNS/UDP n'est pas branché (`docs/PLATFORM-MATRIX.md`). |
| Appareils de confiance mémorisables, révocables individuellement | ✅ | `packages/device-manager`, écran Appareils, révocation testée. |
| Confirmation explicite avant d'accepter un appareil ou une demande | ✅ | Demande envoyée **des deux côtés** (capacité `trust.request`, message dédié) et demande de réception distincte, toutes deux testées (unitaires + navigateur). |
| File d'attente avec progression, vitesse, estimation si fiable | ✅ | `packages/transfer-engine/src/queue.ts` ; l'estimation n'apparaît qu'après mesure. |
| Pause, reprise, annulation, réessai, réordonnancement | ✅ | Actions testées dans `queue.test.ts` et `session.test.ts`. |
| Transferts simultanés configurables, limites raisonnables | ✅ | Réglage 1→8, appliqué par la file. |
| Reprise après interruption, état persistant, limites expliquées | 🟡 | État persisté et reprise testés côté moteur ; sur le web, un transfert ne continue que si l'onglet reste ouvert — **dit explicitement** dans les Réglages et `docs/PLATFORM-MATRIX.md`. |
| Vérification d'intégrité du fichier reçu | ✅ | SHA-256 par fichier ; **aucun transfert ne passe à `completed` sans être passé par `verifying`** (`docs/SPEC.md` §1). |
| Historique détaillé, recherche, filtres, suppression | ✅ | `packages/history`, écran Activité. |
| Favoris, envoi rapide, notifications, réglages, français et anglais | ✅ | Interface FR/EN complète (`apps/web/src/i18n`), favoris et envoi rapide testés. |
| Mode Smart Transfer | ✅ | Choix réel `lan → webrtc → relais → bloqué`, avec l'explication affichée des méthodes essayées. |
| Aucun plafond artificiel de taille, contrôle des limites réelles | ✅ | Réglage « taille maximale par transfert » (aucune limite locale par défaut) + plafond lié à l'espace mesuré. |

## 5. Connexions

| Exigence | État | Preuve / limite |
| --- | --- | --- |
| Priorité au transfert local direct | ✅ | `lan` essayé d'abord, puis WebRTC, puis relais. |
| WebRTC DataChannels, signalisation sécurisée | ✅ | `apps/web/src/platform/webrtc-link.ts`, `apps/signaling` (`wss` possible, origine vérifiée, salle à deux pairs, 20 msg/s, TTL 10 min). |
| Relais uniquement si une solution gratuite viable est validée | ✅ / 🟡 | Aucun TURN tiers payant : le relais passe par **notre propre service** (déjà gratuit à l'auto-hébergement), activé seulement si **les deux** appareils l'annoncent (`relay.ready`). Sans service de signalisation joignable, seul le réseau local fonctionne — dit dans l'interface. |
| Explication claire si aucune connexion n'est possible | ✅ | Code `NO_COMMON_TRANSPORT` + liste des méthodes essayées, jamais un échec muet. |
| Ne jamais prétendre que tous les réseaux s'y prêtent | ✅ | `docs/THREAT-MODEL.md`, `docs/PLATFORM-MATRIX.md`, et le texte de l'écran Transfert. |
| La signalisation ne peut pas lire les fichiers | ✅ | Elle ne transporte que la négociation ; les fichiers passent par le canal chiffré de bout en bout. |

## 6. Partage par liens

| Exigence | État | Preuve / limite |
| --- | --- | --- |
| **A.** Transfert direct par défaut, expéditeur disponible | ✅ | Mode par défaut, lien d'appairage `https://…/#c=<code>`, aucune donnée conservée. |
| **B.** Partage hébergé temporaire | 🟡 | Le paquet `packages/sharing` implémente et teste chiffrement côté client, expiration, révocation, limites de taille et de durée ; **aucun service de stockage gratuit suffisamment fiable n'a été retenu**, donc l'option est désactivée proprement et affichée en lecture seule : `docs/SHARING.md`. |
| Chiffrement avant stockage, clé jamais transmise au serveur | ✅ | Chiffrement côté client ; la clé est dans le fragment du lien, jamais envoyée au serveur. |
| Expiration effective, révocation serveur, vérification des autorisations | 🟡 | Implémenté et testé côté code ; ne s'applique qu'avec un service configuré. |
| Suppression des objets expirés, vérification serveur de l'expiration | 🟡 | Préparé côté paquet ; dépend du service d'hébergement, qui n'est pas fourni. |
| Si les quotas gratuits sont insuffisants, désactiver proprement | ✅ | C'est exactement ce qui a été fait, et c'est écrit dans l'interface. |

## 7. Sécurité et confidentialité

| Exigence | État | Preuve / limite |
| --- | --- | --- |
| Pas de compte obligatoire, pas de collecte inutile, pas de télémétrie par défaut | ✅ | Aucune requête sortante hors service de signalisation configuré ; `docs/PRIVACY.md`. |
| Chiffrement de transport éprouvé, chiffrement client pour l'hébergé | ✅ | DTLS/SRTP via WebRTC ; AES-GCM côté client pour l'hébergé. |
| Bibliothèques cryptographiques reconnues, rien d'inventé | ✅ | WebCrypto uniquement (Ed25519, ECDH, AES-GCM, SHA-256) ; aucune primitive maison. |
| Le QR code vérifie l'identité cryptographiquement | ✅ | Preuve d'appairage liée aux empreintes des deux appareils + code court (SAS) à comparer à l'écran. |
| Gestion des clés, rotation/révocation, anti-usurpation, anti-rejeu | ✅ | `packages/security` (poignée de main signée, fenêtre de fraîcheur, révocation) ; `docs/THREAT-MODEL.md`. |
| Permissions Tauri minimales, validation des entrées, chemins contrôlés | ✅ | `capabilities/` (une seule fenêtre, commandes nommées), `scripts/check-desktop-config.mjs` vérifie la liste ; `PATH_ESCAPE` / `UNSAFE_PATH` testés. |
| Ne jamais écraser silencieusement un fichier | ✅ | Règles de conflit (demander, renommer, ignorer, remplacer après confirmation) ; valeur par défaut : demander. |
| Ne pas journaliser les secrets | ✅ | Journaux bornés et nettoyés (`apps/desktop/src-tauri`, `diagnostics.log`) ; aucun contenu de fichier, aucune clé. |
| Erreurs compréhensibles, sans information sensible | ✅ | 42 codes stables (`packages/app-core/src/errors.ts`), message traduit, jamais la trace brute. |
| Limites anti-abus, limitation de débit, rétention des métadonnées | ✅ | Signalisation : 20 msg/s, salle limitée à 2 pairs, TTL 10 min ; historique : rétention configurable (défaut : conserver). |

## 8. Données locales

| Exigence | État | Preuve |
| --- | --- | --- |
| Modèles versionnés (appareils, transferts, fichiers, reprises, partages, préférences) | ✅ | `docs/DATA-MODEL.md` ; chaque enregistrement porte `v`, les migrations sont additives et testées. |
| SQLite côté Windows, stockage adapté côté PWA | ✅ | `tauri-plugin-sql` (SQLite) sur Windows ; IndexedDB sur le web (`IndexedDbMetaStore`, schéma v3). |
| Préférences et historique locaux par défaut | ✅ | Aucun envoi vers un serveur ; l'export JSON est manuel. |
| Persister l'état des transferts sans le contenu | ✅ | File sérialisée : chemins, tailles, plages reçues — jamais les octets. |
| Migrations et interruptions brutales gérées | ✅ | Tests de migration et de reprise, écritures idempotentes. |

## 9. États de transfert

| Exigence | État | Preuve |
| --- | --- | --- |
| Machine à états explicite | ✅ | `docs/SPEC.md` §1 : les neuf états, le diagramme, les transitions autorisées, les délais. |
| Délais, erreurs réseau, manque d'espace, refus de permission, fichier modifié, fermeture | ✅ | Un code stable par situation ; le fichier modifié pendant l'envoi produit un échec explicite, pas un succès douteux. |
| Aucun état contradictoire, aucun « terminé » avant vérification | ✅ | Règle non négociable testée : `verifying` est un passage obligé, et un état terminal n'est écrit que par `finishRecord`. |

## 10. Interface et paramètres

| Exigence | État | Preuve / limite |
| --- | --- | --- |
| Quatre sections : Transfert, Appareils, Activité/Historique, Paramètres | ✅ | Navigation latérale (PC) et barre basse (mobile). |
| Langue, thème, notifications, démarrage Windows, fermeture, dossier de réception, conflits, appareils de confiance, confidentialité, limites | ✅ | Tous présents dans l'écran Paramètres ; ce qui n'existe pas sur une plateforme est **affiché comme indisponible avec la raison** (« Lancer au démarrage de Windows — Disponible uniquement dans l'application Windows »). |
| Installation soignée et désinstallation propre sur Windows | ⚠️ | NSIS et MSI produits par la chaîne d'intégration, WebView2 embarqué, images et icônes exactes, fermeture propre d'une instance en cours, données proposées à la suppression (case décochée par défaut) : `docs/DOWNLOAD.md`, `docs/OWNER-GUIDE.md`. **Aucun essai humain** d'installation/désinstallation. |
| Vérification automatique des mises à jour, approbation avant installation | ✅ / 🔒 | Mécanisme présent (« Rechercher une mise à jour », installation passive après accord), mais **les mises à jour signées attendent deux secrets** que seul le propriétaire peut créer : sans eux, l'application ne propose aucune mise à jour automatique. |
| Mises à jour signées et vérifiées, jamais de vérification désactivée | ✅ | La vérification de signature n'est jamais contournée ; la clé publique est la seule chose exposée au dépôt. |
| Protéger les clés privées, documenter les coûts de signature commerciale | ✅ | `docs/OWNER-GUIDE.md` : clé privée hors du dépôt, coût d'un certificat d'éditeur documenté. |

## 11. Limites PWA

| Exigence | État | Preuve |
| --- | --- | --- |
| Détecter les capacités réellement disponibles | ✅ | `apps/web/src/platform/capabilities.ts`, testé ; la liste mesurée est affichée dans les Réglages. |
| Ne pas promettre l'arrière-plan, la connexion permanente, la reprise après fermeture | ✅ | « Recevoir en arrière-plan : INDISPONIBLE · Sur le web, un transfert ne continue que si l'onglet reste ouvert. DropForge ne promet pas le contraire. » |
| Fonctionnement au premier plan, avertissements, repli iOS | ✅ | Repli par téléchargement quand l'écriture disque n'existe pas, vérifié par le test Firefox et le test iPhone. |

## 12. Architecture modulaire

| Exigence | État | Preuve |
| --- | --- | --- |
| Modules séparés (app-core, transfer-engine, connection-manager, device-manager, security, sharing, history, notifications, settings, design-system, platform-web, platform-windows) | ✅ | `packages/*` et les couches `platform/` de chaque application. |
| Interfaces stables, pas de duplication, interface séparée du moteur | ✅ | Ports injectés (`packages/protocol/src/ports.ts`) : le moteur ne connaît ni le DOM ni le disque ; tests unitaires avec horloge et système de fichiers simulés. |
| Schémas, contrats, migrations, documentation | ✅ | `docs/ARCHITECTURE.md`, `docs/DATA-MODEL.md`, `docs/SPEC.md`. |

## 13. Gratuité et infrastructure

| Exigence | État | Preuve |
| --- | --- | --- |
| Vérifier conditions, quotas et licences avant de retenir un service | ✅ | `docs/FREE-DEPLOYMENT.md`, `docs/DEPENDENCIES.md`, `docs/LICENCES.md` : chaque service retenu est gratuit **pour l'usage prévu**. |
| Aucune facturation automatique, limites strictes, refus avant dépassement | ✅ | Aucun service facturable n'est utilisé ; les limites de la signalisation et du partage sont codées, et le partage hébergé est refusé faute de service. |
| Aucun service payant indispensable au fonctionnement local | ✅ | Sur le réseau local, rien n'est nécessaire côté serveur : le transfert direct se fait d'appareil à appareil. |
| Alternative fonctionnelle et explication honnête si une fonction ne peut rester gratuite | ✅ | Le partage hébergé est la fonction concernée ; le transfert direct reste complet, et la limite est écrite dans l'interface. |

## 14. Tests obligatoires

| Exigence | État | Preuve / limite |
| --- | --- | --- |
| Tests unitaires, intégration, sécurité, bout en bout | ✅ | `npm run verify` : **441 tests, 41 fichiers** (unitaires et intégration) ; suite navigateur Playwright sur Chromium, Firefox et WebKit (iPhone). |
| Gros et petits fichiers, plusieurs fichiers, conflits, espace insuffisant, coupure, reprise, annulation, permission refusée, intégrité, appareil non approuvé, révocation, liens expirés/révoqués, quotas, accès non autorisé, fermeture | ✅ | Chaque situation a son test nommé (voir `docs/TESTING.md`, tableau des cas et des fichiers). Les cas qui exigent deux appareils réels sont couverts par la suite navigateur. |
| Navigateurs mobiles disponibles, limites iOS/Android documentées | 🟡 | Émulation iPhone (WebKit) et téléphone Chromium dans la suite ; **aucun appareil mobile réel** n'a servi aux essais. |
| Migrations, désinstallation, mise à jour signée | 🟡 / 🔒 | Migrations ✅ testées ; désinstallation ⚠️ produite mais jamais essayée à la main ; mise à jour signée 🔒 bloquée par les secrets. |
| Aucune opération ne prétend réussir si elle a échoué | ✅ | Règle de `docs/SPEC.md` §1 (un refus est un échec) + tests dédiés côté moteur et navigateur. |

## 15. Méthode de travail

| Exigence | État | Preuve |
| --- | --- | --- |
| Examiner le dépôt et son état avant de commencer | ✅ | `docs/SPEC.md`, `docs/ARCHITECTURE.md`, `docs/DEPENDENCIES.md`, `docs/PLATFORM-MATRIX.md` sont issus de cette phase. |
| Spécification technique, inventaire des dépendances, diagramme, matrice par plateforme | ✅ | Les quatre documents existent et sont tenus à jour. |
| Identifier les risques avant d'implémenter | ✅ | `docs/ARCHITECTURE.md` (décisions et risques), `docs/THREAT-MODEL.md`. |
| Prototypes ciblés (local, distant, reprise, association, limites PWA) | ✅ | Vérifiés pour de vrai : transfert navigateur à navigateur dans la chaîne d'intégration, reprise et association en tests. |
| Étapes cohérentes, projet compilable et testé | ✅ | Chaque envoi déclenche « Types, tests et compilations », la tâche Windows et la suite navigateur. |
| Ne pas demander les détails techniques ordinaires, documenter les décisions | ✅ | Décisions écrites dans `docs/ARCHITECTURE.md` ; seules les actions du propriétaire ont été signalées. |
| Poser une question seulement si une décision produit indispensable ne peut être déduite | 🔒 | Trois décisions restent : activer GitHub Pages, créer les secrets de signature, choisir la licence. |

## 16. Qualité de livraison

| Exigence | État | Preuve |
| --- | --- | --- |
| Dépôt structuré, instructions de développement, commandes de compilation | ✅ | `README.md`, `npm run dev`, `npm run build`, `npm run package`. |
| Tests reproductibles | ✅ | `npm ci && npm run verify` ; suite navigateur `npm run test:e2e`. |
| Documentation d'architecture, modèle de menaces, confidentialité, licences, déploiement gratuit, mise à jour, dépannage, matrice par plateforme | ✅ | `docs/ARCHITECTURE.md`, `THREAT-MODEL.md`, `PRIVACY.md`, `LICENCES.md`, `FREE-DEPLOYMENT.md`, `UPDATE-PROCEDURE.md`, `TROUBLESHOOTING.md`, `PLATFORM-MATRIX.md`. |
| Distinguer implémenté / testé / partiel / bloqué | ✅ | Ce document, plus `docs/PLATFORM-MATRIX.md` (« Ce qui n'existe pas encore »). |
| Ne jamais marquer une fonctionnalité terminée sur la seule base de l'interface | ✅ | Aucune ligne de ce document ne s'appuie sur une capture d'écran : chaque ✅ renvoie à un test ou à une tâche d'intégration. |
| Ne jamais inventer de résultats de tests | ✅ | Les nombres cités viennent des exécutions de la chaîne d'intégration du dépôt, à la date indiquée plus bas. |
| Revue de sécurité et vérification de stabilité avant publication | 🟡 | Revue faite **par lecture du code** (ci-dessous) et non par un audit externe ; la stabilité est vérifiée par la chaîne d'intégration, pas par un usage prolongé. |

### Revue de sécurité — ce qui a été relu, et ce qu'un audit externe ajouterait

Relu dans le code, à la main : usage de la cryptographie (WebCrypto seulement, aucun
algorithme inventé, clés privées jamais journalisées), permissions Tauri (liste courte,
vérifiée par `scripts/check-desktop-config.mjs`), contrôle des chemins (absolus et
traversées refusés, testés), validation des entrées réseau (schémas de messages
vérifiés avant usage), limitation de débit et de durée côté signalisation, et absence de
collecte par défaut.

Un audit externe apporterait ce que la lecture ne donne pas : essais d'intrusion sur un
déploiement réel, revue de la génération d'aléa et de la gestion mémoire dans la coque
Rust par un tiers, et vérification de la chaîne de publication (les binaires ne sont pas
signés par un certificat d'éditeur).

---

## Objectif final — version 1.0

**Non atteint, et ce document ne prétend pas le contraire.** Ce qui existe est la version
**0.1.1** : installateurs Windows, application web, serveur de signalisation optionnel,
441 tests automatiques et une suite navigateur réelle. Ce qui manque pour une 1.0
honnête :

1. **Un essai humain sur un vrai Windows** — installation, lancement, transfert local,
   désinstallation. La chaîne d'intégration ne peut pas ouvrir la fenêtre à votre place.
2. **Les mises à jour signées** (deux secrets) et, si souhaité, un certificat d'éditeur.
3. **La licence du projet**, décision du propriétaire.
4. **Un service d'hébergement** si le partage par lien doit exister (mode B), ou
   l'acceptation explicite de son absence (mode A, transfert direct, fonctionne sans).
5. **Des essais sur appareils mobiles réels** (au moins un Android et un iPhone).

*Ce document est daté : il décrit l'état au 14 octobre 2026, avec la suite navigateur
de la chaîne d'intégration telle qu'elle s'exécutait ce jour-là.*
