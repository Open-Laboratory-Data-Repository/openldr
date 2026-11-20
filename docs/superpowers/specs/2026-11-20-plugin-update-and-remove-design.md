# Plugin update, and a remove that stops its work

Date: 2026-11-20. Status: draft, waiting on the operator.

## Why

On 2026-11-20 the operator installed cdr-source 0.1.4 from the Marketplace on Windows. The
Marketplace had 0.1.5 a few minutes later, and nothing in studio said so. An installed plugin
offers no Install, so the only way to 0.1.5 was Remove, then Install.

Remove also left the plugin's reads running. A running copy holds the SQL it was given and keeps
reading with the plugin gone (`packages/bootstrap/src/import-copy.ts:621-623`). Someone testing a
plugin could fill a server's disk, with no way to stop it short of installing the plugin again.

## Decisions (operator, 2026-11-20)

- A plugin shows its versions, and offers an update when the Marketplace has a newer one, unless
  the person rolled back.
- Removing a plugin never leaves its work running. It stops it first.
- Then the person chooses what to keep, with what each choice costs.

## What exists

The server already has the lifecycle (spec `2026-06-22-phase3-sp2-registry-lifecycle-capability-enforcement-design.md`,
line 60). Installing a newer version makes it the one active version and keeps the older ones
(`packages/plugins/src/runtime.ts`, install). Rollback makes an older one active. Remove deletes the
`plugins` rows only (`packages/plugins/src/store.ts:126-129`).

## Update

1. **Card.** When the Marketplace's newest version of an installed plugin is newer than the active
   one, the card badge reads "Update to X" instead of "Active".
2. **Detail menu.** An installed plugin's ⋯ menu gets "Update to X". It runs the same consent step
   as Install, since a new version may ask for new permissions.
3. **Versions.** The detail view lists the installed versions, with the active one marked.
   Rollback stays as it is.
4. **After a rollback.** The card and menu still offer the newest version. The person rolled back on
   purpose, so the badge is a quiet "X available", not a prompt.
5. **Running work.** A read or check carries on through an update when its SQL did not change. When
   it did, it stops and asks for a reread (`import-copy.ts:626-629`, already built).

No server change is expected. If the install route refuses a newer version of an installed plugin,
that becomes the one server change.

## Remove

1. **Stop first.** Remove lists the plugin's running reads and checks. Confirming stops each one
   and waits until it has stopped, then goes on. The plugin is removed only when nothing of it runs.
2. **Then choose what to keep.** One choice, with its cost shown:

| Choice | Kept | Deleted | Good | Cost |
|---|---|---|---|---|
| Keep everything (default) | settings, copied data, held lists | the plugin's code | install it again and carry on where it stopped | the copied data keeps its disk space (shown, such as 20 GB) |
| Keep settings, delete copied data | connector access, sources and references, check settings | copied rows, held lists, corrections | frees the disk; the setup is ready for a fresh read | every source has to be read again, hours over a network; corrections made to held requests are lost |
| Delete everything | nothing of the plugin | all of the above | a clean server, as if never installed | everything has to be set up and read again |

3. **Never deleted.** Requests a check saved into OpenLDR. They are the lab's data, not the
   plugin's. The sheet says so.
4. **CLI parity.** `openldr plugin remove <id>` stops running work the same way, and takes
   `--keep all|settings|nothing` (default `all`). It refuses without `--force` when anything is
   running or anything would be deleted. Shared logic lives in `@openldr/bootstrap`.
5. **Audit.** One entry for the remove, naming the choice and what was stopped.

## Left to the builder

- Where the stop-and-wait lives so the route and the CLI share it.
- How long to wait for a read to stop before saying it could not, and what the sheet then says.
- Whether a stopped check needs its own stop call or follows its copy.

## Not in this

- Deleting saved records. Never.
- Automatic updates.
- The update notice for OpenLDR itself, which is spec `2026-08-17-update-notice-design.md`.

## Definition of done

UI in `apps/studio` (sheet, not dialog: a multi-choice step), CLI parity, docs in en, fr, pt
(Marketplace how-to), mobile check at 375 wide, and `pnpm make:changelog` after merging.
