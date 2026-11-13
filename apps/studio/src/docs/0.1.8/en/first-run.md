# First run

First run is three short steps that Studio shows straight after you create the first administrator. You name the laboratory, load sample data if you want it, and see which setup checks still need you. It is for the person who sets up a new install.

First run appears once, only on an install that uses OpenLDR's own sign-in. Only the person who created the first administrator sees it, in the window where they did so. You can skip the first two steps. Settings, Setup checks keeps the same list afterwards, and can load sample data later.

## Name the laboratory

Reports print this name as the issuing laboratory. Days are counted in this time zone. The page shows **Step 1 of 3** and **Name the laboratory**.

1. In **Name**, type your laboratory's name, such as `Central Hospital Laboratory`.
2. Select **Time zone**. Your computer's time zone is chosen at first.
3. In **Search time zones**, type part of the zone's name, such as `Dar`.
4. Choose the zone, such as `Africa/Dar_es_Salaam`.
5. Select **Save**.

**Expected result:** the next step opens. It is **Sample data**, or **You are ready** when Studio does not offer sample data.

To leave the name and time zone as they are, select **Skip** instead of **Save**. You can set both later. See [Laboratory](/docs/laboratory).

## Load sample data

The page says what sample data is: **Sample data is a made-up patient and laboratory with example forms, workflows and dashboards, so you can try OpenLDR before real data arrives.**

1. On **Sample data**, select **Load sample data**.
2. Wait while the page shows **Loading sample data…**.

**Expected result:** **You are ready** opens.

To go on without it, select **Skip**.

Studio offers sample data only while the install holds no lab data. A patient, a lab request, a specimen, a result or a saved form response counts as lab data. So does an organization or a location. Once one exists, this step does not appear, and a second load is refused.

If you skip it, you can load it later from the dots menu in Settings, Setup checks, while the install still holds no lab data. See [Setup checks](/docs/setup-checks).

## See what still needs you

The last step lists the setup checks that show a warning or a failure. Passed and skipped checks are left out.

1. Wait while the page shows **Running the setup checks…**.
2. Read each check, its status and its advice.
3. To fix one now, select its link, such as **Open Laboratory**.
4. Otherwise, select **Open OpenLDR**.

**Expected result:** Studio opens. A link opens that page instead. Either way, first run ends and does not appear again.

When nothing needs you, the page says **Nothing needs you now. Settings, Setup checks keeps the full list.**

## Limits

- First run appears only with OpenLDR's own sign-in. An install that signs in through Keycloak or another provider never shows it. Use [Setup checks](/docs/setup-checks) there.
- It appears once. After **Open OpenLDR**, a link, or signing out, it does not come back.
- A reload of the page in the middle starts first run again from step 1. A name you saved stays saved.
- Sample data is offered only while the install holds no lab data.

## Troubleshooting

- **The sample data step did not appear.** The install already holds lab data, or Studio could not ask the server. Open Settings, Setup checks, and look for **Load sample data** in its dots menu.
- **The laboratory could not be saved:** followed by a reason. Select **Save** again. Or select **Skip** and set the name later in Settings, Laboratory.
- **Sample data could not be loaded:** followed by a reason. The load did not finish. Some sample data may already be in place, and then the install counts as holding lab data, so Studio does not offer the load again. The server log has the reason.
- **The setup checks could not run:** followed by a reason. Select **Open OpenLDR**. Then open Settings, Setup checks and select **Run again** from its dots menu.

## Related guides

- [Sign-in and passwords](/docs/sign-in)
- [Setup checks](/docs/setup-checks)
- [Laboratory](/docs/laboratory)
