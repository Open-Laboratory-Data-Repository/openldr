# Tables et fonctions hôtes des plugins

Le code serveur d'un plugin peut garder ses propres enregistrements, lire certains enregistrements de CE et envoyer des enregistrements FHIR dans CE. Il le fait par quatre fonctions hôtes : `db_select`, `db_write`, `ce_read` et `fhir_emit`. Un plugin n'envoie jamais de SQL. Il envoie une requête JSON, que CE vérifie avant de construire l'instruction.

Cette page s'adresse à la personne qui écrit le plugin. L'administrateur voit les capacités sur l'écran d'installation et les approuve là.

## Capacités

Chaque fonction hôte n'existe que si le manifeste du plugin demande sa capacité. Un plugin sans la capacité n'a pas la fonction.

| Fonction hôte | Capacité nécessaire |
|---|---|
| `db_select`, `db_write` | `host:db` |
| `ce_read` | `host:ce-read` |
| `fhir_emit` | `emit-fhir` et `host:db` |

La capacité `emit-fhir` liste les types d'enregistrement que le plugin peut envoyer, par exemple `{ "kind": "emit-fhir", "resourceTypes": ["Observation"] }`.

Un module wasm qui importe une fonction hôte ne se charge pas là où CE ne la fournit pas. N'importez donc que les fonctions que vos capacités donnent.

Les fonctions hôtes ne tournent que sur un thread de travail (worker). Un serveur lancé avec un chargeur comme `tsx` ne peut pas en démarrer. Là, l'appel échoue avec un message qui le dit, et le plugin ne tourne pas sans ses fonctions.

Chaque appel a besoin d'une personne connectée. CE transmet cette personne aux fonctions hôtes depuis sa propre session. Le plugin ne peut ni la choisir ni la changer.

## Tables déclarées

Un plugin liste ses tables dans `payload.tables` de son manifeste signé. Les tables demandent `host:db`. CE les crée à l'installation, dans un schéma propre au plugin, `plugin_<id>`. Un plugin n'atteint aucune autre table.

```json
{
  "name": "samples",
  "columns": [
    { "name": "id", "type": "integer" },
    { "name": "facility", "type": "uuid" },
    { "name": "code", "type": "text" },
    { "name": "note", "type": "text", "nullable": true }
  ],
  "primaryKey": ["id"],
  "indexes": [{ "columns": ["facility", "code"] }],
  "facilityColumn": "facility"
}
```

- Un nom de table ou de colonne respecte `^[a-z][a-z0-9_]{0,62}$`.
- Un type de colonne est l'un de `text`, `integer`, `bigint`, `numeric`, `boolean`, `timestamptz`, `date`, `jsonb` ou `uuid`.
- Une colonne peut rester vide sauf si elle indique `"nullable": false`. Les colonnes de clé primaire et d'établissement ne sont jamais vides.
- Une colonne peut avoir un `default` : une chaîne, un nombre, true, false ou null.
- CE ajoute `created_at` et `updated_at` à chaque table et les tient à jour. Un plugin peut les lire, mais pas les déclarer ni les écrire.
- Un plugin peut déclarer jusqu'à 50 tables, 100 colonnes par table et 20 index par table.

### Tables d'établissement

Une table avec une `facilityColumn` contient des lignes qui appartiennent chacune à un établissement. La colonne est `text` ou `uuid` et contient l'identifiant de l'établissement.

CE ajoute les établissements de l'appelant à chaque lecture, mise à jour et suppression sur cette table. Une personne limitée à certains établissements ne voit que leurs lignes, même sans filtre dans la requête. Une insertion ou une mise à jour qui indique un autre établissement est refusée. CE active aussi la sécurité au niveau des lignes sur la table, comme seconde protection.

### Mises à niveau

Une nouvelle version peut seulement ajouter à ses tables. Elle peut ajouter des tables, des colonnes qui peuvent rester vides et des index.

CE refuse une version qui supprime ou renomme une colonne, change un type, change si une colonne peut rester vide, change une valeur par défaut, la clé primaire ou la colonne d'établissement, ou supprime une table ou un index. Le refus nomme la table et la colonne. La version installée avant reste active.

Une version qui ne déclare aucune table garde les tables et les lignes de la version précédente. Désactiver un plugin, revenir à une version antérieure ou retirer une ancienne version les garde aussi. Seul le retrait du plugin avec le choix de ne rien garder supprime le schéma et ses lignes.

Après un retour à une version antérieure, cette version continue à lire et écrire ses tables. Elle ne lit et n'écrit que les colonnes qu'elle déclare. Une colonne ajoutée par une version plus récente reste dans la table, et les lignes ajoutées par l'ancienne version la laissent vide.

## db_select

Lit des lignes d'une table déclarée.

```json
{
  "table": "samples",
  "columns": ["id", "code"],
  "where": [
    { "column": "code", "op": "prefix", "value": "a" },
    { "column": "id", "op": "in", "values": [1, 2, 3] }
  ],
  "orderBy": [{ "column": "id", "direction": "desc" }],
  "limit": 100,
  "offset": 0,
  "count": true
}
```

Les filtres sont `eq`, `lt`, `lte`, `gt`, `gte`, `in` (jusqu'à 1000 valeurs), `is_null` (avec `"value": true` ou `false`) et `prefix` (colonnes texte seulement). Tous les filtres doivent être vrais. `limit` vaut 100 si vous l'omettez, et au plus 1000. La réponse est `{ "rows": [...] }`, avec `count` si vous le demandez. Le compte ne tient pas compte de `limit` ni de `offset`.

## db_write

Insère, met à jour et supprime en une transaction. Si une étape échoue, aucune n'est gardée.

```json
{
  "steps": [
    { "op": "insert", "table": "samples", "values": { "id": 4, "facility": "aaaaaaaa-1111-4111-8111-111111111111", "code": "a4" } },
    { "op": "update", "table": "samples", "key": { "id": 4 }, "set": { "note": "checked" } },
    { "op": "delete", "table": "samples", "key": { "id": 2 } }
  ]
}
```

Une `key` nomme exactement les colonnes de la clé primaire. Une requête a jusqu'à 500 étapes. Une insertion dans une table d'établissement doit indiquer la colonne d'établissement. La réponse est `{ "results": [{ "rowCount": 1 }, ...] }`, une par étape. Une étape sur une ligne hors des établissements de l'appelant ne change rien et donne `rowCount` 0.

`db_select` et `db_write` s'arrêtent chacun après 5 secondes.

## ce_read

Lit les enregistrements de CE par une opération. La requête est `{ "op": "<op>", "input": { ... } }`.

| Opération | Entrée |
|---|---|
| `patients.search` | `search`, `status`, `limit`, `offset` |
| `patients.get` | `ref` |
| `patients.register` | `patient`, un Patient FHIR avec un `id` |
| `valueset.expand` | `url`, `count`, `offset`, `filter` |
| `valueset.lookup` | `system`, `code` |
| `testCatalog.list` | les filtres de liste du catalogue des tests |
| `testCatalog.get` | `code` |
| `facilities.search` | `q`, `limit`, `offset` |

Chaque opération suit les mêmes règles que la page du studio qui montre les mêmes enregistrements. Les opérations patient demandent que l'appelant ait `patients.view`. Les identifiants ne s'affichent que pour un appelant qui a `patients.view_identifiers`. Un appelant limité ne trouve que les patients et les établissements de sa limite. `patients.register` demande aussi `Patient` dans la liste `emit-fhir` du plugin.

## fhir_emit

Envoie des enregistrements FHIR terminés dans CE. La requête est `{ "resources": [ ... ] }`.

CE vérifie chaque enregistrement avant d'en enregistrer un seul. Si un enregistrement a un type absent de la liste `emit-fhir` du plugin, rien n'est enregistré. CE applique sa propre validation, comme pour un import. Un plugin ne peut changer un enregistrement que s'il l'a écrit. Chaque enregistrement va dans le journal d'audit avec l'identifiant et la version du plugin, et garde `plugin:<id>` comme source.

Un appelant limité à certains établissements ne peut pas envoyer d'enregistrements. Un Bundle, ou un enregistrement avec des enregistrements `contained`, est refusé.

## Réponses et erreurs

Chaque fonction hôte répond `{ "ok": true, "result": ... }` ou `{ "ok": false, "error": { "code": "...", "message": "..." } }`. Une fonction hôte ne lève pas d'exception. Lisez la réponse et décidez quoi faire.

CE refuse ceci avant toute instruction SQL :

- un nom de table ou de colonne avec des guillemets ou un point, comme `pg_catalog.pg_roles` ou `public.users`
- une table ou une colonne que le manifeste ne déclare pas
- une limite au-dessus de 1000, ou plus de 1000 valeurs dans `in`
- une valeur du mauvais type pour sa colonne
- une insertion ou une mise à jour de `created_at` ou `updated_at`
- un champ que la forme de la requête n'a pas, comme `pluginId` ou `facilities`

Les codes courants sont `REQUEST_INVALID`, `REQUEST_TABLE`, `REQUEST_COLUMN`, `REQUEST_VALUE`, `REQUEST_KEY` et `REQUEST_FACILITY` pour les requêtes sur les tables. `ce_read` et `fhir_emit` utilisent `INVALID_REQUEST`, `UNKNOWN_OP`, `FORBIDDEN`, `NOT_FOUND`, `OUTSIDE_DATA_LIMIT`, `RESOURCE_TYPE_NOT_ALLOWED` et `VALIDATION_FAILED`. Une requête ou une réponse de plus de 1 Mo donne `TOO_LARGE`. Une erreur dans CE donne `HOST_ERROR`, et les détails vont dans le journal de CE, pas au plugin.

## Depuis Rust

La crate `openldr-plugin-sdk` a une fonction pour chaque fonction hôte dans `openldr_plugin_sdk::host`. Chacune prend une `serde_json::Value` et renvoie `Result<Value, HostError>`.

```rust
use openldr_plugin_sdk::host;
use serde_json::json;

let rows = host::db_select(&json!({ "table": "samples", "limit": 10 }))?;
let facilities = host::ce_read("facilities.search", json!({ "q": "clinic" }))?;
host::fhir_emit(&[json!({ "resourceType": "Observation", "id": "obs-1", "status": "final", "code": { "text": "Test" } })])?;
```

`HostError` contient le `code` et le `message` de CE. Le plugin de test dans `wasm/test-sink`, construit avec la fonctionnalité `host`, appelle chaque fonction.
