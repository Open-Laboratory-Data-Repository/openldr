# Setup checks

Setup checks reviews the services and settings this installation needs. Use it after installation or configuration changes, then follow the advice beside each warning or failure.

You need View settings. Changing a linked setting may need another permission. These checks use the same list as `openldr doctor`. Read [Start here](/docs/start-here) for command-line setup.

Use your own installation results. The pictures show an isolated development installation with deliberate missing configuration. No sample data is required.

## Read the current readiness report

Use this before treating an installation as ready for staff. The checks run when the page opens.

### 1. Open Settings and Setup checks

Open your user menu at the bottom left, choose **Settings**, then select **Setup checks**.

![Open your user menu at the bottom left.](setup-checks-guide-user-menu.png)

![Choose Settings.](setup-checks-guide-settings-menu.png)

![Select Setup checks in Settings.](setup-checks-guide-setup-page.png)

### 2. Read the summary

Read the number of failed checks and warnings. If neither exists, the summary says All checks passed.

![Read the counts of failed checks and warnings.](setup-checks-guide-summary.png)

### 3. Read failed checks first

Read the service detail and suggested next action. This test installation reports a blob-storage service failure. Follow the advice for your own result.

![Read the detail and next action beside a failed check.](setup-checks-guide-failed-service.png)

### 4. Read the warnings

A warning needs review even when the service is available. The example warns that Laboratory name still uses the shipped default.

![Read each warning before deciding whether the installation is ready.](setup-checks-guide-warning.png)

### 5. Check skipped items

**Skipped** means the check did not apply. It does not mean that an unused feature has been configured.

![Skipped means the check did not apply, not that its configuration passed.](setup-checks-guide-skipped.png)

**Expected result:** You know which checks need attention and which advice applies to this installation.

## Follow a warning and check the correction

Use a linked setting page to correct a problem. This example corrects a laboratory name and missing time zone on PostgreSQL.

### 1. Open the linked page

Select **Open Laboratory** beside the Laboratory name warning.

![Follow the check link to the setting that needs attention.](setup-checks-guide-open-laboratory.png)

### 2. Enter the laboratory name

Enter your actual issuing laboratory name. The picture uses `Documentation laboratory` in a test installation.

![Enter your actual laboratory name. This example uses a fictional test name.](setup-checks-guide-correct-name.png)

### 3. Set the time zone when applicable

For PostgreSQL or MySQL, enter your named local time zone. The example uses `Africa/Dar_es_Salaam`. On SQL Server, follow the page advice and supply the Windows zone in each report run instead.

![Use a named local time zone on PostgreSQL or MySQL.](setup-checks-guide-correct-zone.png)

### 4. Save the correction

Open the Laboratory page dots and select **Save**.

![Open the Laboratory dots menu.](setup-checks-guide-laboratory-actions.png)

![Choose Save to keep the corrected settings.](setup-checks-guide-laboratory-save.png)

### 5. Return to Setup checks

Select **Setup checks** in Settings. Opening it runs the checks again.

![Laboratory name and Time zone now show Passed.](setup-checks-guide-corrected-result.png)

**Expected result:** The corrected Laboratory name and Time zone checks show Passed. Other warnings or failures still need attention.

## Run the checks again

Use this after configuration changes or after a service recovers.

### 1. Open the page actions

Select the dots at the top right of Setup checks.

![Open the Setup checks dots menu.](setup-checks-guide-setup-actions.png)

### 2. Choose Run again

Select **Run again**. Wait for the checks to finish.

![Choose Run again after making a correction.](setup-checks-guide-run-again.png)

**Expected result:** The new summary shows the current result. Read the remaining failed checks and warnings.

![Read the new summary and address any remaining failed checks or warnings.](setup-checks-guide-rerun-result.png)

## Load sample data

Use this to try OpenLDR on a new install. It loads the same sample data as the sample data step in [First run](/docs/first-run). The menu offers it only while the install holds no lab data. You need the Danger zone permission. Administrator has it.

### 1. Open the page actions

Select the dots at the top right of Setup checks.

### 2. Choose Load sample data

Select **Load sample data**. A box opens with the title **Sample data** and a sentence on what it holds.

### 3. Confirm

Select **Load sample data** in the box. To leave without loading, select **Cancel**. While it loads, the page shows **Loading sample data…**.

**Expected result:** the checks run again. **Load sample data** is no longer in the menu, because the install now holds lab data.

## Read setup checks on a phone

Use the same page on a phone. Each check includes its status and advice.

### 1. Read the summary

Open Setup checks and read the summary at the top.

![Read the summary at the top on a phone.](setup-checks-guide-phone-summary.png)

### 2. Scroll through the checks

Read each check detail and any link or next action.

![Scroll through each check to read its detail and guidance.](setup-checks-guide-phone-check.png)

## Optional practice

No practice records are required. In a test installation, correct a genuine laboratory-name or time-zone warning, save it, then run the checks again. Do not introduce a service failure for this exercise.

## Limits

The report describes the checks at the time they ran. All checks passed does not prove every report, feed or staff workflow. Some repairs need server configuration outside Studio.

## Troubleshooting

**The checks could not run.** Check the API connection and server log, then try Run again.

**Services failed.** Follow the displayed health-command advice and inspect the named service.

**Sign-in warns that it is switched off.** Turn off the development authentication bypass in server configuration before real use.

**Sign-in warns that no administrator exists yet.** The install uses OpenLDR's own sign-in, and nobody has finished setup. `openldr doctor` prints `No administrator exists yet. Run "openldr auth setup-code", then open studio to create one.` Studio shows its **Create the administrator** page until then, not this page. See [Sign-in and passwords](/docs/sign-in).

**A linked page is unavailable.** Ask an administrator with permission to edit that setting.

**Load sample data is not in the menu.** The install already holds lab data, or your role does not have the Danger zone permission. A patient, a lab request, a specimen, a result, a saved form response, an organization or a location counts as lab data.

**Sample data could not be loaded:** followed by a reason. The load did not finish. Some sample data may already be in place, and then the menu no longer offers it. The server log has the reason.

## Related guides

Read [Laboratory](/docs/laboratory) for issuing-lab details. Read [Connectors](/docs/connectors) for connection tests. Read [Start here](/docs/start-here) for installation and command-line setup. Read [First run](/docs/first-run) for the steps after the first administrator is made.
