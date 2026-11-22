# Profile packs

A profile pack sets up one job on an OpenLDR install, such as a collection site, a lab bench or a data hub. One signed install makes the role for that job, its sidebar layout and its forms. It can also say which plugins must be installed first.

A profile pack is a content pack whose steps include `needs`, `role`, `layout` or `form`. There is no separate bundle type. It installs, updates and is removed like any content pack. One install can hold several profiles side by side.

Capabilities stay the only lock. A layout hides pages and grants nothing. A person opens a page only when one of their roles has the capability for it.

The in-app guide **Profile packs** shows an administrator how to install one, read its summary and remove it. This page is for the person who writes the pack.

## The pack file

A content pack is a `pack.json` file next to its `manifest.json`. The steps run in the order they are listed. A pack may mix the profile steps with the older ones, such as `code-system` or `datasets`.

The file is one object with `"formatVersion": 1` and a `steps` list. Each section below shows one profile step as it goes in that list. Put the steps in the order they should run: a role before the layout and forms that name it.

A CE that does not know a step kind refuses the whole pack with `this pack needs a newer CE`, before it writes anything. So an older CE never half-installs a profile.

A role slug, a layout key and a form key are the pack's own names for what it installs. Each is 2 to 48 characters: lowercase letters, digits and hyphens, starting with a letter. Each key may appear once per kind. Keep them the same from one version to the next. The next version finds what the last one made by these keys.

### The needs step

`needs` lists the plugins and content packs this profile depends on. Each has an id and a version range.

```json
{
  "kind": "needs",
  "bundles": [
    { "id": "sample-tracking", "version": ">=0.1.0 <0.2.0" }
  ]
}
```

The install stops before any write if one is missing or its version is out of range. The message is `this pack needs <id> <range>, which is not installed`, or `this pack needs <id> <range>; <version> is installed`. A content pack counts only when its last install finished without a failed step.

A range is `*`, an exact version, or a comparison with `>=`, `<=`, `>` or `<`. A space between two comparisons means both must hold. `||` means either. There is no `^` or `~`.

The install leaves the bundles it needs alone, and so does removal.

### The role step

`role` makes one role, with its name, an optional description, and its capability keys.

```json
{
  "kind": "role",
  "slug": "sample-clerk",
  "name": "Sample Clerk",
  "description": "Registers samples and sends them to the lab.",
  "capabilities": ["forms.view", "forms.submit", "patients.view"]
}
```

Each capability must be a key the running CE knows. The keys are listed in `packages/rbac/src/catalog.ts` in the CE source, and the Roles page shows the same list by name. An unknown key fails the install with `unknown capability: <key>`.

The slug must already be in its final form: lowercase letters, digits and single hyphens. CE refuses a slug it would change when it stores it.

### The layout step

`layout` makes one named sidebar. `roles` lists the roles that get it as their default.

```json
{
  "kind": "layout",
  "key": "collection-site",
  "name": "Collection site",
  "startPage": "/forms",
  "pages": ["/forms", "/patients", "/docs"],
  "roles": ["sample-clerk"]
}
```

`name` is 1 to 60 characters, and no other layout on the install may have it. `pages` lists 1 to 50 studio paths, each once. `startPage` is one of `pages`, or `null` to open the default page.

### The form step

`form` installs one FHIR Questionnaire as a form, publishes it, and sets who may open and submit it.

```json
{
  "kind": "form",
  "key": "sample-dispatch",
  "questionnaire": {
    "resourceType": "Questionnaire",
    "title": "Sample dispatch",
    "status": "active",
    "item": [
      { "linkId": "batch", "text": "Batch number", "type": "string", "required": true },
      { "linkId": "sent-on", "text": "Date sent", "type": "date" }
    ]
  },
  "open": ["sample-clerk"],
  "submit": ["sample-clerk"]
}
```

The form takes its name from the Questionnaire's `title`. Its version label is the pack's version. `open` and `submit` take role slugs, and CE turns them into the role ids of the install it runs on. An empty list means every role with the permission, as in the form builder's **Access** sheet. To submit, a person must also be able to open the form.

Codes and value sets inside a Questionnaire belong to the pack. Keep them in the pack's repository, never in CE.

## The rules a pack must follow

OpenLDR checks every step before it writes any of them. A pack that breaks one of these rules installs nothing.

- **A pack changes only what it made.** CE records which pack made each role, layout and form. If a role with the same slug, or a layout with the same name, already exists and this pack did not make it, the install stops and names it.
- **A layout or form names only the pack's own roles.** Each slug in `roles`, `open` or `submit` must belong to a `role` step earlier in the same pack. A pack cannot attach its layout or its forms to a role an administrator made, because making a layout the default for a role would change that role.
- **The installer needs roles.manage.** Installing a bundle needs `marketplace.manage`. A pack with a role step needs `roles.manage` as well. So does any update of a pack that made a role, even when the new version has no role step, and so does removing such a pack. The messages are `installing this pack needs the roles.manage capability` and `removing this pack needs the roles.manage capability`.
- **A pack grants no more than its installer holds.** If a role step lists a capability the person installing does not hold, the install stops with `you cannot install a role that grants <key>, because you do not hold it`. Run on the machine itself, the CLI is not limited by these two checks.

Steps write one at a time, with no transaction around them. If a form step fails after a role step has written, the role stays. Installing the same pack again finds that role by its slug and updates it. Every profile step is safe to run twice.

## Updates and removal

A newer version of the pack updates the role, layout and form it made before. An administrator's edit to one of them is lost at the next update. The Roles and Layouts pages show **From pack** and the pack id under each item a pack made, so this is not a surprise.

If the newer version leaves out a role or layout the older one made, the update deletes it. If someone still holds that role, the update stops before any write and names each role with its users. A form the newer version leaves out stays as it is and no longer belongs to the pack.

Removing the pack deletes its layouts, then its roles. When the pack made a role, removing it needs `roles.manage`, and the message without it is `removing this pack needs the roles.manage capability`. It refuses while anyone holds one of its roles, and lists them. It keeps its forms published, with every response, so an administrator can archive them by hand. Deleting a role takes it off every form's access list, so a form limited to the pack's roles then opens to anyone with `forms.view`. It leaves alone the code systems, queries, datasets and mappings the pack installed, and the bundles named in `needs`.

On a central server, a pack acts on that server only. Its roles and layouts stay there. Its forms reach the labs the way any form does.

## The step list in the manifest

`manifest.json` repeats each step as one line of `kind`, `label` and `count`, in `payload.steps`. The install screen reads this list. CE works it out again from `pack.json` and refuses the pack with `step list does not match pack.json` when the two differ. For the profile steps:

| Step | `label` | `count` |
| --- | --- | --- |
| `needs` | The bundle ids, joined by `, ` | How many bundles |
| `role` | The role's `name` | How many capabilities |
| `layout` | The layout's `name` | How many pages |
| `form` | The Questionnaire's `title`, else the form `key` | 1 |

For the collection site example above, the list is:

```json
[
  { "kind": "role", "label": "Sample Clerk", "count": 3 },
  { "kind": "layout", "label": "Collection site", "count": 3 },
  { "kind": "form", "label": "Sample dispatch", "count": 1 }
]
```

The list must have one line for each step in the pack, in the same order, or the install fails with `step list does not match pack.json`.

A content pack declares no capabilities in its manifest and must name a publisher.

## Build, sign and install

A profile pack is built and signed the same way as any content pack. `openldr artifact keygen --out <dir>` makes a publisher key in that folder. `openldr artifact pack <dir> --key <key>` fills in the hash of `pack.json` and the key's fingerprint, signs the manifest, and writes the bundle. [Command-line interface](/docs/cli) lists the `artifact` and `market` commands.

Before you publish, try the bundle on a test install:

```sh
openldr market install <bundle-directory> --dry-run
openldr market install <bundle-directory>
openldr market update <bundle-directory>
openldr market remove <pack-id> --force
```

`--dry-run` writes nothing. It runs the checks as if you held every capability, so it does not test the `roles.manage` rule or whether you hold each capability a role grants. `market update` installs a newer version of an installed pack. `market remove` without `--force` prints the roles and layouts it would remove, the forms it keeps, and anyone who still holds one of the pack's roles, and changes nothing.

Then sign in to the studio as someone who holds the role, and check the sidebar shows the layout's pages and the forms open.
