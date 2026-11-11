# Développement

Lancez OpenLDR depuis les sources pour développer avec. Le dépôt est un monorepo pnpm + Turbo : l'API backend (`apps/server`), l'application Studio (`apps/studio`), ce site vitrine et de documentation (`apps/web`) et des paquets partagés. Les services de support (Postgres, Keycloak et le service de stockage, Garage) tournent dans Docker. Les applications tournent sur votre hôte avec rechargement à chaud.

## Prérequis

- **git**
- **Node.js 20+**
- **pnpm** (ou Corepack : `corepack enable`)
- **Docker** avec le plugin Compose (pour les services de support)

## Démarrage rapide (amorçage en une ligne)

Le script d'amorçage développeur clone le dépôt, installe les dépendances, démarre les services de support, écrit un `.env` de développement et initialise la base de données.

**Linux / macOS**
```
curl -fsSL https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/install/development.sh | bash
```

**Windows (PowerShell)**
```
irm https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/install/development.ps1 | iex
```

Options utiles : `--dir <path>` pour le dossier où cloner, `--branch <name>` pour la branche, `--seed` pour charger aussi les données d'exemple WHONET, `--reset-db` pour forcer une base neuve (destructif), `--no-services` pour ignorer Docker et la base. (Sous PowerShell : `-Dir`, `-Branch`, `-Seed`, `-ResetDb`, `-NoServices`.)

## Installation manuelle

Si vous préférez le faire à la main :

```
git clone https://github.com/Open-Laboratory-Data-Repository/openldr.git
cd openldr
pnpm install

# dev config — enables a no-login dev admin so you don't need to configure Keycloak
cp .env.example .env
printf '\nAUTH_DEV_BYPASS=true\n' >> .env   # required: the bypass is off unless you set it

# backing services (Postgres :5433, S3 storage (Garage) :9010, Keycloak :8180)
docker compose up -d

# create the schema and seed the starter set (forms, workflows, terminology)
pnpm openldr db reset
pnpm openldr db seed
```

Si votre `.env` date d'avant 0.1.11, remplacez `S3_ACCESS_KEY_ID` et `S3_SECRET_ACCESS_KEY` par les valeurs de `.env.example`.

> La base de données n'est **pas** migrée automatiquement en développement (`MIGRATE_ON_START` est désactivé). **Après chaque pull qui apporte de nouvelles migrations, lancez donc `pnpm openldr db migrate`**. Cette commande n'est pas destructive et garde vos données. Si l'application affiche des données vides ou si le serveur écrit `relation "…" does not exist` dans les journaux, c'est la solution. `db seed` refuse de s'exécuter sur un schéma en retard sur le code et vous indique ce qui est en attente.
>
> N'utilisez `pnpm openldr db reset` que si vous voulez vraiment repartir de zéro : cette commande **supprime et recrée le schéma**, et détruit tout le contenu de votre base de développement.

## Lancer les applications

Chaque application tourne dans son propre terminal, depuis la racine du dépôt :

```
pnpm -C apps/server dev   # API        → http://localhost:3000
pnpm -C apps/studio dev   # Studio app → http://localhost:5173/studio
pnpm -C apps/web dev      # This site  → http://localhost:5174
```

Studio redirige `/api` vers le serveur sur le port 3000. Les deux ports Vite sont fixés dans le `vite.config.ts` de chaque application avec `strictPort`. Un conflit de port échoue donc de façon visible, au lieu de déplacer en silence une application sur un autre port. Avec `AUTH_DEV_BYPASS` activé, Studio s'ouvre directement en administrateur de développement, sans connexion. Retirez-la de `.env` pour tester le vrai parcours Keycloak.

### Accéder au serveur de développement depuis un autre appareil

Vite écoute sur localhost, donc un téléphone sur le même réseau ne peut pas charger Studio. Définissez `DEV_HOST` dans le `.env` à la racine du dépôt, avec l'adresse sur laquelle Vite doit écouter à la place :

```
DEV_HOST=127.0.0.1
```

`apps/studio/vite.config.ts` la lit dans ce fichier. `.env` est ignoré par git, donc aucune adresse propre à une machine ne se retrouve dans un fichier suivi. Ne la définissez pas pour garder le comportement par défaut, sur localhost uniquement. Seules les variables nommées `DEV_*` sont lues, ce qui garde le reste de `.env` hors de la configuration Vite.

> `AUTH_DEV_BYPASS` est **désactivé tant que vous ne le définissez pas explicitement**. `NODE_ENV=development` ne l'active pas. Si Studio vous demande de vous connecter sur une copie existante du dépôt, ajoutez `AUTH_DEV_BYPASS=true` à `.env`. Quand il est activé, le serveur écrit un avertissement au démarrage et Studio affiche un bandeau, car dans ce mode l'API n'est pas authentifiée.

## Commandes utiles

| Commande | Ce qu'elle fait |
| --- | --- |
| `pnpm test` | Lance les suites de tests de l'espace de travail. |
| `pnpm typecheck` | Vérifie les types de chaque paquet et application. |
| `pnpm build` | Construit tout (Turbo). |
| `pnpm openldr db migrate` | Applique les migrations en attente. Non destructif : lancez-la après un pull. |
| `pnpm openldr db reset` | Supprime et recrée le schéma de la base de développement (**destructif**). |
| `pnpm openldr db seed` | Charge les formulaires, les flux de travail et la terminologie par défaut. |
| `pnpm -C apps/studio test` | Lance seulement les tests de Studio. |

## Construire des extensions

Les extensions sont écrites en Rust et compilées en WebAssembly. Leur code source est dans `wasm/`.

1. Installez Rust avec [rustup](https://rustup.rs).
2. Ajoutez la cible WebAssembly : `rustup target add wasm32-wasip1`.
3. Si un terminal indique que `cargo` est introuvable, chargez Rust dans ce terminal : `source "$HOME/.cargo/env"`.
4. Construisez une extension :

| Commande | Ce qu'elle construit |
| --- | --- |
| `pnpm build:test-sink` | La petite extension de test, dans `reference-plugins/test-sink/`. |
| `pnpm build:ui-reference` | L'extension de test avec une page, une carte de tableau de bord et un panneau latéral, dans `reference-plugins/ui-reference/`. |
| `pnpm build:plugins` | L'extension WHONET et les autres extensions de référence. L'extension WHONET demande aussi clang et un sysroot WASI. |

Installez une extension construite avec `pnpm openldr plugin install reference-plugins/<name>/plugin.wasm`.

Les tests Rust des extensions se lancent dans `wasm/`, par exemple `cargo test -p openldr-v1-import`. La porte de tests turbo ne les lance pas. Lancez-les vous-même quand vous modifiez une extension.

### Carte et panneau latéral d'une extension

Une extension qui a sa propre page (`ui.entry` dans son manifeste) peut aussi afficher cette page comme carte sur le tableau de bord et comme panneau latéral. Déclarez-les sous `ui.sites` :

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

Les contributions sont les bienvenues. Pour l'instant : forkez le dépôt, créez une branche de fonctionnalité, gardez les tests et les vérifications de types au vert (`pnpm test`, `pnpm typecheck`) et ouvrez une pull request vers `main` qui décrit la modification.

**Convention des routes serveur :** la compression des réponses est enregistrée globalement. Chaque gestionnaire de route asynchrone doit donc faire `return reply.send(...)`. Un simple `reply.send(payload)` renvoie en silence un corps **vide** dès que la charge dépasse environ 1 Ko et que l'envoi devient asynchrone. Le `return` est indispensable, ce n'est pas une question de style. Le mécanisme est expliqué dans le bloc de commentaires en haut de `apps/server/src/sync-routes.ts`.

Utilisez plutôt `await reply.send(...)` quand la fonction doit encore se résoudre en autre chose, par exemple un utilitaire d'authentification qui signale « déjà répondu » en se résolvant à `undefined`. Les deux attendent le thenable de la réponse, et c'est ce qui les rend sûrs. `void reply.send(...)` n'est **pas** un accusé de réception : il jette ce thenable sans l'attendre, il est donc exactement aussi cassé qu'un envoi simple. Un gestionnaire synchrone (`setNotFoundHandler`, `setErrorHandler`) n'atteint jamais ce mécanisme et n'est pas concerné.

Cette convention est imposée par la règle ESLint `openldr/require-return-reply-send` (`apps/server/eslint-rules/`). `pnpm --filter @openldr/server lint` échoue donc sur un envoi simple ou précédé de `void` dans une fonction asynchrone. La règle existe parce qu'aucune forme de test ne détecte ce problème : les fixtures des tests unitaires restent sous le seuil de 1 Ko, donc le bug est invisible même pour un test qui utilise le vrai `buildApp`. Seul un banc de tests d'acceptation en HTTP réel le voit.

> Un guide de contribution plus complet (conventions de code, processus de revue et liste de contrôle des PR) est en cours d'écriture. Revenez plus tard, ou ouvrez une issue pour lancer une discussion.
