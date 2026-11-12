# Audit

Audit records who performed an action, when it happened and which entity it affected. Administrators and reviewers use it to investigate changes and access events.

You need View audit log. Use the events already recorded by your installation. The pictures show changes to fictional accounts and layouts in a test installation. No sample data is required.

Audit is read-only. Reading an event does not change it. Before, After and Metadata appear only when that action recorded those values.

## Find events for an action

Use this when you know the kind of action you need to investigate. You can also filter by actor, entity or time.

### 1. Open Audit

Select **Audit** in the main menu.

![Select Audit in the main menu.](audit-guide-open-audit.png)

### 2. Read the list columns

Read **When**, **Actor**, **Action**, **Entity type** and **Entity ID**. An action such as user.update describes the recorded operation.

![Read When, Actor, Action and entity details before opening an event.](audit-guide-read-event-row.png)

### 3. Open Filter

Select **Filter** above the table.

![Use Filter to find an action or actor.](audit-guide-filter-open.png)

### 4. Add a rule

Select **Add filter**.

![Choose Add filter.](audit-guide-filter-add.png)

### 5. Choose Action

Open the column selector and choose **Action**. Keep **Equals** for an exact action name.

![Choose Action as the filter column.](audit-guide-filter-action.png)

### 6. Enter the action

Enter the action to inspect. The example uses `user.update` for profile changes. Use an action present in your own installation.

![Enter the action name. The example uses user.update.](audit-guide-filter-value.png)

### 7. Apply the filter

Select **Apply**.

![Choose Apply to request matching audit events.](audit-guide-filter-apply.png)

**Expected result:** The list shows matching events. An empty result means no event matches the current rules.

![The list contains matching user.update events.](audit-guide-filter-result.png)

## Read an event and its recorded values

Use this to identify the affected record and compare changes. Different actions record different details.

### 1. Open the event

Select the matching event row. Read the event identifier, timestamp, actor, action and affected entity in the sheet.

![Check Event ID, Timestamp, Actor and the affected entity.](audit-guide-event-identifiers.png)

### 2. Read Before

Scroll to **Before**. It contains previous values when the action supplied them. **None recorded.** means no snapshot was recorded.

![Before records the previous values when supplied by this action.](audit-guide-event-before.png)

### 3. Read After

Scroll to **After**. Compare the saved values with Before. These are recorded snapshots, not an editor.

![After records the saved values when supplied by this action.](audit-guide-event-after.png)

### 4. Read Metadata

Scroll to **Metadata** for any additional recorded context.

![Metadata contains additional context when the action records it.](audit-guide-event-metadata.png)

### 5. Copy an event reference when needed

Use **Copy Event ID** beside the identifier when recording a reference in your investigation. Other populated detail values also have copy controls.

![Use the copy control beside a value when recording an event reference.](audit-guide-event-copy.png)

### 6. Close the sheet

Select **Close** at the top right.

![Close returns to the filtered list.](audit-guide-event-close.png)

**Expected result:** You return to the same filtered event list. The audit record remains unchanged.

## Browse more events and refresh the list

Use this when you need events outside the current page or changes recorded after you opened Audit.

### 1. Clear the filter when needed

Open Filter and select **Clear** to return to all events.

![Clear removes the active filter rules.](audit-guide-filter-clear.png)

### 2. Choose a page size

Open **Rows per page** at the bottom and select a size. The example chooses **10**.

![Use Rows per page to change the number of events shown.](audit-guide-page-size.png)

![Choose the page size. The example chooses 10.](audit-guide-ten-rows.png)

### 3. Read the next page

Select **Next page** when it is enabled.

![Next page reads the next group of events.](audit-guide-next-page.png)

### 4. Return to the previous page

Select **Previous page**.

![Previous page returns to the preceding group.](audit-guide-previous-page.png)

### 5. Refresh the list

Open the page dots and select **Refresh**. The current filters still apply.

![Open the Audit page dots menu.](audit-guide-refresh-actions.png)

![Choose Refresh to request the current filtered list again.](audit-guide-refresh-menu.png)

**Expected result:** The table reads the requested page or refreshed events from the server.

## Read audit events on a phone

Use the same Audit page on a phone. The event table can scroll horizontally.

### 1. Use the filter controls

Use **Filter** above the table to narrow the results before reading wide rows.

![Filter remains available above the table on a phone.](audit-guide-phone-filter.png)

### 2. Open the event sheet

Select an event row. Scroll the sheet to read identifiers and snapshots.

![The event sheet uses the phone width and scrolls through recorded values.](audit-guide-phone-event.png)

## Optional practice

In a test installation, make an approved profile or layout change, then find its audit event. Compare the recorded Before and After values when present. No audit-data import is required.

## Limits

This page does not edit, delete or export audit events. A missing snapshot does not prove that an action made no change. It means that action recorded no snapshot.

## Troubleshooting

**No audit events match.** Review the active filter chips or choose Filter, then Clear.

**A recent event is absent.** Choose Refresh and check the current filters and page.

**Before or After says None recorded.** Use the actor, action, entity details and available metadata. That snapshot cannot be recovered through this page.

## Related guides

Read [Users](/docs/users) for account actions and [Roles](/docs/roles) for permissions. Read [Start here](/docs/start-here) for command-line setup.
