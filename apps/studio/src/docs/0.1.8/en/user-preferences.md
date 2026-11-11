# Your preferences

## Outcome

Your theme, your sidebar state and your start page are saved to your account. They follow you to any browser, computer or phone you sign in on.

## What is saved

| Preference | How to change it |
| --- | --- |
| Theme | Use the sun or moon button in the page header, or press `d`. |
| Sidebar open or collapsed | Use the collapse button at the top of the sidebar (desktop only). |
| Start page | Open the user menu at the bottom of the sidebar, choose **Start page**, and pick a page. |

Each change is saved as you make it. There is no Save button.

## Start page

The start page is the page that opens after you sign in. It is the Dashboard unless you choose another.

- The list shows only the pages in your sidebar. Your role decides which pages those are.
- The start page opens once, when you sign in or open OpenLDR at its main address. After that, the **Dashboard** link always opens the Dashboard.
- A link to a specific page still opens that page.
- If your role changes and you can no longer open your start page, the Dashboard opens.
- Pick **Dashboard** to go back to the default.

## On a new device

The first time you sign in on a new browser, OpenLDR loads your saved preferences and applies them. If you have never saved a theme, the theme that browser shows becomes your saved theme.

## For administrators

Preferences belong to each user. They are not a lab-wide setting, and no role or capability is needed to use them. An administrator can read or fix one user's preferences from the command line:

```bash
openldr user preferences show <user-id>
```

```bash
openldr user preferences set <user-id> startPage none
```

The keys are `theme` (`light` or `dark`), `sidebarCollapsed` (`true` or `false`) and `startPage` (a page path such as `/reports`). The value `none` clears a key. Get the user id from `openldr user list`.
