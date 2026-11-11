# Plugin cards and side panels

## Outcome

Some plugins show more than their own page. A plugin can add a card to the home dashboard, a side panel that stays open while you move between pages, or both. An administrator can switch either one off.

## Dashboard cards

Plugin cards sit in their own row under the dashboard's widgets. They show on every dashboard. You cannot move or resize them in the dashboard editor.

Each card is the plugin's own page, drawn small. What it shows is up to the plugin.

## Side panels

1. Select the panel button in the page header, next to the notification bell. It shows only when at least one plugin offers a panel.
2. Pick a panel from the list.
3. The panel opens on the right. Keep working in the page beside it. Change page, and the panel stays open with its content as it was.
4. Select the close button at the top of the panel to close it.

On a phone the panel takes the whole screen below the header. Close it to see the page again.

The panel closes when you sign out, and when its plugin is disabled or its panel is switched off.

## Who sees them

You see a plugin's card and panel only if you can see the plugin itself. If a plugin is for certain roles only, the other roles see neither.

## For administrators: switch a card or panel off

1. Open **Settings**, then **Marketplace**, then **Installed**.
2. Open the plugin.
3. Open the ⋯ menu and choose **Places**. The item shows only for a plugin that has a card or a panel.
4. Turn **Dashboard card** or **Side panel** off. Each switch saves as soon as you flip it.

This is lab-wide. It hides the card or panel for everyone. The plugin's page, its sidebar entry and its other work keep running. To stop the whole plugin, use **Disable** in the same menu.

The audit log records each change as `plugin.sites.update`.

From the command line:

```bash
openldr market sites <plugin-id>
```

```bash
openldr market sites <plugin-id> widget off
```

The first command lists the plugin's card and panel and whether each is on. The second switches one. Use `widget` or `panel`, and `on` or `off`.

## Try it with the test plugin

The repository has a reference plugin with a card and a panel. Use it on a test install, from a source checkout. Building it needs Rust and the `wasm32-wasip1` target. See **Building plugins** on the website's Development page.

1. In the repository folder, run `pnpm build:ui-reference`. It builds the test-sink plugin and puts `plugin.wasm` and `manifest.json` in `reference-plugins/ui-reference/`.
2. Run `pnpm openldr plugin install reference-plugins/ui-reference/plugin.wasm`.
3. Reload the studio.
4. Open **Dashboard**. A card called **Reference card** sits under the widgets.
5. Select **Side panels**, the panel button next to the notification bell, and choose **Reference panel**.

**Expected result:** the card reads **Drawn in: widget** and the panel reads **Drawn in: panel**. The sidebar also has a **Reference Plugin** entry, which opens the plugin's own page.

The reference plugin names no publisher, so it installs without a signature. Its page uses dark text, so it is hard to read in the dark theme. To remove it, run `pnpm openldr plugin remove ui-reference`.
