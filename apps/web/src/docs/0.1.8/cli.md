# Command-line interface (CLI)

OpenLDR ships an operator command-line interface (CLI), `openldr`, for database,
terminology, ingest, plugin,
reporting, user, and marketplace tasks — everything you can do from the app, plus
lower-level operations.

## Running it

**On an installed stack**, the installer puts an `openldr` wrapper in your install directory.
Run it from there:

```
./openldr <command>
./openldr --help           # list every command group
./openldr db --help        # drill into a group
```

On Windows, use `.\openldr.ps1` instead.

The wrapper runs the CLI inside the `api` container. That has one consequence worth knowing:
**commands that read or write files only see the `data` directory.** Put a file in `./data`
next to the wrapper and name it with the `data/` prefix:

```
./openldr ingest data/bundle.json
./openldr sync export --out data/export.ndjson
```

A path outside `data/` will not be found. An `--out` path outside it now usually fails with a
permission error, rather than writing into the container and disappearing on restart.

The wrapper runs as the user who invokes it, so that user must be able to write to `./data`.
If the install ran under `sudo`, `./data` ends up owned by root, and a later non-root
`./openldr sync export --out data/x.ndjson` fails with `EACCES`. Fix it by changing the
directory's owner to the invoking user, or by running the wrapper as the user that owns it.

An operator without `docker` group access must run `sudo ./openldr`, which makes the container
process root. Root can write anywhere in the container, so an unprefixed `--out` then writes
silently and is lost on restart — the exact failure the `data/` rule exists to prevent. Always
prefix output paths with `data/`.

**From a source checkout**, run it through the workspace instead:

```
pnpm openldr <command>
```

Most read commands accept `--json` for machine-readable output. In a deployed stack the
common lifecycle steps (schema migration and seeding) run automatically on startup, and
admin/danger actions are also available in the Studio UI under Settings.

## Command groups

| Group | What it does |
| --- | --- |
| `health` | Report service health (auth, storage, eventing, target store). |
| `db` | `migrate`, `reset`, `seed` the database; `reproject` the warehouse read model. |
| `settings` | Feature `flags list` / `flags set`, `danger <action>`, and `sync show` / `sync set` (lab⇄central sync config). |
| `terminology` | Import and query CodeSystems, ValueSets, ConceptMaps, ontologies. |
| `fhir` | Validate FHIR R4 resources. |
| `forms` | List form definitions; extract answers from a QuestionnaireResponse. |
| `ingest` | Ingest a file through the pipeline (optionally via a plugin). |
| `facilities` | Import a national facility register: `suggest-map`, `suggest-values`, `import` (column and value mapping — see [Facilities](/docs/facilities)). |
| `pipeline` | Inspect ingest batches: `status`, `retry`, `logs`. |
| `queue` | Inspect the event queue. |
| `provenance` | Provenance audit tooling. |
| `plugin` | Manage WASM ingest plugins: `install`, `list`, `test`, `run`, `remove`. |
| `report` | `list` and `run` analytics reports; `glass-export`. |
| `audit` | Read the append-only audit log. |
| `user` | Manage users: `list`, `show`, `create`, `set-role`, `activate`, `deactivate`. Status changes also update linked provider accounts. `export` is a top-level dataset command. |
| `market` | Marketplace artifacts: `verify`, `install`, `update`, `list`, `rollback`, `enable`, `disable`, `remove`. |
| `artifact` | Author artifacts: `keygen`, `new`, `build`, `pack`, `sign`, `test`, `publish`. |
| `sync` | Distributed (lab⇄central) sync: `status`, `now`, and central-side `enroll`, `list`, `rotate`, `revoke`. |
| `errors` | List the error-code catalog. |
| `update` | `check` whether a newer OpenLDR version has been published (exit 0 = up to date, 1 = an update is available, 2 = the check failed). |
| `target-store` | Test the target warehouse connection. |

Mutating CLI commands (`sync enroll/rotate/revoke`, `user create/set-role/activate/deactivate`,
`settings … set`, `settings danger …`, `db reset`, `db reproject`, `terminology import/create`) record an audit
event with actor type **`cli`** and actor name looked up **inside the container**, not the
operator's own username. On a Docker install that name follows the host uid running the
wrapper: uid 1000 resolves to `node`, and most other uids have no container username at all,
so the fallback `cli` is recorded instead. Use the global `--actor <name>` to record the
operator's real name. They appear on the Audit page alongside UI actions.

## Common tasks

Bring a database up to date after pulling new migrations (non-destructive, keeps data):

```
./openldr db migrate
```

Reset and seed a development database (`db reset` **drops and recreates** the schema):

```
./openldr db reset
./openldr db seed
```

`db seed` refuses to run when migrations are pending, naming what is outstanding — run
`db migrate` first.

Rebuild the warehouse read model from the canonical FHIR store (`db reproject` **rewrites every
projected row**, so it refuses without `--force`):

```
./openldr db reproject --force
```

It prints two separate counts: the canonical resources it rewrote, and the arrivals it recorded in
the ingest ledger (one per version of a clinical resource — they are different units, not the same
number). Like `db seed`, it refuses when migrations are pending rather than running to completion
against a schema that is behind. Use it to backfill after an upgrade adds a warehouse table.

`terminology reproject` is **deprecated** — it has always called the same whole-read-model rebuild,
never a terminology-only one. It still works as an alias, it now prints a deprecation warning, and
it inherits the `--force` guard. Use `db reproject` instead.

Install and run an ingest plugin, then ingest a file with it:

```
./openldr plugin install data/plugin.wasm
./openldr ingest data/results.sqlite --plugin whonet-sqlite
```

Create a local user and assign roles:

```
./openldr user create --username alice --name "Alice" --email alice@example.org --role lab_technician
./openldr user set-role <id> lab_admin
```

Toggle a feature flag:

```
./openldr settings flags list
./openldr settings flags set dashboard.raw_sql true
```

Run a report:

```
./openldr report list
./openldr report run <id>

# PDF in the design's own text, then in French
./openldr report run <id> --format pdf --out report.pdf
./openldr report run <id> --format pdf --lang fr --out rapport.pdf
```

`--lang` prints the translations stored on the design, including the dates. The built-in reports
ship with French and Portuguese, so this works on them with no setup. Text with no translation for
that language prints as authored, and data is never translated.

Enroll a lab on the central server, then connect a lab to it:

```
# On central: mint the lab's client + secret (printed once)
./openldr sync enroll lab-site-01 --central-url https://central.example.org

# On the lab: apply the credentials, then check status
./openldr settings sync set clientId sync-lab-site-01
./openldr settings sync set mode bidirectional
./openldr settings sync set enabled true
./openldr sync status
```

> Distributed sync links labs to a central server: operational data pushes up to a
> read-only mirror, reference config and terminology pull down. Enrollment mints a
> per-lab Keycloak client and needs the central realm's admin service account to hold
> `manage-clients`/`view-clients`.

> Anything under `settings danger` is destructive (reset dashboards, clear audit,
> factory reset). Those commands require `--force` and mirror the Studio danger zone.

## Projection retries

The projection worker saves failed resource writes and arrival-ledger writes for automatic retry.
Retries survive a restart and reread the current canonical resource, including deletions.
A cycle retries at most 100 queued resources, then handles new changes.
Repeated failures wait 1, 2, 4 seconds and so on, up to five minutes.
Retries continue until successful; a failing resource does not hold later valid changes.
A new change to that resource can trigger an attempt before the delay expires.
If saving a retry fails, the worker leaves its cursor unchanged.
Successful projection clears the retry. Ancillary capture-hook errors are logged without scheduling retries.
No operator action is required after a temporary outage clears.
For a deliberate full rebuild, use `openldr db reproject --force`.

## Nouvelles tentatives de projection

Le service conserve les écritures échouées des ressources et du registre pour les réessayer automatiquement.
Ces tentatives survivent au redémarrage et relisent la ressource canonique actuelle, suppressions comprises.
Chaque cycle reprend au maximum 100 ressources en attente, puis traite les nouveaux changements.
Les échecs répétés attendent 1, 2, 4 secondes, puis davantage, jusqu'à cinq minutes.
Les tentatives continuent jusqu'au succès. Une ressource en échec ne bloque pas les changements valides suivants.
Un nouveau changement de cette ressource peut déclencher une tentative avant la fin du délai.
Si l'enregistrement d'une tentative échoue, le service conserve son curseur.
Le succès supprime la tentative en attente. Les erreurs de capture auxiliaire sont journalisées sans nouvelle tentative.
Après une panne temporaire, aucune intervention n'est nécessaire.
Pour reconstruire toutes les tables de lecture, utilisez `openldr db reproject --force`.



## Novas tentativas de projeção

O serviço guarda escritas falhadas de recursos e do registo para tentar novamente de forma automática.
As tentativas sobrevivem ao reinício e releem o recurso canónico atual, incluindo eliminações.
Cada ciclo repete no máximo 100 recursos pendentes e depois trata as novas alterações.
As falhas repetidas aguardam 1, 2, 4 segundos e assim por diante, até cinco minutos.
As tentativas continuam até terem sucesso. Um recurso com falha não bloqueia as alterações válidas seguintes.
Uma nova alteração desse recurso pode iniciar uma tentativa antes do fim da espera.
Se não conseguir guardar uma tentativa, o serviço mantém o cursor.
O sucesso remove a tentativa pendente. Os erros de captura auxiliar ficam nos registos, sem nova tentativa.
Após uma falha temporária, não é necessária intervenção.
Para reconstruir todas as tabelas de leitura, use `openldr db reproject --force`.
## Disable or enable access

Open the account row's **Actions** menu to disable or enable it. Disabling writes the local access block before updating the identity provider. The next authenticated API request returns `403 account disabled`, including requests with an already-issued token. A screen already loaded in the browser may remain visible.

Accounts that have never signed in also receive a local block. Enabling updates the provider first, then lifts that block. If either write fails, the action reports an error. A failed disable can leave the provider enabled while OpenLDR blocks access. A failed enable can leave the provider enabled while the local block remains. Restore the failing connection and retry the same action. Audit records use `user.status.failed` for failures and `user.status` for success.

For the CLI, use `openldr user deactivate <local-id>` or `openldr user activate <local-id>`. Find the local ID with `openldr users list`. Linked accounts update both systems using their provider subject. Accounts created only in the local store change locally. CLI status audit records identify the actor as `cli`.

If another status change is in progress for this account, the API returns `409`. Wait for that action to finish, then retry. This also applies when Studio and the CLI change the same account.

## Désactiver ou réactiver un compte

Ouvrez le menu **Actions** de la ligne du compte pour le désactiver ou le réactiver. La désactivation bloque d'abord l'accès local, puis met à jour le fournisseur d'identité. La prochaine requête API authentifiée reçoit `403 account disabled`, même avec un jeton déjà émis. Une page déjà chargée peut rester visible.

Le blocage couvre aussi les comptes qui ne se sont jamais connectés. La réactivation met d'abord à jour le fournisseur, puis lève le blocage local. Si une écriture échoue, l'action affiche une erreur. Le fournisseur peut alors autoriser le compte tandis qu'OpenLDR maintient le blocage. Rétablissez la connexion défaillante et répétez la même action. L'audit enregistre `user.status.failed` en cas d'échec et `user.status` en cas de réussite.

Dans la CLI, utilisez `openldr user deactivate <local-id>` ou `openldr user activate <local-id>`. Trouvez l'identifiant local avec `openldr users list`. Les comptes liés modifient les deux systèmes à partir de leur identifiant fournisseur. Les comptes uniquement locaux changent seulement dans OpenLDR. L'audit des changements CLI indique l'acteur `cli`.

Si une autre modification du statut de ce compte est en cours, l'API renvoie `409`. Attendez la fin de cette action, puis réessayez. Cela s'applique aussi aux modifications simultanées depuis Studio et la CLI.

## Desativar ou reativar uma conta

Abra o menu **Ações** da linha da conta para a desativar ou reativar. A desativação bloqueia primeiro o acesso local e depois atualiza o fornecedor de identidade. O pedido autenticado seguinte à API recebe `403 account disabled`, mesmo com um token já emitido. Uma página já carregada pode continuar visível.

O bloqueio também abrange contas que nunca iniciaram sessão. A reativação atualiza primeiro o fornecedor e depois remove o bloqueio local. Se uma escrita falhar, a ação apresenta um erro. O fornecedor pode permitir o acesso enquanto o OpenLDR mantém o bloqueio. Restabeleça a ligação que falhou e repita a mesma ação. A auditoria regista `user.status.failed` em caso de falha e `user.status` em caso de sucesso.

Na CLI, use `openldr user deactivate <local-id>` ou `openldr user activate <local-id>`. Consulte o identificador local com `openldr users list`. As contas ligadas atualizam ambos os sistemas através do identificador do fornecedor. As contas apenas locais mudam só no OpenLDR. A auditoria destas alterações na CLI identifica o ator como `cli`.

Se outra alteração do estado desta conta estiver em curso, a API devolve `409`. Aguarde o fim dessa ação e tente novamente. Isto também se aplica a alterações simultâneas no Studio e na CLI.

## User directory paging

### English

Users starts with active accounts. Search matches provider usernames, names, and email addresses across the directory. Select All statuses to include disabled accounts. Changing search, status, or page size returns to the first page.

Use Next to reach accounts beyond the first 100. Each request returns at most 100 accounts. The footer shows the visible range without claiming a total. Columns remain configurable. Arbitrary column filters and sorting are unavailable because the provider does not support them. The provider controls order. Accounts added or removed between requests can shift pages.

For headless access, run:

```sh
openldr user directory-list --offset 100 --limit 25 --search Ada --enabled true --json
```

The JSON contains `rows`, `offset`, `limit`, `total: null`, and `hasMore`. Add `limit` to `offset` while `hasMore` is true. Omit `--enabled` to include both statuses. `openldr user list` still lists local accounts.

When provider administration is unconfigured, directory listing uses local accounts. Local search matches username, display name, and email as substrings. Local results use username and ID order. Provider search follows the identity provider's search rules.

### Français

La page Utilisateurs affiche les comptes actifs au départ. La recherche porte sur les identifiants, noms et adresses e-mail de tout l'annuaire du fournisseur. Choisissez Tous les statuts pour inclure les comptes désactivés. Changer la recherche, le statut ou la taille de page revient à la première page.

Utilisez Suivant pour atteindre les comptes au-delà des 100 premiers. Chaque requête retourne au plus 100 comptes. Le pied de page indique la plage visible sans annoncer de total. Les colonnes restent configurables. Les filtres de colonnes et le tri libre sont indisponibles car le fournisseur ne les prend pas en charge. Le fournisseur contrôle l'ordre. Ajouter ou supprimer un compte entre deux requêtes peut décaler les pages.

Depuis la ligne de commande :

```sh
openldr user directory-list --offset 100 --limit 25 --search Ada --enabled true --json
```

Le JSON contient `rows`, `offset`, `limit`, `total: null` et `hasMore`. Ajoutez `limit` à `offset` tant que `hasMore` vaut true. Omettez `--enabled` pour inclure les deux statuts. `openldr user list` conserve la liste des comptes locaux.

Si l'administration du fournisseur n'est pas configurée, la liste utilise les comptes locaux. La recherche locale trouve les fragments dans l'identifiant, le nom et l'e-mail. Les résultats locaux suivent l'ordre identifiant puis ID. La recherche du fournisseur suit ses propres règles.

### Português

A página Utilizadores começa com as contas ativas. A pesquisa abrange os nomes de utilizador, nomes e e-mails de todo o diretório do fornecedor. Selecione Todos os estados para incluir contas desativadas. Alterar a pesquisa, o estado ou o tamanho da página volta à primeira página.

Use Seguinte para alcançar contas após as primeiras 100. Cada pedido devolve até 100 contas. O rodapé mostra o intervalo visível sem indicar um total. As colunas continuam configuráveis. Os filtros de colunas e a ordenação livre estão indisponíveis porque o fornecedor não os suporta. O fornecedor controla a ordem. Adicionar ou remover contas entre pedidos pode deslocar as páginas.

Na linha de comandos:

```sh
openldr user directory-list --offset 100 --limit 25 --search Ada --enabled true --json
```

O JSON contém `rows`, `offset`, `limit`, `total: null` e `hasMore`. Some `limit` a `offset` enquanto `hasMore` for true. Omita `--enabled` para incluir ambos os estados. `openldr user list` mantém a lista de contas locais.

Sem administração do fornecedor configurada, a listagem usa contas locais. A pesquisa local procura fragmentos no nome de utilizador, nome e e-mail. Os resultados locais seguem a ordem nome de utilizador e ID. A pesquisa do fornecedor segue as regras desse fornecedor.
