# Layouts

## Outcome

A layout is a named sidebar. It sets which pages the sidebar shows and which page opens first after sign-in. An administrator makes layouts and picks one as the default for a role. Each user can pick a different one, or the full sidebar.

A layout only hides pages. It never shows a page your role cannot open, and a hidden page still opens from a link. Docs always shows.

## Pick your layout

1. Open the user menu at the bottom of the sidebar.
2. Choose **Layout**. It shows only when at least one layout exists.
3. Pick one:
   - **Role default** uses the layout your administrator set for your role. The name in brackets says which.
   - A layout by name uses that one, whatever your role's default is.
   - **Full sidebar** shows every page your role can open.

Your pick is saved to your account, so it follows you to any browser or phone.

## Which page opens first

1. Your own start page, if you chose one under **Start page** in the user menu.
2. Otherwise, the start page of your layout.
3. Otherwise, the Dashboard.

The start page only opens if it is in your sidebar. The **Start page** list offers only the pages your layout shows.

## For administrators: make a layout

1. Open **Settings**, then **Layouts**.
2. Open the ⋯ menu at the top right and choose **New layout**.
3. Give it a **Name**.
4. Tick the **Pages** it shows.
5. Pick a **Start page** from the ticked pages, or leave it on Dashboard.
6. Under **Default for roles**, tick each role that should get this layout by default. A role has one default. Ticking a role here moves it off any other layout.
7. Open the sheet's ⋯ menu and choose **Save**.

To change or remove a layout, use the ⋯ menu on its row. Deleting asks first. Users who picked a deleted layout go back to their role default.

A user with several roles gets the default of the first of those roles in the order the Roles page lists them.

You need the `settings.edit_general` capability to change layouts. Every signed-in user can see the list, because the user menu offers it. Each change is recorded in the audit log as `layout.create`, `layout.update` or `layout.delete`.

## From the command line

```bash
openldr layouts list
```

```bash
openldr layouts set Bench --pages /forms,/patients --start-page /forms --roles lab_technician
```

```bash
openldr layouts delete Bench --force
```

`set` creates the layout, or replaces the one with that name. When it replaces one, a start page or roles you leave out keep their current value. `--start-page none` clears the start page.

To set one user's pick:

```bash
openldr user preferences set <user-id> layout full
```

Use a layout id, `full` for the full sidebar, or `none` to go back to the role default.
