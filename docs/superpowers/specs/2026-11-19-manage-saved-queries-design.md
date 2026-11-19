# Manage saved queries: a permission of its own

Date: 2026-11-19. Source: demo.4 test, item 13.

## Why

Anyone with `query.run` can rename, move, edit or delete any saved query, and nothing records an
owner (`apps/server/src/query-routes.ts:30`, one guard for every route). The operator decided on
2026-11-19: a separate permission, given to roles. Running and copying stay with `query.run`.

## Decided

- New capability `query.manage`, label "Manage saved queries".
- Built-in roles that hold it: Administrator (always), Lab Manager and Data Analyst. The operator chose
  these on 2026-11-19. Custom roles do not get it; an admin adds it by hand.
- No migration. A new catalog key is granted once to the built-in roles that list it
  (`067_capability_introductions.ts`, seedSystemRoles).

## What it guards (my call)

| Needs `query.manage` | Stays with `query.run` |
|---|---|
| Edit or rename a saved query (PUT) | List and open saved queries |
| Delete a saved query | Run a query |
| Move a query to a group | Save a new query, save a copy |
| Create, rename, delete a group | Export |
| Import with replace | Import that only adds |

A data limit removes `query.manage` too, like `query.run`.

## Studio

Without `query.manage`: the saved query's row menu and the group menus are hidden, Save on an opened
saved query asks for a name and saves a new copy, and the import sheet has no replace switch.

## CLI and docs

`openldr query import` with `--replace` checks `query.manage` on the server. Docs for Query and Roles in
en, fr and pt say who can change saved queries.

## Not done

No owner of a saved query. The operator chose a permission, not ownership.
