# First run

First run is three short steps that Studio shows straight after you create the first administrator. You name your laboratory, load sample data if you want it, and review the setup checks that need attention. It is for the person who sets up a new install.

First run appears once, only on an install that uses OpenLDR's own sign-in. Only the person who created the first administrator sees it, in the window or browser tab where they did so. You can skip the first two steps. Later, you can review the same checks and load sample data under Settings → Setup checks.

## Name your laboratory

The laboratory name appears on reports as the issuing laboratory. Reports use this time zone to decide which day each record belongs to. The page shows **Step 1 of 3** and **Name your laboratory**.

1. In **Laboratory name**, type your laboratory's name, such as `Central Hospital Laboratory`.
2. Select **Time zone**. Studio starts with your computer's time zone.
3. In **Search time zones**, type part of the zone's name, such as `Dar`.
4. Choose the zone, such as `Africa/Dar_es_Salaam`.
5. Select **Save**.

**Expected result:** the next step opens. It is **Sample data**, or **OpenLDR is ready** when Studio does not offer sample data.

To leave the name and time zone as they are, select **Skip** instead of **Save**. You can set both later. See [Laboratory](/docs/laboratory).

## Load sample data

The page says what sample data holds: **Sample data adds 60 fictional lab orders, 39 of them with results, and an example dashboard, so you can try OpenLDR before your own data arrives. There is no way to remove only the sample records later. Do not load sample data on an installation meant for real patient data.**

1. On **Sample data**, select **Load sample data**.
2. Wait while the page shows **Loading sample data…**.

**Expected result:** **OpenLDR is ready** opens.

To go on without it, select **Skip**.

Studio offers sample data only while the install holds no lab data. A patient, a lab request, a specimen, a result or a saved form response counts as lab data. So does an organization or a location. The demo patient, organization and location that a Docker install creates when it first starts do not count. Once one exists, this step does not appear, and a second load is refused.

If you skip it, you can load it later from the dots menu under Settings → Setup checks, while the install still holds no lab data. See [Setup checks](/docs/setup-checks).

## Review the setup checks

The last step lists the setup checks that show a warning or a failure. Passed and skipped checks are left out.

1. Wait while the page shows **Running setup checks…**.
2. Read each check, its status and its advice.
3. To fix one now, select its link, such as **Open Laboratory**.
4. Otherwise, select **Continue to OpenLDR**.

**Expected result:** Studio opens. A link opens that page instead. Either way, first run ends and does not appear again.

When no check shows a warning or a failure, the page says **All setup checks passed. You can review them at any time under Settings → Setup checks.**

## Limits

- First run appears only with OpenLDR's own sign-in. An install that signs in through Keycloak or another provider never shows it. Use [Setup checks](/docs/setup-checks) there.
- It appears once. After **Continue to OpenLDR**, a link, or signing out, it does not come back.
- A reload of the page in the middle starts first run again from step 1. A name you saved stays saved. Closing that tab in the middle ends first run for good.
- Sample data is offered only while the install holds no lab data.
- The 60 sample orders and their results stay once loaded. No action removes only them. **Factory reset**, in **Danger Zone**, leaves them in place. `openldr db reset --force` removes them, but it also erases all other data in both databases.
- If this installation later sends its data to a central server, the sample orders are sent with it.

## Troubleshooting

- **The sample data step did not appear.** The install already holds lab data, or Studio could not ask the server. Open Settings → Setup checks, and look for **Load sample data** in its dots menu.
- **Could not save the laboratory details:** followed by a reason. Select **Save** again. Or select **Skip** and set the name later under Settings → Laboratory.
- **Could not load sample data:** followed by a reason. The load did not finish. Some sample data may already be in place. A second try is then refused, so select **Skip**. The server log names the error.
- **Could not run the setup checks:** followed by a reason. Select **Continue to OpenLDR**. Then open Settings → Setup checks and select **Run again** from its dots menu.

## Related guides

- [Sign-in and passwords](/docs/sign-in)
- [Setup checks](/docs/setup-checks)
- [Laboratory](/docs/laboratory)
