# Layouts

A layout is a named sidebar. Administrators choose its pages and optional start page, then make it a default for selected roles. Each person can choose another layout through their user menu.

A layout only hides pages. It never grants permission to open them. Docs remains available. Your role still controls access.

Use page selections that suit your staff. The pictures use a temporary Documentation review layout in a test installation. No sample data is required.

Edit general settings allows creating, editing and deleting layouts. View roles allows reading the role choices for defaults. Anyone signed in can choose an available layout.

## Create a sidebar for a team

Use this when a team needs a shorter sidebar and a suitable first page. Choose pages based on their work.

### 1. Open Settings and Layouts

Open your user menu at the bottom left, choose **Settings**, then select **Layouts**.

![Open your user menu at the bottom left.](layouts-guide-user-menu.png)

![Choose Settings.](layouts-guide-settings-menu.png)

![Select Layouts in Settings.](layouts-guide-layouts-page.png)

### 2. Choose New layout

Open the page dots at the top right and select **New layout**.

![Open the Layouts dots menu.](layouts-guide-page-actions.png)

![Choose New layout.](layouts-guide-new-layout.png)

### 3. Name the layout

Enter a clear **Name**. The example uses `Documentation review`.

![Name the layout for its intended use.](layouts-guide-name.png)

### 4. Choose the pages

Select the pages this sidebar should show. Choose at least one. Docs always remains available and is not a checkbox.

![Select the pages this sidebar should show. Docs always remains available.](layouts-guide-pages.png)

### 5. Choose the start page

Open **Start page** and choose a selected page. The example chooses Reports. The default option is Dashboard.

![Choose the page that should open first. Only selected pages are offered.](layouts-guide-start-page.png)

### 6. Choose any role defaults

Under **Default for roles**, select the roles that should use this layout by default. Leave them clear if people will choose it themselves.

![Optionally make this layout the default for selected roles.](layouts-guide-role-default.png)

### 7. Save the layout

Open the editor dots at the top right and select **Save**.

![Open the layout editor dots.](layouts-guide-sheet-actions.png)

![Choose Save.](layouts-guide-save-layout.png)

**Expected result:** The table shows the saved layout, page count, start page and role defaults.

![The table shows the saved page count, start page and role default.](layouts-guide-created-result.png)

## Change an existing layout

Use this when a team needs a different set of pages. Users who selected the layout receive its saved changes.

### 1. Open the row actions

Find the layout and select its row dots.

![Open the dots for the correct layout.](layouts-guide-row-actions.png)

### 2. Choose Edit

Select **Edit**.

![Choose Edit.](layouts-guide-edit-layout.png)

### 3. Change its pages

Select or clear page checkboxes. The example adds **Activity**. Removing the selected start page clears that choice.

![Change the selected pages. The example adds Activity.](layouts-guide-edit-page.png)

### 4. Save the changes

Open the editor dots and select **Save**.

![Choose Save in the editor dots menu.](layouts-guide-edit-save.png)

**Expected result:** The table reflects the saved page selection.

![The page count reflects the changed selection.](layouts-guide-edited-result.png)

## Choose a layout for yourself

Use this when you prefer another available sidebar. Your personal choice overrides a role default.

### 1. Open your user menu

Select your user menu at the bottom left.

![Open your user menu to choose a sidebar.](layouts-guide-pick-user-menu.png)

### 2. Open Layout

Open **Layout**. This menu appears when at least one named layout exists.

![Open Layout.](layouts-guide-pick-layout-menu.png)

### 3. Choose the named layout

Select the layout you want. The example chooses **Documentation review**.

![Choose the named layout.](layouts-guide-pick-layout.png)

**Expected result:** The sidebar changes to the layout pages that your role can open. Docs stays visible. A personal Start page choice can override the layout start page.

![The sidebar shows the selected layout pages plus Docs.](layouts-guide-picked-result.png)

## Return to the role default or full sidebar

Use this when you want the administrator's role default again, or all pages your role permits.

### 1. Choose Role default

Open your user menu, then Layout. Select **Role default** to clear your personal layout choice. The menu names the current default in brackets.

![Role default follows the default set by administrators.](layouts-guide-role-default-option.png)

### 2. Choose Full sidebar when needed

To show every permitted page, open the same Layout menu and select **Full sidebar**.

![Choose Full sidebar to show all pages your permissions allow.](layouts-guide-full-sidebar.png)

**Expected result:** The full sidebar returns. Permissions still decide which pages appear.

![The full sidebar returns, subject to your role permissions.](layouts-guide-full-result.png)

## Remove an unused layout

Use this when a named sidebar is no longer needed. Check the affected role defaults before deleting it.

### 1. Choose Delete

Open the correct layout's row dots and select **Delete**.

![Choose Delete for the correct layout.](layouts-guide-delete-layout.png)

### 2. Confirm the fallback

Check the layout name. People who chose it return to their role default. Roles using it lose that default. Select **Delete layout** to confirm.

![Check the layout name and fallback behaviour before confirming.](layouts-guide-delete-confirm.png)

**Expected result:** The layout disappears from the list.

![The layout is removed from the list.](layouts-guide-deleted-result.png)

## Edit layouts on a phone

Use the same Layouts page on a phone. The Settings section list scrolls horizontally.

### 1. Open Layouts

Select **Layouts** in the Settings section list.

![Use Layouts in the horizontal Settings section list on a phone.](layouts-guide-phone-layouts.png)

### 2. Open the editor

Open the layout row dots and choose Edit. Scroll the sheet to reach page and role choices.

![The layout editor uses the phone width. Scroll to reach pages and role defaults.](layouts-guide-phone-editor.png)

## Optional practice

In a test installation, create `Documentation review` with Dashboard, Reports and Forms. Choose Reports as its start page. Try it through the user menu, restore Full sidebar, then delete the test layout.

## Limits

Layouts do not grant permissions or change the underlying data. Sidebar pages keep their standard order. Personal layout and start-page choices can override a role default.

## Troubleshooting

**A selected page does not appear.** Check whether your role can open it. Adding a page to a layout does not grant access.

**The expected first page does not open.** Check your personal Start page choice in the user menu.

**Role defaults cannot be read.** The editor keeps existing defaults. Ask an administrator with View roles to review them.

## Related guides

Read [Roles](/docs/roles) for page permissions. Read [User preferences](/docs/user-preferences) for personal choices. Read [Start here](/docs/start-here) for command-line setup.
