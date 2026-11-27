# Plugin tables and host functions

A plugin's server code can keep its own records, read some of CE's records and send FHIR records into CE. It does this through four host functions: `db_select`, `db_write`, `ce_read` and `fhir_emit`. A plugin never sends SQL. It sends a JSON request, and CE checks it and builds the statement.

This page is for the person who writes the plugin. The administrator sees the capabilities on the install screen and approves them there. The permissions a person needs to run each action are on [Plugin permissions](/docs/plugin-permissions).

## Capabilities

Each host function exists only when the plugin's manifest asks for its capability. A plugin without the capability does not get the function.

| Host function | Capability it needs |
|---|---|
| `db_select`, `db_write` | `host:db` |
| `ce_read` | `host:ce-read` |
| `fhir_emit` | `emit-fhir` and `host:db` |

The `emit-fhir` capability lists the record types the plugin may send, for example `{ "kind": "emit-fhir", "resourceTypes": ["Observation"] }`.

A wasm module that imports a host function cannot load where CE does not give it. So import only the functions your capabilities give.

Host functions run only on a worker thread. A server started with a loader such as `tsx` cannot start one. There a call fails with a message that says so, and the plugin does not run without its functions.

Every call needs a signed-in person. CE passes that person to the host functions from its own session. The plugin cannot set or change it.

## Declared tables

A plugin lists its tables in `payload.tables` in its signed manifest. Tables need `host:db`. CE makes them at install, in a schema of the plugin's own, `plugin_<id>`. A plugin reaches no other table.

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

- A table or column name matches `^[a-z][a-z0-9_]{0,62}$`.
- A column type is one of `text`, `integer`, `bigint`, `numeric`, `boolean`, `timestamptz`, `date`, `jsonb` or `uuid`.
- A column may be empty unless it sets `"nullable": false`. Primary key and facility columns are never empty.
- A column may set a `default`: a string, number, true, false or null.
- CE adds `created_at` and `updated_at` to every table and keeps them up to date. A plugin may read them but not declare or set them.
- A plugin may declare up to 50 tables, 100 columns a table and 20 indexes a table.

### Facility tables

A table with a `facilityColumn` holds rows that belong to one facility. The column is `text` or `uuid` and holds the facility id.

CE adds the caller's facilities to every select, update and delete on that table. A person limited to some facilities sees only their rows, even with no filter in the request. An insert or update that sets another facility is refused. CE also turns on row-level security for the table, as a second guard.

### Upgrades

A new version may only add to its tables. It may add tables, add columns that may be empty and add indexes.

CE refuses a version that drops or renames a column, changes a type, changes whether a column may be empty, changes a default, the primary key or the facility column, or drops a table or index. The refusal names the table and column. The version installed before stays active.

A version that declares no tables keeps the tables and rows of the version before. Disabling a plugin, rolling it back or removing one old version keeps them too. Only removing the plugin and choosing to keep nothing drops the schema and its rows.

After a rollback, the older version keeps reading and writing its tables. It reads and writes only the columns it declares. A column a newer version added stays in the table. Rows the older version adds leave it empty, or give it its default when the column has one.

## db_select

Reads rows from one declared table.

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

The filters are `eq`, `lt`, `lte`, `gt`, `gte`, `in` (up to 1000 values), `is_null` (with `"value": true` or `false`) and `prefix` (text columns only). All filters must hold. `limit` is 100 if you leave it out, and at most 1000. The answer is `{ "rows": [...] }`, with `count` when you ask for it. The count ignores `limit` and `offset`.

## db_write

Inserts, updates and deletes in one transaction. If one step fails, none is kept.

```json
{
  "steps": [
    { "op": "insert", "table": "samples", "values": { "id": 4, "facility": "aaaaaaaa-1111-4111-8111-111111111111", "code": "a4" } },
    { "op": "update", "table": "samples", "key": { "id": 4 }, "set": { "note": "checked" } },
    { "op": "delete", "table": "samples", "key": { "id": 2 } }
  ]
}
```

A `key` names exactly the primary key columns. A request has up to 500 steps. An insert into a facility table must set the facility column. The answer is `{ "results": [{ "rowCount": 1 }, ...] }`, one per step. A step on a row outside the caller's facilities changes nothing and gives `rowCount` 0.

An update or delete can be conditional. `where` takes the same filters as `db_select`, and CE adds them to the key. `expect` is the number of rows the step must change. When the step changes a different number, CE saves nothing of the request and answers `REQUEST_CONFLICT`, naming the step and the table. Use it when another call may have changed the row since you read it.

```json
{ "op": "update", "table": "order_tests", "key": { "id": "t1" }, "set": { "status": "rejected" },
  "where": [{ "column": "hold", "op": "is_null", "value": true }], "expect": 1 }
```

`db_select` and `db_write` each stop after 5 seconds.

## ce_read

Reads CE's own records through one op. The request is `{ "op": "<op>", "input": { ... } }`.

| Op | Input |
|---|---|
| `patients.search` | `search`, or `identifier`, or `given`, `family` and `birthDate`; then `status`, `limit`, `offset` |
| `patients.get` | `ref` or `pluginRef`, one of them |
| `patients.getMany` | `pluginRefs`, a list of 1 to 100 |
| `patients.register` | `patient`, a FHIR Patient with an `id` |
| `valueset.expand` | `url`, `count`, `offset`, `filter` |
| `valueset.lookup` | `system`, `code` |
| `testCatalog.list` | the test catalog's list filters |
| `testCatalog.get` | `code` |
| `testCatalog.resultParams` | `tests`, a list of 1 to 20 `{ system, code }`, and `patientRef`, a `pluginRef` |
| `facilities.search` | `q`, `limit`, `offset` |
| `facilities.get` | `id`. Gives one facility in the shape of a `facilities.search` row |
| `caller.get` | none. Gives `userId`, `displayName` and `facilities` (`*` or the list of facility ids) of the person calling. `displayName` may be null |
| `results.list` | `limit` (1 to 200), then `since` and `until` (result time), `pluginRef` (the patient), `observation` (code) and `after`. Gives `results` and `next` |
| `results.get` | `id`. Gives one result in the shape of a `results.list` row |

Each op follows the same rules as the studio page that shows the same records. The patient ops need the caller to hold `patients.view` or `patients.find`. With `patients.find` alone, a search must be an exact identifier, or a name with full birth date. See [Plugin permissions](/docs/plugin-permissions). Identifiers show only to a caller who holds `patients.view_identifiers`. A limited caller finds only patients and facilities inside their limit. `patients.register` also needs `Patient` in the plugin's `emit-fhir` list. `facilities.get` answers a facility outside the caller's limit as `NOT_FOUND`, the same as a missing one.

### Released results

`results.list` and `results.get` answer released results only: status `final`, `amended` or `corrected`. The caller must hold `reports.view_issued`. A limited caller reads only results whose request's requesting facility or testing lab is inside their limit, the same rule dashboards use. A result outside the limit answers `NOT_FOUND`, like a missing one.

Each result gives `id`, `requestId`, `patient` (`{ "pluginRef": ... }` or null), `observation` (`code`, `system`, `display`), `value` (`type`, `number`, `units`, `comparator`, `code`, `text`), `abnormalFlag`, `status`, `resultTime`, `specimenId` and `requester` (`code`, `system`). The patient is this plugin's own lasting reference, never CE's id. Read the patient's details with `patients.get`.

Pages go in the order CE stored the results. Pass the `next` of one page as `after` to read the next, until `next` is null. A page does not move while results are added. `since` and `until` filter by result time, so a result with no result time is left out when you give either.

### Keeping a link to a patient

A patient's `ref` works only until CE restarts. A masked row also has no `id`. So do not store either.

Store `pluginRef` instead. Each `patients.search` row, the `patients.get` answer and the `patients.register` answer carry one. It stays the same for the same patient on every call and after a restart. It hides the patient id. It is made for your plugin only, so another plugin gets a different `pluginRef` for the same patient and cannot use yours.

To open the patient later, call `patients.get` with `{ "pluginRef": "..." }`. The same rules apply as with `ref`. A patient outside the caller's limit, or a `pluginRef` made for another plugin, gives `NOT_FOUND`.

To open several patients at once, as a list of orders needs, call `patients.getMany` with `{ "pluginRefs": ["...", "..."] }`. It answers `{ "rows": [...] }` in the same order. Each row is what `patients.get` would give, or `null` where `patients.get` would give `NOT_FOUND`. An unmasked read writes one audit row for the whole call, with the count.

A merged patient's row also has `replacedByPluginRef`, the `pluginRef` of the record that replaced it. It is null for a patient that was not merged. Follow it to keep a stored link pointing at the surviving record.

A `pluginRef` belongs to the plugin id, not to one install. If you remove a plugin and later install one under the same id, it can open the refs the earlier one stored. A factory reset keeps the links working.

`testCatalog.get` and `testCatalog.list` answer each test with `code` and `testCode`. `code` is the fixed id of the test. It never changes, so store it and pass it back to CE. `testCode` is the national Test code. It can change, and a test saved before this change reads the same as its `code`. Show `testCode` to people.

`testCatalog.get` also answers `codings`: other codes that name the test, such as a SNOMED procedure. Each has `system`, `code`, `display`, `purpose` (`ADDITIONAL`, `INDICATION`, `PROCEDURE` or `CATEGORY`) and `note`. The list is empty when the test has none.

### Result parameters for one patient

`testCatalog.resultParams` gives each test's result parameters, with the reference range that fits one patient. Send `{ "tests": [{ "system": "...", "code": "..." }], "patientRef": "p1...." }`. It needs `patients.view` or `patients.find`, as the patient ops do. A patient outside the caller's limit gives `NOT_FOUND`.

The answer is `{ "tests": [...], "sexes": [...] }`. Each test lists its `params`. Each parameter has its `unit`, `display`, `bands`, the `band` that fits the patient or null, and `fits`, one of `yes`, `no` or `unknown` for each band in order. A band has a `name` when the lab gave the range one. `sexes` gives each sex code with its label in en, fr and pt. CE reads the patient's sex and age to pick the band. The answer does not include them.

Each parameter also has its `resultType`: `numeric`, `coded`, `text`, `boolean`, `date` or `multicoded`. `boolean` is a yes or no answer. `multicoded` takes one or more answers from the parameter's `valueSetUrl`, as `coded` takes one. `required` says whether the field must be filled. When it is absent, the field is required. The entry limits come only on their own type, and each is absent when not set:

- `numeric`: `min`, `max` and `decimals`, the decimal places to keep.
- `text`: `minLength` and `maxLength`.
- `date`: `dateLimit`, `past` or `future`. Absent means any date.

A band can name a `country`. The lab's country, set in Settings, Laboratory, decides `fits` for it: `no` for another country, and `unknown` while the lab has no country set.

## Use a connector

A plugin's server code can send to an outside system through a connector. CE keeps the connector's password and gives it to the code only for that call. The code can reach only the connector's own address.

Call the entrypoint from the page with the connector's id:

```js
await openldr.invoke('send', payload, { connectorId });
```

CE then runs the entrypoint with the connector's settings as its config, and allows network calls to the connector's address only. It refuses the call unless all of these hold:

- An admin switched the plugin on for that connector, in Connectors > **Plugin access** or with `openldr connectors allow <id> <plugin>`.
- The plugin declares both `host:connectors` and `net-egress`.
- Plugin network access is on for this CE (`PLUGIN_EGRESS_ENABLED`).
- The connector exists, is enabled, and is not a database connector. A database connector is for import plugins only: CE runs their read-only SELECTs itself, so its password never reaches plugin code.

The page never sees the settings. If the code puts a secret setting (a password, token or key) in its answer, CE withholds the whole answer. The audit row for the call names the connector. The same approval also covers the `connectors.*` page calls: a plugin lists and uses only the connectors it was switched on for.

## fhir_emit

Sends finished FHIR records into CE. The request is `{ "resources": [ ... ] }`.

CE checks every record before it saves any. If one record has a type not in the plugin's `emit-fhir` list, nothing is saved. CE runs its own validation on the records, as it does for an import. A plugin may change a record only if it wrote that record. Each save goes in the audit log with the plugin's id and version, and the record keeps `plugin:<id>` as its source.

A caller limited to some facilities cannot send records. A Bundle, or a record with `contained` records, is refused.

A reference written `Patient/` followed by a `pluginRef` is changed to the patient's real id before CE checks or saves anything. This works on any reference in the record, such as `subject` or a Provenance `target`. If one of these `pluginRef` values does not open for your plugin, nothing is saved and the answer is `NOT_FOUND`. A reference to `Patient/<id>` stays as you wrote it. A send with a `pluginRef` link needs the caller to hold `patients.view` or `patients.find`, so a role that authorises results needs **View patient index** or **Find a patient**. Without it the answer is `FORBIDDEN`. One send may link up to 200 different patients. A link must be exactly `Patient/` and a `pluginRef`. Any other spelling with `/p1.` in it, such as `patient/p1...`, a full URL or a trailing path, gives `INVALID_REQUEST`. In each case nothing is saved.

## Answers and errors

Every host function answers `{ "ok": true, "result": ... }` or `{ "ok": false, "error": { "code": "...", "message": "..." } }`. A host function does not throw. Read the answer and decide what to do.

CE refuses these before any SQL runs:

- a table or column name with quotes or a dot, such as `pg_catalog.pg_roles` or `public.users`
- a table or column the manifest does not declare
- a limit over 1000, or more than 1000 values in `in`
- a value of the wrong type for its column
- an insert or update of `created_at` or `updated_at`
- a field the request shape does not have, such as `pluginId` or `facilities`

Common codes are `REQUEST_INVALID`, `REQUEST_TABLE`, `REQUEST_COLUMN`, `REQUEST_VALUE`, `REQUEST_KEY`, `REQUEST_FACILITY` and `REQUEST_CONFLICT` for table requests. `ce_read` and `fhir_emit` use `INVALID_REQUEST`, `UNKNOWN_OP`, `FORBIDDEN`, `NOT_FOUND`, `OUTSIDE_DATA_LIMIT`, `RESOURCE_TYPE_NOT_ALLOWED` and `VALIDATION_FAILED`. A request or answer over 1 MB gives `TOO_LARGE`. An error inside CE gives `HOST_ERROR`, and the details go to CE's log, not to the plugin.

## From Rust

The `openldr-plugin-sdk` crate has a wrapper for each function in `openldr_plugin_sdk::host`. Each takes a `serde_json::Value` and returns `Result<Value, HostError>`.

```rust
use openldr_plugin_sdk::host;
use serde_json::json;

let rows = host::db_select(&json!({ "table": "samples", "limit": 10 }))?;
let facilities = host::ce_read("facilities.search", json!({ "q": "clinic" }))?;
host::fhir_emit(&[json!({ "resourceType": "Observation", "id": "obs-1", "status": "final", "code": { "text": "Test" } })])?;
```

`HostError` has CE's `code` and `message`. The test plugin in `wasm/test-sink`, built with the `host` feature, calls each function.

## Serial ports for a plugin page

A plugin's page can read and write a serial port on the PC it runs on, as raw bytes. This is for a page that talks to an instrument over a cable. The calls are on `window.openldr.serial`, in the page, not in the plugin's server code. Studio holds the port and does every check. These calls send no byte to the server. What your plugin does with the bytes afterwards, such as saving a result, is its own.

The plugin needs the `host:serial` capability. [Plugin permissions](/docs/plugin-permissions) says what the administrator sees.

It works where the browser has the serial feature: Chrome and Edge, on an `https` address or on this PC's own address, and the OpenLDR desktop app. Firefox and Safari do not have it. There every call is refused with `serial-unavailable`.

### The six calls

| Call | What it does |
|---|---|
| `ports()` | The ports this page was given since it loaded, as `{ port, label }`. Empty until a person chooses one. |
| `choose()` | Studio asks the person, naming the plugin, then shows the list of ports. Gives `{ port, label }`, or `null` when the person cancelled. |
| `open(port, settings)` | Opens a chosen port. |
| `read(port, waitMs)` | Gives `{ bytes, lost }`. `bytes` is a `Uint8Array` of what arrived, at most 65,536 bytes. With `waitMs` it waits up to that long for a first byte. Without it, it answers at once. |
| `write(port, bytes)` | Sends a `Uint8Array` of 1 to 65,536 bytes. Resolves when the port's output has taken them. |
| `close(port)` | Closes the port. The same `port` can be opened again while this page stays loaded, the plugin keeps its grant and the device is still there. |

`port` is a handle Studio makes up for this one page. It is not the port's name, and it is no use to another page.

A person chooses the port every time. Nothing picks one by itself, and a port is not remembered across a reload.

### Settings

| Field | Values | Default |
|---|---|---|
| `baudRate` | a whole number from 300 to 921600 | none, it is required |
| `dataBits` | 7 or 8 | 8 |
| `stopBits` | 1 or 2 | 1 |
| `parity` | `none`, `even`, `odd` | `none` |
| `flowControl` | `none`, `hardware` | `none` |

Any other field is refused. There are no control lines: no DTR, no RTS, no break.

### Limits

| Limit | Value |
|---|---|
| Ports open, opening or closing, for one plugin page | 2 |
| Bytes one read returns | 65,536 |
| Bytes waiting to be read, per port | 1,048,576 |
| Bytes one write takes | 65,536 |
| Bytes waiting to be sent, per port | 1,048,576 |
| Longest wait for one read | 30,000 ms |

### Refusals

A refused call rejects with an `Error` whose message is one of these codes. `choose()` is the one exception: a cancel gives `null`.

| Code | Meaning |
|---|---|
| `serial-not-granted` | The plugin does not hold `host:serial`, or Studio does not know yet, or the grant was taken away. |
| `serial-unavailable` | The browser has no serial feature here, or refused for security. |
| `serial-cancelled` | The person cancelled. Only seen as `null` from `choose()`. |
| `serial-unknown-port` | The handle is not one of this page's, or the port is not open. |
| `serial-busy` | The port is already open or opening, here or in another page, or its last close has not finished. Or a read is already waiting on it. Or another port question is open. |
| `serial-too-many` | Two ports are already open, opening or closing. |
| `serial-too-large` | The bytes are not a `Uint8Array`, are empty, are over 65,536, or the send queue is full. |
| `serial-bad-settings` | The settings are not as the table above. |
| `serial-closed` | The port was closed, or the cable was pulled, while the call waited. |
| `serial-failed` | The device or the system refused: an open that fails, an I/O error. |

### What your page must handle

- **A cancelled choice.** `choose()` gives `null`. Leave the person where they were.
- **A dropped link.** A pulled cable or an I/O error ends a waiting read with `serial-closed`. The handle is then dead, without a reload: later calls give `serial-unknown-port`. Ask the person to choose the port again.
- **Lost bytes.** When 1,048,576 bytes wait unread, Studio drops everything unread. The next read gives no bytes and `lost: true`, once. Bytes after that arrive as usual. Start your framing again: the bytes before and after the gap are never joined.
- **A reload.** Every load of the page starts with no port. The person chooses again.
- **Wait for writes before you close.** A write's promise resolves when the port's output has taken the bytes. That does not mean the instrument received them or answered. `close()` does not wait for writes that have not finished, so wait for them first.
- **The grant going away.** While a port is open, Studio asks the server once a minute. A check that gets no answer changes nothing and is tried again a minute later. When a check shows the plugin was turned off, upgraded or lost the capability, the port closes, its handle is dead and calls give `serial-not-granted`.

### Example

```js
async function readFromInstrument() {
  await window.openldr.ready;
  const serial = window.openldr.serial;

  const chosen = await serial.choose();      // null when the person cancelled
  if (!chosen) return;
  await serial.open(chosen.port, { baudRate: 9600 });

  let buffer = [];
  for (;;) {
    let read;
    try {
      read = await serial.read(chosen.port, 5000);   // waits up to 5 seconds for a first byte
    } catch (err) {
      // 'serial-closed': the cable was pulled or the port was closed. Ask the person to choose again.
      break;
    }
    if (read.lost) buffer = [];                      // bytes were dropped: start the framing again
    buffer.push(...read.bytes);
    // ...cut whole messages out of buffer here...
  }
}
```

### Not proven

These calls were run in Chrome 158 and in the desktop app on Linux, up to the choice of a port. No port was opened: the test PC had no serial device. A real cable, a real analyser, Edge, Windows and macOS have not been tried.
