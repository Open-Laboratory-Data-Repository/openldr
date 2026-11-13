# Connexion du CLI et clés d'accès

La plupart des commandes `openldr` passent maintenant par le serveur OpenLDR en marche, comme le fait Studio. Vous vous connectez d'abord, comme personne avec `openldr login` ou comme programme avec une clé d'accès. Le serveur vérifie que votre compte peut lancer la commande, la lance, et l'inscrit dans le journal d'audit sous votre compte.

Cette page montre comment se connecter, comment créer et révoquer des clés d'accès, et comment donner à un agent IA ou à un script un accès propre et restreint. La [référence du CLI](/docs/cli) liste les commandes elles-mêmes.

Les exemples de cette page ont été lancés sous Linux sur une installation autonome. Windows et macOS n'ont pas été testés.

## Trois sortes de commande

Chaque commande a une sorte (`kind`).

| Sorte | Où elle tourne | Connexion |
| --- | --- | --- |
| `app` | Dans le serveur en marche. Presque toutes les commandes. | Nécessaire. |
| `recovery` | Sur la machine qui fait tourner OpenLDR, directement sur la base de données. | Aucune. Les réglages de base de données de la machine tiennent lieu de permission. |
| `local` | Sur votre propre machine. Elle ne touche ni base de données ni serveur. | Aucune. `login`, `logout` et `whoami` ne parlent qu'à la connexion du serveur. |

Pour voir la sorte de chaque commande, lancez :

```sh
openldr commands
```

Les premières lignes de la sortie :

```text
artifact build                     local
artifact keygen                    local
artifact new                       local                  scaffold plugin|form|report
artifact pack                      local
artifact publish                   app       destructive
artifact sign                      local
artifact test                      local
audit list                         app
```

`openldr commands --json` affiche la même liste en JSON, pour qu'un programme la lise. Chaque entrée a `path`, `description`, `arguments`, `options`, `kind`, `capability`, `alsoRequires` et `destructive`. Voici une entrée, sans sa description, ses arguments ni ses options :

```json
{
  "path": "user key create",
  "kind": "app",
  "capability": "users.manage",
  "alsoRequires": [],
  "destructive": false
}
```

`capability` est la permission dont le compte a besoin. `alsoRequires` liste les autres permissions qu'il lui faut aussi. `destructive` vaut true quand la commande supprime des données stockées, les écrase sans retour possible, ou coupe un accès, comme une révocation. Cela concerne les données stockées dans OpenLDR, pas les fichiers de votre propre disque.

## Commandes de récupération

Dix commandes travaillent sur la base de données elle-même et ne demandent aucune connexion. Elles servent à mettre en place une installation et à retrouver l'accès quand plus personne ne peut se connecter.

| Commande | À quoi elle sert |
| --- | --- |
| `auth rebind-issuer` | Lier la base de données à l'adresse déplacée d'un fournisseur d'identité. |
| `auth setup-code` | Afficher un code pour créer le premier administrateur. |
| `db migrate` | Mettre à jour le schéma de la base de données. |
| `db reset` | Supprimer et recréer le schéma. |
| `db seed` | Ajouter les définitions par défaut. |
| `doctor` | Lancer les contrôles de configuration. |
| `health` | Vérifier les services. |
| `storage copy` | Copier des fichiers depuis un autre stockage S3. |
| `target-store test` | Vérifier la connexion à la base d'analyse. |
| `user reset-password` | Définir un mot de passe temporaire, pour un administrateur bloqué. |

Lancez-les sur la machine qui fait tourner OpenLDR, là où se trouvent les réglages de base de données :

- Installation Docker : `./openldr` dans le dossier d'installation. Il les lance dans le conteneur `api`.
- Installation autonome : `openldr-standalone cli`. Voir [Exécuter sans Docker](/docs/standalone).
- Copie du code source : `pnpm openldr`, qui lit le `.env` de la copie.

Ailleurs, une commande de récupération s'arrête avant de faire quoi que ce soit :

```text
This command works on the database itself. Run it on the machine that runs OpenLDR.
```

## Se connecter comme personne

Cela fonctionne sur les installations qui utilisent la connexion propre à OpenLDR (`AUTH_ADAPTER=local`). Sur une installation Keycloak ou OIDC, utilisez plutôt une clé d'accès. Là, `openldr login` répond `This install signs in through another service. Use an access key: set OPENLDR_KEY.`

```sh
openldr login
```

Le CLI demande votre nom d'utilisateur, puis votre mot de passe. Il n'affiche pas le mot de passe pendant la saisie. Puis il affiche :

```text
Signed in to http://localhost:3991 as admin.
```

Vérifiez sous quel compte vous êtes connecté :

```sh
openldr whoami
```

```text
Username: admin
Roles: lab_admin
Signed in with: session
```

`openldr whoami --json` affiche la même chose sur une ligne JSON.

Un script ne peut pas taper à une invite. Il passe le mot de passe sur l'entrée standard avec `--password-stdin`, qui demande `--username` :

```sh
openldr login --username admin --password-stdin < password.txt
```

Il n'y a pas d'option `--password`, car les autres utilisateurs de la machine peuvent lire les lignes de commande.

`openldr logout` termine la session sur le serveur et la retire de votre machine.

La session est gardée dans un fichier que vous seul pouvez lire :

| Ordinateur | Fichier de session |
| --- | --- |
| Linux | `~/.config/openldr/session.json`, ou `$XDG_CONFIG_HOME/openldr/session.json` |
| macOS, non testé | `~/Library/Application Support/OpenLDR/session.json` |
| Windows, non testé | `%APPDATA%\OpenLDR\session.json` |

Sous Linux, le dossier est en mode 700 et le fichier en mode 600. Le CLI refuse un fichier de session que d'autres utilisateurs peuvent lire. Le fichier ne contient jamais votre mot de passe.

Une session prend fin après 12 heures sans usage, ou 7 jours après la connexion. Connectez-vous alors de nouveau.

Une session appartient à une seule adresse de serveur. `http://localhost:3000` et `http://127.0.0.1:3000` sont deux adresses, donc une session ouverte sur l'une ne sert pas pour l'autre.

## Clés d'accès

Une clé d'accès permet à un programme d'agir au nom d'un compte, sans personne présente. Elle commence par `oldr_`. Gardez-la comme un mot de passe.

Il faut la permission `users.manage` pour créer, lister ou révoquer des clés. Vous pouvez le faire dans Studio, sous **Utilisateurs**, dans le menu de la ligne du compte. Voir **Utilisateurs** dans la documentation de Studio. Vous pouvez aussi le faire avec le CLI :

```sh
openldr user key create ai-reader --name claude-test --expires 2026-12-31
```

La clé est affichée une seule fois, seule sur la sortie standard. Un avis va sur la sortie d'erreur :

```text
oldr_<the new key>
made key 6afa1ead-1382-4cd1-a07e-d233c907fa2b (claude-test) for ai-reader. It cannot be shown again, so store it now.
```

Un script peut donc garder la clé dans un fichier sans jamais l'afficher :

```sh
openldr user key create ai-reader --name claude-test > ai-reader.key
chmod 600 ai-reader.key
```

`--expires` prend une date, ou une date-heure ISO qui se termine par `Z` ou par un décalage. Une date seule, comme `2026-12-31`, désigne la fin de ce jour en UTC. Dans Studio, une date choisie désigne la fin de ce jour dans le fuseau horaire de votre navigateur. Sans expiration, la clé fonctionne jusqu'à sa révocation.

Listez les clés d'un compte. La clé elle-même n'est plus jamais affichée, seulement ses premiers caractères :

```sh
openldr user key list ai-reader
```

```text
6afa1ead-1382-4cd1-a07e-d233c907fa2b	claude-test	oldr_rutK97w	2026-11-13T09:16:46.097Z	2026-12-31T23:59:59.999Z	2026-11-13T09:16:49.894Z	-
```

Les colonnes sont l'identifiant de la clé, le nom, les premiers caractères, la date de création, la date d'expiration, la dernière utilisation et la date de révocation.

La « dernière utilisation » change quand un programme présente la clé, au plus une fois par minute. Elle change même quand le serveur refuse ensuite l'appel parce que le compte est désactivé.

Révoquez une clé avec son identifiant. Sans `--force`, la commande refuse et dit ce qui se passerait :

```sh
openldr user key revoke ai-reader 6afa1ead-1382-4cd1-a07e-d233c907fa2b --force
```

```text
revoked key 6afa1ead-1382-4cd1-a07e-d233c907fa2b for ai-reader
```

Un programme qui utilise la clé est refusé dès son appel suivant. Une révocation est définitive. Créez plutôt une nouvelle clé.

## Donner accès à un agent IA

Donnez à un agent IA, ou à tout script, son propre compte et sa propre clé. Vous voyez alors ce qu'il a fait, et vous pouvez lui couper l'accès sans toucher à personne d'autre.

1. Créez un compte sans mot de passe, pour que personne ne puisse se connecter à Studio avec, et donnez-lui le rôle le plus restreint qui suffit au travail :

   ```sh
   openldr user create --username ai-reader --name "AI reader" --role data_analyst --no-password
   ```

   ```text
   created ai-reader (50b32c3a-13a3-438e-a2f6-4eb0afbaf719)
   ai-reader has no password and cannot sign in to Studio.
   ```

   `--no-password` sert pour la connexion propre à OpenLDR. Pour Keycloak ou OIDC, voir cette section plus bas. Si aucun rôle ne convient, créez-en un sur la page **Rôles** avec seulement les permissions dont l'agent a besoin.

2. Créez-lui une clé, dans Studio ou avec `openldr user key create`. Donnez-lui une date d'expiration.

3. Donnez à l'agent la clé et l'adresse du serveur. Mettez la clé dans un fichier que seul l'utilisateur de l'agent peut lire, et faites pointer `OPENLDR_KEY_FILE` dessus. Définissez `OPENLDR_URL` quand le serveur n'est pas sur la même machine.

4. Laissez l'agent vérifier son accès. Ces commandes peuvent être lancées en premier sans risque :

   ```sh
   openldr whoami
   openldr commands --json
   ```

   ```text
   Username: ai-reader
   Roles: data_analyst
   Signed in with: key (claude-test)
   ```

5. Révoquez la clé quand le travail est fini.

Ce que l'agent peut faire avec la clé :

- Lancer les commandes que les permissions de son rôle autorisent, et rien d'autre. Toute autre commande répond `This account lacks the capability <name>.`
- Lister chaque commande, sa sorte et la permission qu'elle demande, avec `openldr commands --json`.

Ce qu'il ne peut pas faire :

- Lancer une commande de récupération. Celles-ci demandent les réglages de base de données, pas une clé.
- Inscrire son travail sous un autre nom. `--actor` et `--approved-by` sont refusés.
- Cacher ce qu'il a lancé. Chaque commande qu'il lance est dans le journal d'audit, avec le compte, le nom de la clé et la commande. Les arguments ne sont pas enregistrés.

## Quel serveur et quel identifiant

Le CLI envoie une commande à cette adresse, dans cet ordre :

1. `--server-url <address>`, avant ou après la commande.
2. `OPENLDR_URL`.
3. `http://127.0.0.1:3000`.

Il se connecte avec le premier de ces éléments qui est défini :

1. `OPENLDR_KEY`, la clé elle-même.
2. `OPENLDR_KEY_FILE`, un fichier qui contient la clé.
3. La session de `openldr login`.
4. Rien. Une commande `app` répond alors `Sign in first: openldr login, or set OPENLDR_KEY.`

Il n'y a pas d'option `--key`, car les autres utilisateurs peuvent lire les lignes de commande. Une variable de clé définie mais vide arrête la commande. Le CLI ne se rabat pas sur votre session :

```text
OPENLDR_KEY is set but empty. Set it, or unset it.
```

Le CLI refuse d'envoyer une commande en HTTP simple vers une autre machine. Le HTTP simple vers `localhost`, `127.0.0.1` ou `[::1]` est permis :

```text
Refusing to send a credential over plain HTTP to 10.0.0.5. Use https, or set OPENLDR_ALLOW_PLAIN_HTTP=true.
```

Utilisez `https`. Ne définissez `OPENLDR_ALLOW_PLAIN_HTTP=true` que sur un réseau de confiance, comme Tailscale. Le refus vaut aussi pour une commande sans clé, car les arguments et les fichiers envoyés peuvent contenir des données de patients.

| Réglage | Ce qu'il fait |
| --- | --- |
| `OPENLDR_URL` | L'adresse du serveur. |
| `OPENLDR_KEY` | Une clé d'accès. |
| `OPENLDR_KEY_FILE` | Un fichier qui contient une clé d'accès. Le fichier est lu sur la machine où vous tapez la commande. |
| `OPENLDR_ALLOW_PLAIN_HTTP` | `true` ou `1` permet le HTTP simple vers une autre machine. |

## Ce qui change en passant par l'application

Ces usages fonctionnaient avant et donnent maintenant une erreur. Un script peut les rencontrer.

- `--actor` et `--approved-by` sont refusés : `--actor cannot be used through the app. The signed-in account is recorded.` Le journal d'audit enregistre le compte connecté.
- `audit list --actor <id>` ne peut pas être utilisé. Le CLI lit ce `--actor` comme celui qui est refusé. C'est un défaut connu. Filtrez plutôt la sortie de `audit list --json` avec votre propre outil.
- `sync export` demande `--out <file>`. `report run --format pdf` aussi.
- Le client et le serveur doivent être de la même version : `This client is version 0.0.1 and OpenLDR is version 0.1.11. Use the same release on both.`
- Un fichier que vous nommez est envoyé au serveur, et un fichier que la commande écrit vous revient. Les chemins sont donc des chemins de votre machine. Sur une installation Docker, ils restent dans le conteneur. Gardez-les sous `data/` comme avant.
- Un dossier que vous nommez est envoyé avec tout son contenu. Un lien vers un dossier à l'intérieur arrête la commande : `<path> is a link to a folder. A link to a folder is not sent.` Un lien vers un fichier n'est suivi que si le fichier est dans le dossier. Un dossier vide à l'intérieur n'est pas envoyé.
- Un fichier qui change pendant son envoi arrête la commande. Envoyez-le de nouveau.
- Un programme qui lance le CLI et ne lit rien de sa sortie pendant 5 minutes perd la commande. Le serveur l'arrête.
- Ctrl+C arrête aussi la commande sur le serveur. Une commande qui ne s'arrête pas est tuée après 10 secondes. Cela n'a pas été testé à la main.

## Qui peut lancer quoi

Une commande demande la permission que demande l'action correspondante dans Studio. `openldr commands --json` l'indique pour chaque commande. Trois cas surprennent :

- `patients list`, `patients show` et `patients duplicates list` demandent `patients.view_identifiers`. Un analyste ou un auditeur qui voit les patients masqués dans Studio ne peut pas lister les patients depuis le CLI, même sans `--identifiers`.
- `import start` et `import resume` demandent à la fois `connectors.manage` et `ingest.run`. Studio ne laisse lancer les importations qu'au rôle d'administrateur du laboratoire, par son nom. Le CLI vérifie plutôt ces deux permissions. Il ne vérifie pas les rôles requis propres à un plugin.
- `import status` et `import failures` peuvent afficher une clé de ligne du système source. Cette clé peut être un numéro de laboratoire.

## Le journal d'audit

Chaque commande lancée par l'application laisse une ligne `cli.run`. Elle contient le compte, la commande, le code de sortie, et le fait qu'elle est passée par le CLI. Quand une clé a servi, elle contient aussi le nom de la clé. Les arguments de la commande ne sont jamais enregistrés.

```sh
openldr audit list --action cli.run --json
```

Une ligne, sans ses identifiants ni son heure :

```json
{
  "actorType": "user",
  "actorName": "ai-reader",
  "action": "cli.run",
  "entityType": "cli_command",
  "entityId": "report list",
  "metadata": {
    "origin": { "via": "cli", "keyName": "claude-test" },
    "exitCode": 0,
    "interrupted": false
  }
}
```

Une commande qui modifie quelque chose, comme `user create`, écrit aussi sa propre ligne d'audit comme avant. Cette ligne nomme maintenant le compte connecté. Créer et révoquer une clé écrivent `access_key.create` et `access_key.revoke`. La clé elle-même n'est jamais dans le journal d'audit.

## Limites fixées par le serveur

| Réglage | Par défaut | Ce qu'il fait |
| --- | --- | --- |
| `CLI_MAX_RUNNING` | `2` | Nombre de commandes qui tournent en même temps. Les autres attendent jusqu'à 30 secondes, puis reçoivent `OpenLDR is running other commands. Try again shortly.` |
| `CLI_MAX_UPLOAD_BYTES` | `2147483648` (2 Gio) | Nombre maximal d'octets de fichiers qu'une commande peut envoyer. |
| `CLI_ENTRY` | trouvé à côté du serveur | Le fichier du CLI que le serveur lance. Ne le définissez que si le CLI se trouve ailleurs. |

Le serveur écrit les envois sous `TERMINOLOGY_WORK_DIR`, ou dans le dossier temporaire du système quand ce réglage est vide. La plupart des envois sont supprimés à la fin de la commande. `terminology ontology build` garde son dossier, pour que `terminology ontology rebuild` puisse le relire. Chaque construction réussie laisse une copie de plus.

Sur une installation Docker, si vous utilisez `terminology ontology build` par l'application, faites pointer `TERMINOLOGY_WORK_DIR` vers un dossier qui survit à la recréation du conteneur. Sinon `terminology ontology rebuild` échoue après une mise à niveau. Le dossier doit être sur un volume Docker ou un montage, et l'utilisateur du conteneur `api` doit pouvoir y écrire. Cela n'a pas été testé.

[Variables d'environnement](/docs/environment) liste tous les réglages.

## Installations Docker

Le script `./openldr` du dossier d'installation lance le CLI dans le conteneur `api`. Le CLI y parle au serveur du même conteneur, donc vous ne définissez aucune adresse.

- `OPENLDR_KEY`, quand il est défini, est transmis à chaque appel.
- `OPENLDR_KEY_FILE` est lu sur l'hôte, pas dans le conteneur. Faites-le pointer vers un fichier de l'hôte.
- `./openldr login` demande le mot de passe sur l'hôte. Il garde la session dans un fichier propre à ce dossier d'installation, sous `~/.config/openldr/docker/`. Rien n'est stocké dans le conteneur.
- Renommer ou déplacer le dossier d'installation vous déconnecte du script. Connectez-vous de nouveau.
- Un lien vers `./openldr` depuis un autre dossier, par exemple un dossier de votre `PATH`, fonctionne. Il lance l'installation vers laquelle il pointe, avec la session de cette installation. Une simple copie du script dans un autre dossier s'arrête avec `This script must stay in its install folder, or be a link to it. <folder> has no docker-compose.yml.`
- Un `OPENLDR_KEY_FILE` incorrect, ou une session enregistrée que le script ne peut pas utiliser, arrête toutes les commandes, y compris les commandes de récupération. Le message nomme le réglage ou le fichier. Retirez le réglage, ou supprimez le fichier et connectez-vous de nouveau.
- Sous Windows, `.\openldr.ps1` se connecte uniquement avec une clé. Définissez `OPENLDR_KEY`. `login` et `OPENLDR_KEY_FILE` y sont refusés. Ce n'est pas prouvé : rien n'a été lancé sous Windows.

Une installation faite avant ce changement a l'ancien script. Avec lui, chaque commande qui passe par l'application répond `Sign in first`. Remplacez le script une fois les images passées à la nouvelle version. [Mises à niveau planifiées](/docs/upgrading) donne la commande.

## Exécuter sans Docker

`openldr-standalone cli` dirige le CLI vers l'adresse du lanceur lui-même, sauf si vous définissez `OPENLDR_URL` ou passez `--server-url`. Il ne donne les réglages de base de données qu'à une commande de récupération. Toute autre commande passe par le serveur en marche, donc connectez-vous d'abord :

```sh
pnpm openldr-standalone cli -- login
pnpm openldr-standalone cli -- whoami
```

Un lanceur démarré avec `--host` sur une autre adresse reste cet ordinateur, donc le HTTP simple vers lui est permis pour ces appels. [Exécuter sans Docker](/docs/standalone) donne la suite.

## Installations Keycloak et OIDC

`openldr login` ne fonctionne pas ici. Utilisez des clés d'accès. Les clés sur ces installations n'ont pas été testées avec un vrai fournisseur d'identité.

- Créez le compte de l'IA dans Studio, ou dans le fournisseur d'identité. Donnez-lui ses rôles dans Studio. Les rôles définis seulement dans Keycloak n'atteignent OpenLDR que lorsque la personne se connecte avec un jeton, et un compte qui n'utilise qu'une clé ne le fait jamais.
- Studio peut créer une clé pour un compte qui ne s'est jamais connecté. Le CLI ne le peut pas. `openldr user key create` ne trouve que les comptes qu'OpenLDR connaît déjà.
- Désactiver un compte seulement dans la console du fournisseur d'identité n'arrête pas ses clés. Désactivez-le dans Studio ou avec `openldr user deactivate`, ou révoquez la clé.

## Ce que cela ne protège pas

La connexion et les permissions limitent une personne ou un programme qui ne détient qu'une clé ou une session. Elles ne limitent pas ceci :

- Sur un hôte Docker, quiconque peut lancer `docker compose exec` atteint déjà la base de données.
- Quiconque détient les réglages de base de données peut lancer le CLI comme le fait le serveur, sans connexion.
- Avec `AUTH_DEV_BYPASS=true`, quiconque atteint le port peut lancer n'importe quelle commande. Ne l'utilisez que sur une machine de développement isolée.

## Messages possibles

| Message | Ce qu'il veut dire |
| --- | --- |
| `Sign in first: openldr login, or set OPENLDR_KEY.` | Aucun identifiant n'a été trouvé, ou la clé est fausse, révoquée ou expirée, ou la session a pris fin. Les mêmes mots s'affichent quand une clé est définie mais ne fonctionne plus. |
| `This account lacks the capability <name>.` | Les rôles du compte n'incluent pas cette permission. |
| `account disabled` | Le compte derrière la clé ou la session est désactivé. |
| `This client is version <a> and OpenLDR is version <b>. Use the same release on both.` | Mettez à jour le CLI ou le serveur pour qu'ils soient de la même version. |
| `OpenLDR is running other commands. Try again shortly.` | `CLI_MAX_RUNNING` commandes tournent déjà. |
| `This command works on the database itself. Run it on the machine that runs OpenLDR.` | Une commande de récupération a été lancée là où il n'y a pas de réglages de base de données. |
| `Refusing to send a credential over plain HTTP to <host>. ...` | Utilisez https, ou définissez `OPENLDR_ALLOW_PLAIN_HTTP=true` sur un réseau de confiance. |
| `The key file named by OPENLDR_KEY_FILE cannot be read: <file>` | Vérifiez le chemin et le propriétaire du fichier. |
| `--actor cannot be used through the app. The signed-in account is recorded.` | Retirez `--actor`. |
| `Through the app, sync export needs --out <file>.` | Ajoutez `--out`. |

## Guides liés

- [Référence du CLI](/docs/cli)
- [Mises à niveau planifiées](/docs/upgrading)
- [Exécuter sans Docker](/docs/standalone)
- [Fournisseurs d'authentification](/docs/auth-providers)
- [Variables d'environnement](/docs/environment)
