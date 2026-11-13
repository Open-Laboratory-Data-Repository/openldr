# Développement

<!-- operator-platform -->

Lancez l'API, Studio et le site public depuis les sources. Les exemples utilisent `~/Downloads/openldr_ce` sous Linux/macOS et `C:\openldr_ce` dans PowerShell. Remplacez-les par votre chemin. Le terminal affiche déjà l'invite bleue ; saisissez seulement la commande. Les lignes atténuées sont des sorties. Les extraits de configuration indiquent le fichier et apparaissent une seule fois. Les images illustrent les commandes sans prouver une installation réussie. Les données de démonstration sont facultatives.

## Préparer une copie de développement séparée

Utilisez un ordinateur de développement et des bases séparées. Les applications tournent sur cet ordinateur ; Docker lance Postgres, Garage et Keycloak. Installez Git, Node.js 22.13+ et Docker avec Compose. Le dépôt impose pnpm 11.22.0, qui exige Node 22.13+. Installez pnpm selon ses [instructions officielles](https://pnpm.io/installation). Si Node fournit Corepack, `corepack enable` active le lanceur pnpm. Ouvrez un terminal après ces installations.

### 1. Vérifier les outils

Lancez chaque commande séparément. Les commandes de version affichent les versions installées. `docker info` doit aussi afficher une section Server fonctionnelle. Arrêtez si une commande manque ou si Docker ne répond pas.

```sh
{{operator:dev-tools}}
```

![Vérifier les outils.](guide:operator-dev-tools)

### 2. Cloner dans un dossier inutilisé

Cet exemple télécharge le code dans `openldr_ce`. Le dossier Downloads doit déjà exister sous Linux/macOS. Choisissez un autre dossier parent existant si nécessaire. Ne clonez pas dans le dossier Compose installé.

```sh
{{operator:dev-clone}}
```

![Cloner dans un dossier inutilisé.](guide:operator-dev-clone)

### 3. Entrer dans le dépôt

Utilisez votre chemin dans toute cette page. Les commandes `pnpm` suivantes partent de cette racine, où figurent `package.json` et `pnpm-workspace.yaml`.

```sh
{{operator:dev-folder}}
```

![Entrer dans le dépôt.](guide:operator-dev-folder)

### 4. Installer les dépendances

Le fichier de verrouillage choisit les versions. Si pnpm refuse votre version de Node, mettez Node à jour avant de réessayer. Ne supprimez pas ce fichier pour contourner une erreur.

```sh
{{operator:dev-dependencies}}
```

![Installer les dépendances.](guide:operator-dev-dependencies)

## Configurer et initialiser les services de développement

Ces étapes constituent la préparation manuelle. Le script automatique est une autre méthode, pas une étape supplémentaire. Les données de démonstration restent facultatives.

### 1. Créer le fichier de configuration local

Copiez `.env.example` seulement si `.env` est absent. Cette commande conserve un fichier existant. Vérifiez ensuite les URL des bases. Elles doivent désigner vos bases de développement.

```sh
{{operator:dev-copy-env}}
```

![Créer le fichier de configuration local.](guide:operator-dev-copy-env)

### 2. Générer une clé de chiffrement

Node affiche une nouvelle clé aléatoire. Copiez cette sortie pour la suite. Conservez la clé existante si votre base contient déjà des secrets de connecteurs chiffrés. Une autre clé ne pourra pas les lire.

```sh
{{operator:dev-key}}
```

![Générer une clé de chiffrement.](guide:operator-dev-key)

### 3. Configurer l'authentification de développement

Modifiez `.env` dans un éditeur. Collez votre clé après `SECRETS_ENCRYPTION_KEY=`. Le texte ci-dessous n'est pas une clé. `AUTH_DEV_BYPASS=true` désactive l'authentification API et ouvre Studio en administrateur de développement. Réservez ce mode à un environnement isolé. Gardez les autres valeurs du `.env.example` actuel, dont les identifiants Garage de développement.

```text
{{operator:dev-env}}
```

![Configurer l'authentification de développement.](guide:operator-dev-env)

### 4. Démarrer les services Docker

Démarrez Docker, puis lancez ces commandes dans l'ordre. Attendez que Postgres accepte les connexions et que le stockage soit sain. Un conteneur démarré ne prouve pas que le service est prêt. Consultez `docker compose logs SERVICE_NAME` en cas d'échec.

```sh
{{operator:dev-services}}
```

![Démarrer les services Docker.](guide:operator-dev-services)

### 5. Migrer et initialiser le schéma

La migration applique les changements de schéma sans supprimer vos données. L'initialisation ajoute les définitions par défaut, comme les formulaires, les workflows et la terminologie. Elle n'exige pas de dossiers de laboratoire fictifs. Arrêtez si une commande échoue.

```sh
{{operator:dev-migrate}}
```

![Migrer et initialiser le schéma.](guide:operator-dev-migrate)

## Lancer les applications et la CLI

Utilisez un terminal séparé pour chaque serveur de développement. Entrez dans la même racine du dépôt dans chacun. Laissez les serveurs actifs pendant l'utilisation des pages.

### 1. Démarrer l'API

L'API utilise normalement `http://localhost:3000`. Le serveur affiche un avertissement si l'authentification est désactivée. Lisez les erreurs de démarrage avant d'ouvrir Studio.

```sh
{{operator:dev-api}}
```

![Démarrer l'API.](guide:operator-dev-api)

### 2. Démarrer Studio

Ouvrez `http://localhost:5173/studio/`. Studio transmet les requêtes `/api` au port 3000. Le mode de développement ouvre l'application sans connexion et affiche un bandeau. Pour une connexion normale, voir le [guide illustré d'installation](/docs/install).

```sh
{{operator:dev-studio}}
```

![Démarrer Studio.](guide:operator-dev-studio)

### 3. Démarrer le site public

Ouvrez `http://localhost:5174/`. Studio utilise 5173, ce site utilise 5174. En cas de conflit, ils s'arrêtent au lieu de changer de port. Arrêtez l'ancien processus concerné avant de réessayer.

```sh
{{operator:dev-web}}
```

![Démarrer le site public.](guide:operator-dev-web)

### 4. Lancer la CLI depuis les sources

Le lanceur source est `pnpm openldr`, depuis la racine du dépôt. Pour une commande de récupération comme `health`, il lit `.env` et contacte les services Docker. Toutes les autres commandes vont à l'API à l'adresse `OPENLDR_URL`, par défaut `http://127.0.0.1:3000`, donc gardez l'API de l'étape 1 en marche. Avec `AUTH_DEV_BYPASS=true`, l'API connecte ces commandes. Voir [Connexion du CLI et clés d'accès](/docs/cli-access). Consultez le [guide CLI](/docs/cli) pour les commandes et chemins.

```sh
{{operator:dev-cli}}
```

![Lancer la CLI depuis les sources.](guide:operator-dev-cli)

## Ouvrir le site de développement depuis un autre appareil

Cette étape est facultative. Une API de développement sans authentification doit rester sur un réseau privé. L'API écoute déjà sur toutes les interfaces ; vérifiez le pare-feu avant d'autoriser un accès distant.

### 1. Configurer l'adresse d'écoute Vite

Modifiez `.env`. `0.0.0.0` fait écouter les deux serveurs Vite sur toutes les interfaces IPv4. Vous pouvez choisir l'adresse privée ou Tailscale de votre ordinateur. `127.0.0.1` accepte seulement les connexions locales.

```text
{{operator:dev-remote}}
```

![Configurer l'adresse d'écoute Vite.](guide:operator-dev-remote)

### 2. Redémarrer le serveur de développement

Appuyez sur Ctrl+C dans le terminal Studio et relancez-le. Relancez aussi le site public si nécessaire. Sur l'autre appareil, ouvrez `http://YOUR_PRIVATE_HOST:5173/studio/` avec votre adresse. N'utilisez pas `0.0.0.0` ni `localhost` comme adresse distante.

```sh
{{operator:dev-restart}}
```

![Redémarrer le serveur de développement.](guide:operator-dev-restart)

## Mettre à jour ou réinitialiser le développement

Migrez après avoir récupéré des changements de schéma. La réinitialisation est un choix destructif séparé.

### 1. Mettre à jour sans supprimer les données

Consultez d'abord `git status`. Validez ou mettez vos changements de côté avant le pull. Arrêtez si Git ou l'installation échoue. Migrez avant de démarrer l'API mise à jour. `db seed` refuse un schéma en retard et ne remplace pas la migration.

```sh
{{operator:dev-update}}
```

![Mettre à jour sans supprimer les données.](guide:operator-dev-update)

### 2. Vérifier l'application modifiée

Cet exemple vérifie le site public. Choisissez le paquet concerné pour les autres changements. À la racine, `pnpm test`, `pnpm typecheck` et `pnpm build` lancent les tâches du dépôt. Les tests Rust sont séparés.

```sh
{{operator:dev-check}}
```

![Vérifier l'application modifiée.](guide:operator-dev-check)

### 3. Réinitialiser seulement une base jetable

Facultatif et destructif. Vérifiez les deux URL des bases. Ces commandes suppriment et recréent le schéma, puis chargent les définitions. Ne les utilisez pas pour une migration manquante. `pnpm e2e:seed` et `pnpm docs:seed` réinitialisent aussi les données et construisent des extensions ; ces jeux de test ne sont pas nécessaires. Chacun a une moitié de réinitialisation qui n'a pas besoin de l'API, et une moitié de chargement qui passe par l'API en marche. Lancez-les dans l'ordre donné par `e2e/README.md`.

```sh
{{operator:dev-reset}}
```

![Réinitialiser seulement une base jetable.](guide:operator-dev-reset)

## Utiliser le script plutôt que la préparation manuelle

Utilisez cette alternative dans une installation de développement isolée. Le script crée `.env` seulement s'il est absent. Un nouveau `.env` déclenche une réinitialisation, même si la base par défaut existe déjà. Un `.env` existant évite cette opération sauf demande explicite. Vérifiez ce comportement avant toute utilisation avec des bases existantes.

### 1. Télécharger le script

Téléchargez dans un dossier temporaire. Choisissez la bonne plateforme ci-dessus. Télécharger le fichier ne l'exécute pas.

```sh
{{operator:dev-bootstrap-download}}
```

![Télécharger le script.](guide:operator-dev-bootstrap-download)

### 2. Lire avant d'exécuter

Lisez le fichier. Dans `less`, appuyez sur q pour quitter. Vérifiez le dossier cible, la création de `.env` et les conditions de réinitialisation. Si vous avez suivi la préparation manuelle, ignorez cette alternative.

```sh
{{operator:dev-bootstrap-read}}
```

![Lire avant d'exécuter.](guide:operator-dev-bootstrap-read)

### 3. Exécuter avec une destination explicite

Utilisez un nouveau dossier de développement. Le script installe les dépendances, démarre les services et initialise la base neuve. Il ne démarre pas l'API ni Studio. Continuez avec Lancer les applications ci-dessus. N'ajoutez l'option de démonstration que si vous acceptez sa préparation destructive.

```sh
{{operator:dev-bootstrap-run}}
```

![Exécuter avec une destination explicite.](guide:operator-dev-bootstrap-run)

## Construire et tester une extension de référence

Facultatif. Installez Rust avec [rustup](https://rustup.rs). Rouvrez le terminal si `cargo` est absent. Réservez l'extension de test à une installation de développement.

### 1. Ajouter la cible WebAssembly

Lancez ces commandes depuis la racine. Les extensions actuelles utilisent `wasm32-wasip1`. Aucune donnée de laboratoire fictive n'est nécessaire.

```sh
{{operator:dev-rust}}
```

![Ajouter la cible WebAssembly.](guide:operator-dev-rust)

### 2. Construire l'extension de test

Cet exemple Rust ne demande pas les outils C de WHONET. Le script écrit `plugin.wasm` et `manifest.json` dans `reference-plugins/test-sink/`.

```sh
{{operator:dev-plugin-build}}
```

![Construire l'extension de test.](guide:operator-dev-plugin-build)

### 3. Lancer ses tests Rust

La commande de tests JavaScript ne lance pas ces tests Rust. Vérifiez le paquet Rust lorsque vous le modifiez.

```sh
{{operator:dev-plugin-test}}
```

![Lancer ses tests Rust.](guide:operator-dev-plugin-test)

### 4. Installer uniquement dans le système de test

Ces commandes écrivent dans le registre et le stockage de développement. Vérifiez `.env`. Avant de les lancer, ajoutez `MARKETPLACE_DEV_ALLOW_UNSIGNED=true` au `.env` du test isolé et redémarrez l'API. Gardez le manifeste à côté du fichier WASM. Cette compilation n'est pas signée ; réservez le réglage de développement non signé à un système isolé. Utilisez des paquets signés et approuvés dans une installation normale.

```sh
{{operator:dev-plugin-install}}
```

![Installer uniquement dans le système de test.](guide:operator-dev-plugin-install)

## Options du script et commandes de compilation

| Linux/macOS | PowerShell | Effet |
| --- | --- | --- |
| `--dir PATH` | `-Dir PATH` | Choisir le dossier du dépôt. |
| `--branch NAME` | `-Branch NAME` | Choisir la branche d'un nouveau clone. |
| `--no-services` | `-NoServices` | Ignorer Docker et l'initialisation des bases. |
| `--reset-db` | `-ResetDb` | Réinitialiser une base de développement existante. Destructif. |
| `--seed` | `-Seed` | À l'initialisation, lancer la préparation destructive WHONET. Outils de compilation requis. Si une API répond déjà à `http://127.0.0.1:3000`, le script s'arrête avant toute réinitialisation. Sinon il démarre sa propre API pour le chargement et la laisse en marche. Non testé. |

`pnpm build:ui-reference` construit l'extension avec page, carte et panneau. `pnpm build:v1-import` construit l'importateur v1. `pnpm build:plugins` construit WHONET et les autres extensions de référence. WHONET exige aussi clang et un sysroot WASI.

Pour un paquet local non signé dans un système de test isolé, ajoutez `MARKETPLACE_DEV_ALLOW_UNSIGNED=true` à son `.env` et redémarrez l'API. Gardez ce réglage désactivé en installation normale. Voir [Variables d'environnement](/docs/environment).

## Carte et panneau latéral d'une extension

Une extension qui a sa propre page (`ui.entry` dans son manifeste) peut aussi afficher cette page comme carte sur le tableau de bord et comme panneau latéral. Déclarez-les sous `ui.sites` :

**`manifest.json`, extrait**

```json
"ui": {
  "entry": "ui.html",
  "sha256": "<sha256 of ui.html>",
  "nav": { "label": "Bench notes" },
  "sites": {
    "widget": { "title": "Today", "height": "small" },
    "panel": { "title": "Bench notes" }
  }
}
```

- Les deux sont facultatifs. `height` vaut `small`, `medium` ou `large` : 160, 240 ou 360 px de haut. La valeur par défaut est `medium`.
- Les titres font de 1 à 60 caractères.
- `ui.sites` fait partie du manifeste signé, la signature le couvre donc. Les paquets signés avant son arrivée se vérifient toujours.
- L'extension fournit un seul `ui.html`. Après `await openldr.ready`, lisez `openldr.site`. Sa valeur est `page`, `widget` ou `panel`. Affichez la vue de cet emplacement.
- Chaque emplacement utilise les mêmes appels au broker, le même stockage et le même contrôle de rôle, `ui.requiredRoles`.

La Documentation du studio explique ce que voient les utilisateurs, dans **Cartes et panneaux latéraux des extensions**.

## Contribuer

Créez un fork et une branche de travail. Lancez les tests, vérifications de types et compilations concernés. Ouvrez une pull request vers `main` avec le changement et sa validation.

Les routes serveur asynchrones doivent utiliser `return reply.send(...)`. Utilisez `await reply.send(...)` si un utilitaire doit renvoyer une autre valeur. Un appel seul ou précédé de `void` n'attend pas la compression asynchrone et peut envoyer un corps vide. Voir le commentaire au début de `apps/server/src/sync-routes.ts`.

`pnpm --filter @openldr/server lint` applique la règle `openldr/require-return-reply-send`. Testez les grandes réponses via HTTP réel lorsque vous modifiez leur traitement. Les petits contenus des tests unitaires ne déclenchent pas la compression asynchrone.
