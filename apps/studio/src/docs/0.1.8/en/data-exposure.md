# Data Exposure

Data Exposure controls which additional table columns the dashboard builder offers. Administrators use it to hide columns or approve their availability. You need Manage data exposure.

This policy covers additional table columns in the dashboard builder. Built-in dimensions, raw SQL and connector-backed reports are outside it. Hiding a column here does not erase its data or remove database access.

The PII badge means personally identifiable information. Showing one of these columns requires an extra confirmation, then Save.

Use your own approved column policy. The pictures use an isolated test installation and restore the demonstrated columns afterward. No sample records are required.

## Hide an additional dashboard column

Use this when an additional column should no longer be offered in the dashboard builder.

### 1. Open Settings and Data Exposure

Open your user menu at the bottom left, choose **Settings**, then select **Data Exposure**.

![Open your user menu at the bottom left.](data-exposure-guide-user-menu.png)

![Choose Settings.](data-exposure-guide-settings-menu.png)

![Select Data Exposure in Settings.](data-exposure-guide-exposure-page.png)

### 2. Find the table group

Find the table containing the column. The example uses **Patient**. Match both the table and column name.

![Find the correct table group before changing a column.](data-exposure-guide-table-group.png)

### 3. Check the current state

Read **Shown** or **Hidden** beside the switch. The example starts with `managing_organization` Shown.

![Shown means the additional table column is offered in the dashboard builder.](data-exposure-guide-shown-column.png)

### 4. Turn the column off

Turn off its switch. The draft now says **Hidden**.

![Turn off the switch to mark the additional column Hidden.](data-exposure-guide-hide-column.png)

### 5. Check the unsaved indicator

**Unsaved changes** means the draft has not yet changed the stored policy.

![Unsaved changes means the policy has not yet been applied.](data-exposure-guide-unsaved.png)

### 6. Save the policy

Open the page dots at the top right and select **Save**.

![Open the Data Exposure page dots.](data-exposure-guide-page-actions.png)

![Choose Save to apply the column policy.](data-exposure-guide-save-hidden.png)

**Expected result:** The indicator clears. The saved column remains Hidden after reopening the page and is absent from additional builder columns.

![The saved column remains Hidden after reopening the page.](data-exposure-guide-hidden-result.png)

## Discard unsaved policy changes

Use this when you want to keep the saved policy after changing a switch.

### 1. Review the draft change

Check which switch you changed. The example has turned the hidden column back on without saving.

![Change a switch only to draft a new policy. This example has not been saved.](data-exposure-guide-discard-draft.png)

### 2. Choose Discard

Open the page dots and select **Discard**.

![Discard reloads the saved policy and removes draft changes.](data-exposure-guide-discard-menu.png)

**Expected result:** The page reloads the saved policy. The unsaved switch change disappears.

![The column returns to its saved Hidden state.](data-exposure-guide-discard-result.png)

## Approve showing a personally identifying column

Use this only after deciding that dashboard users should be able to use this additional column. The pictures use a test installation.

### 1. Check the PII label

Find the correct table and column. The example is `surname` in Patient, marked **PII** and Hidden.

![PII identifies columns containing personally identifiable information.](data-exposure-guide-pii-hidden.png)

### 2. Read and confirm the warning

Turn the switch on. Read the warning, then select **Un-hide** to approve the draft. Select Cancel to leave it hidden.

![Read the exposure warning before choosing Un-hide.](data-exposure-guide-pii-confirm.png)

### 3. Review the draft state

The column now says **Shown**. The policy still has unsaved changes.

![Confirming marks the column Shown in the draft. Save still applies it.](data-exposure-guide-pii-draft.png)

### 4. Save the approval

Open the page dots and select **Save**.

![Choose Save to apply the column policy.](data-exposure-guide-save-pii.png)

**Expected result:** The saved column is available among additional dashboard-builder columns.

![The saved personally identifying column is now Shown.](data-exposure-guide-pii-result.png)

## Hide a personally identifying column again

Use this when an approved identifying column should no longer be offered.

### 1. Turn the column off

Find the column and turn off its switch. The example hides `surname` again.

![Turn the personally identifying column off again when it should be hidden.](data-exposure-guide-rehide-pii.png)

### 2. Save the new policy

Open the page dots and select **Save**.

![Choose Save to apply the column policy.](data-exposure-guide-save-rehide.png)

**Expected result:** The column is Hidden in the saved policy. No identifying data was deleted.

## Show a column without a PII warning

Use this when a non-PII additional column should be available again.

### 1. Turn the column on

Find the correct column and turn on its switch. The example restores `managing_organization`.

![Turn on a non-PII column when it should be available again.](data-exposure-guide-show-normal.png)

### 2. Save the policy

Open the page dots and select **Save**.

![Choose Save to apply the column policy.](data-exposure-guide-restore-column.png)

**Expected result:** The saved column is available among additional dashboard-builder columns again.

## Review the policy on a phone

Use the same table groups and switches on a phone. Scroll vertically through the groups.

### 1. Find the table group

Find the correct group before changing a column.

![Scroll through table groups on a phone.](data-exposure-guide-phone-group.png)

### 2. Read the column and state

Check its name, any PII badge, and Shown or Hidden state before changing the switch. Save changes through the page dots.

![Read the column name, PII label and Shown or Hidden state before changing it.](data-exposure-guide-phone-column.png)

## Optional practice

Use a test installation. Hide a non-PII column, save, then restore it. Try Discard with an unsaved switch change. Only practise PII approval with fictional data and restore the intended policy afterward.

## Limits

This is not a database security boundary or a data-deletion tool. Built-in dimensions, raw SQL and connector-backed reports are outside this policy. Column changes remain drafts until Save.

## Troubleshooting

**The policy did not change.** Check Unsaved changes, then choose Save in the page dots.

**Discard is unavailable.** No unsaved switch change exists.

**A hidden field remains available elsewhere.** Check whether it is a built-in dimension, raw SQL field or connector-backed report field, which this policy does not govern.

## Related guides

Read [Dashboards](/docs/dashboard) for building widgets and [Roles](/docs/roles) for permissions. Read [Start here](/docs/start-here) for command-line setup.
