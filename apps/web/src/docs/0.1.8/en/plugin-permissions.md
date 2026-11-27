# Plugin permissions

A plugin can add its own permissions to CE. An administrator grants them to roles on the Roles page, like CE's own capabilities. CE checks them before each action the plugin runs.

This page is for the person who writes the plugin. Both fields go in `payload` of the signed manifest. A manifest without them installs and runs as before. The administrator sees each permission, and what each action needs, on the install screen.

## Declare permissions

```json
"permissions": [
  {
    "key": "sinkhost.run",
    "label": "Run the test sink",
    "description": "Run the actions of the test sink plugin.",
    "labels": {
      "fr": { "label": "Lancer le plugin de test", "description": "Lancer les actions du plugin de test." },
      "pt": { "label": "Executar o plugin de teste", "description": "Executar as ações do plugin de teste." }
    }
  }
]
```

- A key is dotted lower case with at least two parts. It matches `^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$`.
- `label` (up to 80 characters) and `description` (up to 300) are in English. `labels` may add French and Portuguese. The Roles page shows English where a language is missing.
- A plugin declares up to 50 permissions, each key once.
- A key may not be a CE capability. A manifest that declares `forms.edit` as its own key is refused at install. A plugin cannot give itself a CE capability.

## Permission groups

The first part of a key is its group. The key `sinkhost.run` is in the group `sinkhost`.

- The first plugin to install a key in a group owns that group for good. CE records the plugin id and the publisher key that signed the bundle. An unsigned install records no publisher.
- No other plugin id may declare a key in that group. Nor may the same id signed by another publisher key, or unsigned when the owner was signed. This holds after the owner is removed, so a new plugin cannot pick up the grants the old one left.
- CE keeps its own groups, such as `forms`, `patients` and `reports`. A plugin key in one of them is refused, so no plugin can hold a permission CE adds later.
- A refused install changes nothing. The version installed before stays active.
- If you sign with a new publisher key, your plugin loses its groups. Ask the administrator to move the claim by hand. CE has no command for this yet.

## The permission each action needs

`actionPermissions` maps an entrypoint to the permissions that open it. The caller needs any one of the list.

```json
"actionPermissions": {
  "health_check": ["sinkhost.run"],
  "host_ce_read": ["sinkhost.run", "patients.find"],
  "host_fhir_emit": ["forms.edit"]
}
```

- Each entry names an entrypoint in `payload.entrypoints`, and lists 1 to 10 permissions. Up to 100 entries.
- A listed permission is the plugin's own key or a CE capability. Listing a CE capability only asks it of the caller. The plugin does not get it.
- **Closed by default.** Once a plugin has `actionPermissions`, CE refuses every entrypoint it does not list. A page that calls an unlisted entrypoint gets an error, and the wasm does not run.
- A plugin without `actionPermissions` keeps the old rule. A caller who passes the plugin's role gate may run any entrypoint.
- CE reads the field from the stored manifest of the active version, never from the call.
- An action that calls `fhir_emit` needs its own permission, like any other. `fhir_emit` still refuses a caller limited to some facilities.

The refusal names the action and the permissions that open it, for example `the action host_fhir_emit of plugin test-sink-host needs one of these permissions: Edit forms`.

## Who gets the permissions

- **Administrator.** The Administrator role gets every permission of a plugin when the plugin is installed, enabled or rolled back. CE also checks at each start, for a plugin installed before this release.
- **Other roles** get nothing by themselves. An administrator grants the permissions on the Roles page, or with `openldr roles`. A profile pack's `role` step may list them too, when the plugin is installed first.
- **Removal and disable keep the grants.** The role still holds the key. `openldr roles doctor` lists it as kept. The role stays editable, and a save keeps the key. The key opens nothing while the plugin is away.
- **Reinstall** makes the kept keys known again. The roles that held them can run the actions at once.

## Pages and the sidebar

`payload.ui.requiredRoles` and `payload.ui.requiredCapabilities` decide who sees the plugin. A user sees the sidebar entry, and opens `/x/<id>`, only when they hold one of the roles or one of the capabilities. Typing the address does not get around it. A plugin with neither list is open to everyone.

`requiredCapabilities` may name the plugin's own keys. A user let in by a capability may run the plugin's actions when the plugin has `actionPermissions`. The action gate then decides each call. Plugin storage (`storage.*`) stays closed to such a user. It needs one of the plugin's roles.

The page gets the signed-in user's capabilities in its init context, the plugin's own keys included. Use them only to show or hide tabs. They are a copy for display. The broker on the server checks every call.

A profile layout may list a plugin page by its path, for example `"pages": ["/forms", "/x/test-sink-host"]`. When a layout is active, the plugin entry shows only if the layout lists it. A layout only hides. It never opens a page the user's capabilities do not open. `startPage` may be `/x/<id>` too.

### The sidebar icon

`payload.ui.nav.icon` names a built-in icon: `puzzle`, `share-2`, `bar-chart-3`, `database`, `plug`, `settings` or `file-text`. Any other name shows the puzzle.

To draw your own icon, add `payload.ui.nav.iconPaths`. It is a list of SVG path `d` strings on a 24x24 grid. Keep `icon` as well. A CE older than 0.1.13 ignores `iconPaths` and shows `icon`.

```json
"nav": {
  "label": "Analyzer interface",
  "section": "apps",
  "icon": "plug",
  "iconPaths": [
    "M3 15 5.5 5.5h13L21 15v4.5H3Z",
    "M3.5 15h17",
    "M8 11h2l1.4-3 2 4 1.4-2H17"
  ]
}
```

The studio draws each string as one `<path>` in its own 16-pixel `<svg>`. It sets the colour (`currentColor`), a 2-unit stroke, round caps and joins, and no fill. Draw line icons for that stroke. The link keeps the plugin label as its name.

The manifest check refuses an icon that breaks these rules:

- 1 to 8 paths, each 1 to 1,000 characters.
- Each path starts with `M` or `m`.
- Only path commands (`M L H V C S Q T A Z`, either case), digits, `e`, `.`, `,`, `+`, `-` and spaces. No markup, URL or style.

To change the icon, publish a new signed version with new paths and install it. The sidebar shows the new icon at the next page load. The studio needs no rebuild.

## Finding a patient with patients.find

`patients.find` is a CE capability for users who must find one patient without browsing the list. Its name in the studio is **Find a patient**. A user limited to some facilities keeps it, and loses `patients.view`. Of the preset roles, only the Administrator has it.

Through `ce_read`, a caller with `patients.find` and without `patients.view`:

- `patients.search` takes an exact identifier, `{ "identifier": { "system": "...", "value": "..." } }`, where `system` is optional. Or it takes `given`, `family` and a full `birthDate` (`YYYY-MM-DD`) together. A name must match in full, without case. A part of a name or identifier finds nothing. A free-text `search` is refused with `FORBIDDEN`.
- Results come only from the caller's facilities.
- `patients.get` returns a patient only at the caller's facilities. Any other answers `NOT_FOUND`.
- `patients.register` accepts `patients.view` or `patients.find`.
- Identifiers stay masked unless the caller holds `patients.view_identifiers`.

A caller with `patients.view` may also search by identifier, or by name with birth date, but not in the same call as `search`.

## A serial port for a plugin page

A plugin whose page talks to an instrument over a cable asks for the `host:serial` capability in its manifest:

```json
{ "kind": "host:serial" }
```

It takes no parameters. On the install screen the administrator sees the line **Use a serial port on the PC, when a person chooses one (host:serial)**, and approves it with the plugin's other capabilities.

This capability is not one of the plugin's own permission keys, and no role holds it. It belongs to the plugin's installed version. Any person who may open the plugin's page may then be asked to choose a port. Studio asks each time, naming the plugin, and the person may cancel.

Studio enforces it, not the server: the serial calls send no byte to the server. Turning the plugin off, removing it, or making another version active closes any open port. [Plugin tables and host functions](/docs/plugin-host-functions) lists the calls.
