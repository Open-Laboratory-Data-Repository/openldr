# Settings

General settings shows application information, optional capabilities and runtime limits. It also contains data-validation settings and destructive maintenance actions.

You need View settings to open General. Edit general settings allows numeric limits and validation changes. Manage feature flags allows optional-capability switches. Danger zone allows destructive maintenance.

Use your own approved operational choices. The pictures show an isolated test installation. The destructive examples ran only against that disposable installation, after verifying its database and identity-provider ownership. No practice data is required.

Use the linked pages in Settings for Laboratory, Setup checks, Connectors, Roles, Layouts and Data Exposure. This guide covers General. Read [Start here](/docs/start-here) for command-line setup.

## Read the running version and update state

Use this when reporting a problem or deciding whether to schedule an upgrade.

### 1. Open Settings and General

Open your user menu at the bottom left, choose **Settings**, then select **General**.

![Open your user menu at the bottom left.](settings-guide-user-menu.png)

![Choose Settings.](settings-guide-settings-menu.png)

![Select General in Settings.](settings-guide-general-page.png)

### 2. Read About

Read the running **Version**, environment and configured services in About.

![About shows the running version and configured services.](settings-guide-about.png)

### 3. Read Latest

Read **Latest** and the last-check time. Use available release-note and upgrade-procedure links when planning an upgrade. This page does not install updates.

![Read the Latest value and the time of the last update check.](settings-guide-update-state.png)

**Expected result:** You have the running version and the server's current update-check result.

## Change automatic update checks

Use this when deciding whether this server should check for available releases.

### 1. Change Auto update check

Turn **Auto update check** on or off in About. The change saves immediately.

![Auto update check changes whether this server checks for available releases.](settings-guide-update-switch.png)

### 2. Read the resulting state

When off, Latest says **update check is off**. Turning it on allows checks again. It does not upgrade the installation.

![Turning it off is reflected in Latest. It does not install an update.](settings-guide-update-off.png)

**Expected result:** The update-check choice is saved.

## Enable or disable an optional capability

Use this after deciding which optional capabilities the installation should offer. Read the description before changing a switch.

### 1. Change the feature flag

In **Feature Flags**, turn the required switch on or off. The example turns on **Dashboard raw SQL**.

![Turn the optional capability on or off. This example enables Dashboard raw SQL.](settings-guide-flag.png)

### 2. Check the save message

The change saves immediately. Check the **Saved** message. There is no separate Save button for feature flags.

![Feature flag changes save immediately.](settings-guide-flag-saved.png)

**Expected result:** The new flag applies immediately. The example restored its original off state after capture.

## Change a runtime limit

Use this when you need to tune an operational limit without restarting. Read the setting description and choose a value for your workload.

### 1. Enter the value

In **Limits & tuning**, enter the intended number. The example changes **Dashboard SQL row cap** to `5000`.

![Enter the intended runtime limit. This example sets a row cap of 5000.](settings-guide-number-value.png)

### 2. Leave the field to save

Select another field or press Tab. Leaving the number field saves it. The server limits values to the accepted range.

![Leaving the number field saves the value.](settings-guide-number-saved.png)

### 3. Check the saved value

Reopen General when you need to confirm persistence. Read the value the server kept.

![The saved numeric limit remains after reopening General.](settings-guide-number-reopened.png)

**Expected result:** The numeric limit remains saved after reopening General.

## Change incoming-data validation

Use this when changing which incoming lab data the installation accepts. Raising strictness may reject previously accepted data. Lowering it permits more incomplete data.

### 1. Open Data validation

Scroll to **Danger Zone** and open **Data validation**.

![Open Data validation in Danger Zone.](settings-guide-validation-menu.png)

### 2. Choose the level

Choose Low, Medium or High as required. The example changes High to **Medium**.

![Choose the required level. The example changes it to Medium.](settings-guide-validation-level.png)

### 3. Read the effect

Read the confirmation warning for the direction of your change.

![Read how the new validation strictness affects incoming data.](settings-guide-validation-warning.png)

### 4. Type the confirmation phrase

Enter the exact lowercase level shown in the prompt. The example types `medium`.

![Type the lowercase phrase shown in the confirmation.](settings-guide-validation-phrase.png)

### 5. Apply the change

Select **Apply**. Select Cancel to keep the previous level.

![Choose Apply to save the new strictness.](settings-guide-validation-apply.png)

**Expected result:** Data validation displays the saved level.

![Data validation now displays the saved Medium level.](settings-guide-validation-result.png)

## Reset all dashboards to the sample

Use this only when every dashboard should be removed and the built-in sample restored. This cannot be undone.

### 1. Open the action dots

In Danger Zone, select the dots beside **Reset dashboards**.

![Open the dots beside Reset dashboards.](settings-guide-reset-dashboards-actions.png)

### 2. Choose Reset

Select **Reset**.

![Choose Reset.](settings-guide-reset-dashboards-menu.png)

### 3. Read what the action removes

Check the confirmation title and warning. Cancel if the action does not match your intent.

![Read what Reset dashboards removes before confirming.](settings-guide-reset-dashboards-warning.png)

### 4. Type the exact phrase

Enter `reset dashboards` exactly as shown.

![Type the exact confirmation phrase shown by the app.](settings-guide-reset-dashboards-phrase.png)

### 5. Confirm Reset

Select **Reset** to perform the operation. Wait for completion.

![Confirm Reset only for the intended operation.](settings-guide-reset-dashboards-confirm.png)

**Expected result:** Every dashboard is deleted and the built-in sample is recreated.

![The page reports completion of Reset dashboards.](settings-guide-reset-dashboards-result.png)

## Clear audit events and workflow run history

Use this only when the audit trail and workflow run history should be permanently removed. This cannot be undone.

### 1. Open the action dots

In Danger Zone, select the dots beside **Clear audit log**.

![Open the dots beside Clear audit log.](settings-guide-clear-audit-actions.png)

### 2. Choose Clear

Select **Clear**.

![Choose Clear.](settings-guide-clear-audit-menu.png)

### 3. Read what the action removes

Check the confirmation title and warning. Cancel if the action does not match your intent.

![Read what Clear audit log removes before confirming.](settings-guide-clear-audit-warning.png)

### 4. Type the exact phrase

Enter `clear audit` exactly as shown.

![Type the exact confirmation phrase shown by the app.](settings-guide-clear-audit-phrase.png)

### 5. Confirm Clear

Select **Clear** to perform the operation. Wait for completion.

![Confirm Clear only for the intended operation.](settings-guide-clear-audit-confirm.png)

**Expected result:** Old audit events and workflow run history are removed. The clear operation itself writes a new audit event.

![The page reports completion of Clear audit log.](settings-guide-clear-audit-result.png)

## Restore internal factory defaults

Use this only when all internal application data should be wiped and reseeded. It removes forms, connectors, dashboards, workflows, terminology, local users, audit data and other internal records. This cannot be undone.

### 1. Open the action dots

In Danger Zone, select the dots beside **Factory reset**.

![Open the dots beside Factory reset.](settings-guide-factory-reset-actions.png)

### 2. Choose Factory reset

Select **Factory reset**.

![Choose Factory reset.](settings-guide-factory-reset-menu.png)

### 3. Read what the action removes

Check the confirmation title and warning. Cancel if the action does not match your intent.

![Read what Factory reset removes before confirming.](settings-guide-factory-reset-warning.png)

### 4. Type the exact phrase

Enter `factory reset` exactly as shown.

![Type the exact confirmation phrase shown by the app.](settings-guide-factory-reset-phrase.png)

### 5. Confirm Factory reset

Select **Factory reset** to perform the operation. Wait for completion.

![Confirm Factory reset only for the intended operation.](settings-guide-factory-reset-confirm.png)

**Expected result:** The internal database is wiped and factory defaults are reseeded. External target data and identity-provider accounts are outside this reset.

![The page reports completion of Factory reset.](settings-guide-factory-reset-result.png)

## Read General settings on a phone

Use the same General page on a phone. The page scrolls vertically.

### 1. Read About

Read the version and update information near the top.

![Read the General information on a phone.](settings-guide-phone-about.png)

### 2. Scroll to the limits

Read the field description before changing a numeric limit.

![Scroll to the runtime limits. The controls remain within the phone width.](settings-guide-phone-limit.png)

### 3. Read Danger Zone carefully

Scroll to the action and read its description before opening the dots.

![Scroll to Danger Zone and read the action description before opening its dots.](settings-guide-phone-danger.png)

## Optional practice

Use a disposable test installation. Change one reversible flag or numeric limit, confirm it saved, then restore it. Do not practise destructive maintenance against staff data.

## Limits

Update checking does not install a release. Feature switches save immediately. Numeric fields save when you leave them. Destructive actions affect the internal database and cannot be undone through this page.

## Troubleshooting

**A control is absent.** Check the separate permission for feature flags, general edits or Danger Zone actions.

**A numeric value changed after saving.** The server clamps it to the accepted range. Read the saved value.

**A confirmation stays disabled.** Type the exact phrase displayed by the prompt.

**Latest cannot confirm an update.** Read the displayed last-check error and resolve the server's outbound connection before relying on the result.

## Related guides

Read [Setup checks](/docs/setup-checks) for readiness and [Laboratory](/docs/laboratory) for issuing-lab details. Read [Audit](/docs/audit) to inspect recorded administration actions.
