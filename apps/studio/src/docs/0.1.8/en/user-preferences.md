# Your preferences

Your theme, your sidebar state, your start page and your language are saved to your account. They follow you to any browser, computer or phone you sign in on.

This guide takes about 5 minutes. Select any picture or clip to enlarge it.

## Who can do what

Everyone. Preferences belong to each user. They are not a lab-wide setting, and no role or capability is needed to change your own.

## What is saved

| Preference | How to change it |
| --- | --- |
| Theme | Use the sun or moon button in the page header, or press `d`. |
| Sidebar open or collapsed | Use the collapse button at the top of the sidebar (desktop only). |
| Start page | Open the user menu at the bottom of the sidebar, choose **Start page**, and pick a page. |
| Language | Open the user menu at the bottom of the sidebar, choose **Language**, and pick one. |

Each change is saved as you make it. There is no Save button.

## Example 1: open on Reports after you sign in

![Opening the user menu, pointing at Start page, and choosing Reports.](user-preferences-start-page.mp4)

1. Select your name at the bottom of the sidebar. The user menu opens: **Language**, **Start page**, **Settings**, **Sign out**.
2. Point at **Start page**. The list shows the pages in your sidebar.
3. Select **Reports**. A message says **Reports will open first after you sign in.**
4. Open OpenLDR at its main address, or sign out and in again.

**Expected result:** **Reports** opens, not the Dashboard.

![OpenLDR opening on Reports.](user-preferences-reports-first.png)

How the start page works:

- It is the Dashboard unless you choose another. Pick **Dashboard** to go back to the default.
- The list shows only the pages in your sidebar. Your role decides which pages those are.
- It opens once, when you sign in or open OpenLDR at its main address. After that, the **Dashboard** link always opens the Dashboard.
- A link to a specific page still opens that page.
- If your role changes and you can no longer open your start page, the Dashboard opens.

## Example 2: switch to the light theme

![Selecting the sun button in the header.](user-preferences-theme.mp4)

1. Select the sun button at the top right, or press `d` anywhere outside a text box.

**Expected result:** the studio turns light, and stays light on your next sign-in and on your other devices. Press `d` again to go back.

![The studio in the light theme.](user-preferences-light.png)

## Example 3: work in French

![Opening the user menu, pointing at Language, and choosing Français.](user-preferences-language.mp4)

1. Open the user menu and point at **Language**.
2. Select **Français**.

**Expected result:** menus and pages switch to French at once. The sidebar reads **Tableau de bord**, **Rapports** and so on. Pick **English** or **Português** the same way.

![The studio in French.](user-preferences-french.png)

The in-app docs follow your language too, where a translation exists.

## On a new device

The first time you sign in on a new browser, OpenLDR loads your saved preferences and applies them. If you have never saved a theme, the theme that browser shows becomes your saved theme.

Language works the same way, with one difference. A language you picked in that browser before becomes your saved language. A browser where you never picked one shows English, and that is not saved, so it cannot replace the language you chose on another device.

## From the command line

An administrator can read or fix one user's preferences:

```bash
openldr user preferences show <user-id>
```

```bash
openldr user preferences set <user-id> startPage none
```

The keys are `theme` (`light` or `dark`), `sidebarCollapsed` (`true` or `false`), `startPage` (a page path such as `/reports`) and `language` (`en`, `fr` or `pt`). The value `none` clears a key. Get the user id from `openldr user list`.

## On a phone

The user menu, theme button and language work the same on a phone. The sidebar has no collapse button there: it opens from the menu button at the top left.

## Troubleshooting

- **The start page does not open.** It opens only at the main address or after sign-in. A bookmark to another page opens that page.
- **The start page says it could not be saved.** Check your connection and pick it again.
- **Another device shows a different theme.** It had a theme before you ever saved one. Change the theme once on any device and it is saved for all of them.
- **A colleague is stuck on a page they can no longer open.** The Dashboard opens instead. To clear it: `openldr user preferences set <user-id> startPage none`.

## Related guides

- [Start here](/docs/start-here)
- [Users and Roles](/docs/users)
