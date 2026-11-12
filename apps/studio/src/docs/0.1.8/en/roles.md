# Roles

A role groups capabilities, which are permissions for specific actions. Assign roles to people in Users. The Users sheet assigns one role per person.

Use your own role names and access requirements. The pictures show a temporary Documentation reader role in an isolated test installation. No practice data is required.

You need View roles to inspect roles, and Manage roles to create, change, delete or assign them. Opening Users also requires View users. Creating or editing identity details requires Manage users. Administrator is locked. Other system roles can be edited, but cannot be deleted.

For installation and command-line setup, read [Start here](/docs/start-here). This guide covers the Roles page.

## Inspect a role before changing access

Use this to check which actions an existing role grants.

### 1. Open Settings and Roles

Open your user menu at the bottom left, choose **Settings**, then select **Roles**.

![Open your user menu at the bottom left.](roles-guide-open-user-menu.png)

![Choose Settings in your user menu.](roles-guide-settings-menu.png)

![Select Roles in the Settings section list.](roles-guide-roles-page.png)

### 2. Open the role

Select a role row. Read its name, description and selected capabilities. Scroll the sheet to read each permission.

![Read the role name, description and selected capabilities.](roles-guide-inspect-role.png)

### 3. Check whether it is locked

The built-in Administrator displays a warning and read-only fields. Select **Close** at the top right when finished.

![Administrator is locked. Its capabilities cannot be changed.](roles-guide-locked-role.png)

**Expected result:** Reading a role does not change its permissions.

## Create a role with selected permissions

Use this when existing roles do not match the access your staff need. Decide the required actions before selecting capabilities.

### 1. Open the page actions

Select the dots above the Roles table.

![Open the Roles dots menu.](roles-guide-create-actions.png)

### 2. Choose Create role

Select **Create role**.

![Choose Create role.](roles-guide-create-menu.png)

### 3. Enter the name

Use a name your team recognises. The example uses `Documentation reader`.

![Enter a name describing this role.](roles-guide-name.png)

### 4. Check the slug

The **Slug** is the role identifier. The name fills it automatically until you edit it. Choose it carefully because you cannot change it after creation.

![Check the identifier. It becomes read-only after creation.](roles-guide-slug.png)

### 5. Describe the role

Enter its purpose in **Description**. This helps other administrators understand who should receive it.

![Describe who should use this role.](roles-guide-description.png)

### 6. Select the capabilities

Turn on each permission the role needs. Read the description beside each switch. The example selects **View dashboards**.

![Choose each permission the role needs. The example allows viewing dashboards.](roles-guide-capability.png)

### 7. Open the sheet actions

Select the dots at the top of the Create role sheet.

![Open the role sheet dots menu.](roles-guide-sheet-actions.png)

### 8. Create the role

Select **Create**.

![Choose Create to save the role.](roles-guide-create-save.png)

**Expected result:** The sheet closes and the role appears in the list. Creating a role does not assign it to anyone. Use Users to assign it.

![The created role appears with its description and member count.](roles-guide-created-result.png)

## Change a role description or permissions

Use this when the responsibilities of people holding a role change. Check who holds it before changing access.

### 1. Find the role

Enter its name in **Search roles**. The example searches `Documentation`.

![Use Search roles to find a role by name.](roles-guide-search.png)

### 2. Open the row actions

Select the dots on the matching role row.

![Open the dots on the matching role.](roles-guide-row-actions.png)

### 3. Choose Edit

Select **Edit**. Selecting the row opens the same sheet.

![Choose Edit to change its description or permissions.](roles-guide-edit-menu.png)

### 4. Update its description

Change **Description** if its purpose has changed. You may also change Name. Slug stays read-only.

![Update the description. The slug stays read-only.](roles-guide-edit-description.png)

### 5. Adjust individual permissions

Turn capabilities on or off. The example adds **View reports**.

![Enable or disable individual capabilities.](roles-guide-edit-capability.png)

### 6. Save the role

Open the sheet dots and select **Save**.

![Choose Save to keep the changes.](roles-guide-edit-save.png)

**Expected result:** The list shows the saved description. Users assigned this role receive its permissions.

![The updated description appears in the role row.](roles-guide-edited-result.png)

## Delete a custom role

Use this only when people should lose the permissions this role grants. System roles cannot be deleted.

### 1. Choose Delete

Find the role and open its row dots. Select **Delete**.

![Delete is available for a custom role.](roles-guide-delete-menu.png)

### 2. Confirm the role and effect

Read the confirmation. Members lose the capabilities granted by this role. Select **Delete** to confirm, or **Cancel** to keep it.

![Check the role name and the effect on its members before confirming.](roles-guide-delete-confirm.png)

**Expected result:** The role disappears. Deletion cannot be undone. Check affected users after removing a role.

![The deleted role no longer matches the search.](roles-guide-deleted-result.png)

## Inspect roles on a phone

Use the same Roles page on a phone. Wide table columns can require horizontal scrolling.

### 1. Search for the role

Enter its name in **Search roles**.

![Search roles on a phone. The table can scroll horizontally.](roles-guide-phone-search.png)

### 2. Open its settings

Select the role row. Scroll the sheet to read its description and capabilities. Select **Close** at the top right to return.

![The role sheet uses the phone width. Scroll to inspect its capabilities.](roles-guide-phone-sheet.png)

## Optional practice

In a test installation, follow Create a role using `Documentation reader`. Select only View dashboards. Add View reports in the edit task, then delete the practice role when finished. Do not assign the practice role to real staff.

## Before changing access

Administrator is locked. Other system roles can be edited but cannot be deleted. A saved slug cannot be changed.

Creating a role does not assign it to anyone. Role assignments are managed on Users. Check the people affected before changing or deleting an assigned role.

## Troubleshooting

**The role is read-only.** Check whether you opened the locked Administrator role and whether your account has Manage roles.

**A new role does not change anyone's access.** Creating the role only stores its permissions. Use Users to assign the role to the intended person.

## Related guides

[Start here](/docs/start-here) explains the installed and development CLI. Users covers assigning roles to people.
