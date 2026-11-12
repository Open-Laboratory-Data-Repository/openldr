# Plugin cards and side panels

Some installed plugins add a dashboard card or a side panel. Use a side panel to keep the plugin visible while moving between app pages.

You see a plugin card and panel only when you may see that plugin. A plugin restricted to certain roles keeps those same restrictions here.

Administrators with marketplace management access can switch a card or panel off for everyone in the lab. The plugin page and other work remain enabled.

Use a plugin your organisation already installed. The pictures use the optional Reference Plugin on a test installation. The current reference sample follows the app's light or dark theme. No clinical sample data is needed.

## Read a plugin dashboard card

A plugin must declare a dashboard card before one can appear. Its content comes from that plugin.

### 1. Open Dashboard

Read the plugin card beneath the dashboard widgets. Cards appear on dashboards outside the normal widget editor. You cannot move or resize them there.

![A declared plugin card appears beneath the dashboard widgets.](plugin-sites-guide-dashboard.png)

**Expected result:** The reference example reports Drawn in: widget. Your plugin shows its own content.

## Open a panel while you work

A panel is available only when an enabled plugin declares one and you may access that plugin.

### 1. Open Side panels

Select the **Side panels** button beside the notification bell. It appears only when a panel is available.

![Side panels appears when an available plugin declares a panel.](plugin-sites-guide-panel-button.png)

### 2. Choose a panel

Select its title. The example is **Reference panel**.

![Choose the panel by its title.](plugin-sites-guide-panel-choice.png)

### 3. Read the panel

The panel opens on the right. The main page remains available beside it on desktop.

![The side panel opens beside the current page.](plugin-sites-guide-panel-open.png)

### 4. Move to another app page

Choose another page in the main menu. The panel stays open with its current content. The example moves to Forms.

![The panel stays open while you change the main page.](plugin-sites-guide-navigate.png)

### 5. Close the panel

Select **Close** at the panel top right.

![Close returns the space to the main page.](plugin-sites-guide-close.png)

**Expected result:** Closing returns the space to the main page. Signing out or disabling the plugin or its panel also closes it.

## Switch a card or panel off

These switches apply to the whole lab. Each switch saves immediately. There is no separate Save action.

### 1. Open Marketplace

Open **Settings**, then **Marketplace**.

![Open Settings, then Marketplace.](plugin-sites-guide-marketplace.png)

### 2. Choose Installed

Use the **Installed** tab.

![Choose Installed to find the plugin.](plugin-sites-guide-installed.png)

### 3. Open the plugin

Choose the installed plugin that supplies the card or panel.

![Open the installed plugin card.](plugin-sites-guide-plugin.png)

### 4. Open its actions

Select the plugin detail dots.

![Open the plugin detail dots.](plugin-sites-guide-actions.png)

### 5. Choose Places

Select **Places**. This action appears only when the plugin declares a dashboard card or side panel.

![Places appears only for a plugin declaring a card or panel.](plugin-sites-guide-places.png)

### 6. Change Dashboard card

Turn **Dashboard card** off to hide that card. Turn it on to restore it.

![Dashboard card saves immediately when changed.](plugin-sites-guide-card-switch.png)

## Control the side panel separately

Continue in Places. Each placement switch controls that one location; it does not disable the whole plugin.

### 1. Check the saved state

An off switch means the dashboard card is hidden. A failed save reports an error and keeps the previous state.

![The card switch is now off for the whole lab.](plugin-sites-guide-card-off.png)

### 2. Change Side panel separately

Turn **Side panel** off to hide that panel. It has a separate switch.

![Side panel can be switched separately.](plugin-sites-guide-panel-switch.png)

### 3. Check the result

Close Places and return to Dashboard. The example has hidden both places, while Reference Plugin remains in the main menu.

![The disabled places disappear while the plugin page remains available.](plugin-sites-guide-hidden.png)

**Expected result:** The plugin page and its other work remain enabled. Each change appears in Audit as plugin.sites.update.

## Use a side panel on a phone

At phone width, the panel covers the main page beneath the app header.

### 1. Choose the panel

Open the header Side panels button and choose the panel.

![Use the header Side panels button on a phone.](plugin-sites-guide-phone-menu.png)

### 2. Read the panel

Use the panel content. The underlying page is covered.

![A phone panel covers the page beneath the header.](plugin-sites-guide-phone-panel.png)

### 3. Return to the app page

Select **Close** at the panel top right.

![Close the panel to return to the main page.](plugin-sites-guide-phone-close.png)

**Expected result:** The screenshots verify the 375px layout. A real phone must confirm access around retractable browser chrome.

## Read or change places from the CLI

Follow [Start here](/docs/start-here) for CLI setup. From `openldr_ce`, use the plugin id. A place is called `widget` for Dashboard card and `panel` for Side panel.

```shell
pnpm openldr market sites <plugin-id>
pnpm openldr market sites <plugin-id> widget off
pnpm openldr market sites <plugin-id> widget on
pnpm openldr market sites <plugin-id> panel off
pnpm openldr market sites <plugin-id> panel on
```

## Optional practice with Reference Plugin

Use your own installed plugin for normal work. In a disposable source installation, the reference plugin demonstrates a card, panel and separate plugin page. Build tools need Rust and its `wasm32-wasip1` target.

From `openldr_ce`, run `pnpm build:ui-reference`, then `pnpm openldr plugin install reference-plugins/ui-reference/plugin.wasm`. Reload Studio. Dashboard shows Reference card and Side panels offers Reference panel. The reference plugin declares no publisher signature, so use it only in a test installation.

The picture reads Drawn in: widget or Drawn in: panel according to its location. Its test note is fictional. Remove it afterward with `pnpm openldr plugin remove ui-reference`.

## Troubleshooting

**No Side panels button.** Check that an enabled, permitted plugin declares a panel and its Side panel switch is on.

**No Places action.** That plugin may not declare a card or panel. Places does not add a new capability to a plugin.

**The card is missing.** Check Dashboard card in Places, the plugin enabled state and your role access.

**The reference sample still uses old colors.** Rebuild and reinstall the sample from your current checkout, then reload Studio. Installed packages keep their packaged HTML.

## Related guides

[Marketplace](/docs/marketplace) covers installation and plugin state. [Dashboards](/docs/dashboard) covers ordinary dashboard widgets.
