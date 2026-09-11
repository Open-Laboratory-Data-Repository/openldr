# First pass: navigating Studio through its docs

21 areas reviewed: 11 scored at least 8/10; 10 scored below 8/10.

Overall judgment: **7/10**. I could find most pages and their first actions. Several guides stopped matching the screen at an important decision. Activity and Data Exposure lacked discoverable task guidance.

Review date: 11 September 2026. Entry point: <http://localhost:5173/studio>. Session: dev-admin, with authentication bypass active. The visible documentation version was 0.1.0.

## Scores and coverage

These scores measure how confidently a new user can navigate using the visible docs. They do not measure correctness of stored data, authorization, or completed transactions. An 8 means the inspected journey was intuitive. Scores of 6 or 7 mean I needed inference or extra exploration. Scores of 4 or 5 mean important instructions were missing or contradicted the screen.

| Area | Score | What I inspected | Finding |
|---|---:|---|---|
| Docs / Start Here | 7 | Navigation, search, opening a screenshot, related links | F01 |
| Dashboard | 8 | Sample dashboard, Edit, Add widget, preview and Editor menu | None below threshold |
| Reports | 8 | Loaded library, selecting Test Volume Over Time, Parameters and disabled Run | None below threshold |
| Report Designer | 6 | New unsaved template, canvas controls, action menu and guide | F02 |
| Query | 8 | Explorer, connector expansion, new query, parameters/save/run controls | None below threshold |
| Workflows | 7 | List, existing Ingest graph, initial framing and Fit View | F03 |
| Terminology | 8 | Publishers, local code system, terms, Actions → Term submenu | None below threshold for browsing |
| Facilities | 5 | Empty registry, New facility form, manual-entry and import documentation | F04 |
| Forms | 8 | Published forms list, row actions and Lab order capture fields | None below threshold for this limited journey |
| Users | 7 | List, row actions, loaded Edit user form and role selector | F05 |
| Audit | 9 | Event list, detail sheet, identifiers and before/after panels | None below threshold |
| Activity | 4 | Empty state, columns, action menu, docs searches | F06 |
| Settings / General | 8 | Finding Settings, About, feature-flag and danger-zone descriptions | None below threshold for orientation |
| Settings / Laboratory | 7 | Identity fields, facility register, time-zone help and docs coverage | F07 |
| Settings / Notifications | 8 | Event switches and minimum-priority selector | None below threshold for orientation |
| Settings / Sites | 8 | Page location, list controls and corresponding enrollment guide | None below threshold for orientation |
| Settings / Distributed sync | 8 | Settings fields, disabled engine, Activity tab and guide | None below threshold for orientation |
| Settings / Connectors | 6 | Add connector, default category, Host category and database fields | F08 |
| Settings / Marketplace | 8 | Browse, tabular artifact details, permissions and Details menu | None below threshold for inspection |
| Settings / Roles | 6 | Role list, descriptions, assignment guide checked against Users | F05 |
| Settings / Data Exposure | 5 | Shown/Hidden fields, Save/Discard menu and docs search | F09 |

## Findings below 8/10

All nine findings below concern behavior or text visible through the UI. Users and Roles share one finding. Each includes a check that could have disproved it. No implementation cause is claimed.

| ID | Finding | Verdict | UI proof | Suggested scope |
|---|---|---|---|---|
| F01 | Start Here promises numbered screenshots but its opening screenshot has no callouts. | CONFIRMED | Docs → Start Here → open the main-navigation screenshot. | Annotate the first journey and correct the promise. |
| F02 | Report publishing instructions do not match the two available publishing actions. | CONFIRMED | Report Designer menu shows Publish revision and Create report from this design. | Explain both outcomes using current labels. |
| F03 | An existing workflow opens cropped, and the guide omits the Fit View recovery. | CONFIRMED | Ingest initially showed enlarged, cut-off nodes; Fit View revealed all six. | Add a canvas-orientation step. |
| F04 | Manual facility instructions describe two code fields absent from the inspected form. | CONFIRMED | New facility shows System and Facility code, not National code and Local code. | Reconcile the manual-entry procedure with the current form. |
| F05 | The Roles guide describes assignment checkboxes, but user editing shows a single selector. | CONFIRMED | Users → account actions → Edit → Role opens a single-choice list. | Document the available assignment interaction. |
| F06 | Activity has no discoverable guide explaining payload stages or the empty state. | CONFIRMED | Docs searches for activity and payload did not expose an Activity task guide. | Add a short Activity guide. |
| F07 | Laboratory settings lack a guide explaining the facility-register choice. | CONFIRMED | Laboratory has Facility register; Settings guide omits Laboratory and excludes uncovered settings. | Add identity/register setup guidance. |
| F08 | Connector instructions omit the category choice needed to reach database setup. | CONFIRMED | Add connector defaults to Plugin; database fields appear after choosing Host. | Add Category → Host before selecting database type. |
| F09 | Data Exposure has consequential switches but no searchable documentation for their scope. | CONFIRMED | Data Exposure lists Shown/Hidden switches; docs search for exposure returns No results. | Explain scope, save behavior and a verification procedure. |

### F01. Docs / Start Here, 7/10

The manual is visible in the main navigation. Its audience labels, search and screenshot lightbox help. However, Start Here promises numbered screenshots. The opening screenshot shows an older navigation layout without Facilities and contains no numbered pointers.

**Refutation check:** I opened the screenshot at 100% in its lightbox. The missing pointers were not merely too small in the embedded image.

**Why I hesitated:** the screenshot shows many controls but does not identify which one belongs to each step. The first journey also asks me to notice Run in Reports. The dedicated Reports guide is more useful because it names Actions → Parameters first.

**Documentation change:** use the current navigation screenshot. Number the Dashboard, Reports and Docs entries. Add a separate crop showing Reports → Actions → Parameters → Run. Explain once that Settings lives in the user menu at the bottom of the main sidebar. Keep each instruction beside the relevant image.

Evidence: [Start Here](http://localhost:5173/studio/docs/start-here) and [Reports guide](http://localhost:5173/studio/docs/reports).

### F02. Report Designer, 6/10

The guide says to choose Publish and then enter the report details. The live menu instead offers **Publish revision** and **Create report from this design**. A beginner cannot tell which makes the template available in Reports.

**Refutation check:** I opened the actual More actions menu on a new template. Both actions appeared. This was not a missing-permission state.

**Why I hesitated:** publishing a design revision and creating a runnable report sound similar. The guide uses one name for a decision the UI presents as two actions.

**Documentation change:** give these actions separate instructions, using their exact labels. Show what should appear in the template's status and the Reports library afterward. Provide one small example that starts with an existing saved query and reaches report creation. Explain where Preview and Save live in the menu.

I did not publish, export or create a report. I opened an unsaved template and later confirmed it was absent from the explorer after leaving and returning.

Evidence: [Report Designer](http://localhost:5173/studio/report-designer) and its [guide](http://localhost:5173/studio/docs/report-designer).

### F03. Workflows, 7/10

Opening the existing Ingest workflow initially showed enlarged nodes cut off at both sides. I could not read the process as a whole. Fit View made all six nodes visible, although their text then became small.

**Refutation check:** I used Fit View. The graph was present and connected. I am not reporting lost nodes or a broken workflow.

**Documentation change:** start the builder walkthrough with Fit View, zoom, pan and node selection. Annotate the bottom-left controls. Then show how to select one node while retaining enough context to understand its input and output. The guide currently jumps from opening the builder to adding nodes.

I did not change or run the Ingest workflow. This finding concerns orientation on the observed desktop, not execution.

Evidence: [Ingest workflow](http://localhost:5173/studio/workflows/wf-ingest) and [Workflows guide](http://localhost:5173/studio/docs/workflows).

### F04. Facilities, 5/10

The manual-entry section explains National code and Local code as separate optional fields. The loaded New facility form exposes **System** and one required **Facility code**. There is no visible instruction explaining which documented code belongs there.

The guide also opens with a lengthy national-register import discussion. Someone trying to add one facility must scroll past that before reaching manual entry. The visible Registry and Observed tabs do not receive an equivalent introductory walkthrough.

**Refutation check:** I opened Add facility and waited for the form to load. The fields were System, Facility code, Name, Country, Zone, Region, District, Council, Status and Level. The mismatch remained after loading.

**Documentation change:** begin with three tasks: add one facility, import a register, and inspect observed facilities. Give each its own short procedure. For manual entry, name the current fields and explain code identity before entry. Resolve the disagreement about the available code fields before adding illustrations. For imports, place the detailed mapping rules after a short Source → Mapping → Review walkthrough.

I did not enter or import a facility. I did not infer how the server stores the code.

Evidence: [Facilities](http://localhost:5173/studio/facilities) and [Facilities guide](http://localhost:5173/studio/docs/facilities), especially Registering a facility by hand.

### F05. Users, 7/10; Roles, 6/10

The Roles guide instructs me to tick every role in a Roles section. Edit user presents **Role**, a single selector. Opening it shows five alternatives, with Lab Technician selected for the inspected account. There are no assignment checkboxes.

**Refutation check:** I reopened the user, waited for loading, and expanded Role. The control still presented a single selection. I did not select another role.

**Why I hesitated:** following the guide to assign multiple roles was impossible through the described interaction. The Users guide also uses generic profile terms where the form shows First name and Last name.

**Documentation change:** reconcile the claimed assignment procedure with the current UI. Show the exact field and its limitations. Explain where Save is located. Keep capability explanations, which are useful, separate from the account-editing steps.

This does not establish whether multiple roles are supported internally. Authentication was bypassed, so effective access was not tested.

Evidence: [Users](http://localhost:5173/studio/users), [Users guide](http://localhost:5173/studio/docs/users) and [Roles guide](http://localhost:5173/studio/docs/roles), Assign roles to users.

### F06. Activity, 4/10

Activity shows Payload, Source, Started, Stage and Status, followed by No recent payloads. Its action menu offers Refresh. It does not explain what produces a payload or how this page differs from Audit and workflow History.

**Refutation check:** I searched the manual for activity and payload. The former returned other guides, including Audit and Distributed Sync. The latter returned Facilities. Neither exposed an Activity task guide. Start Here mentions Activity but does not explain its stages.

**Documentation change:** explain what appears here, where it comes from, and the difference between this page, Audit and sync Activity. Show a successful example and a failed example. Explain the available stage/status values from the product's configured vocabulary. Add the first investigation step for each failure state. An empty-state link to that guide would help.

The absence of payloads is not itself a defect. Details, retries and ingestion belong in pass two with data.

Evidence: [Activity](http://localhost:5173/studio/activity) and the in-app documentation search.

### F07. Settings / Laboratory, 7/10

Laboratory explains its letterhead fields and gives detailed time-zone help. Facility register is less clear. A new administrator cannot tell whether this chooses the laboratory's identity, a default source for imports, or something else.

**Refutation check:** I read the loaded Laboratory page and the Settings guide. The guide routes to several other settings areas but does not cover Laboratory. It explicitly places uncovered pages outside its scope. The Reports guide mentions the laboratory time zone, which helps that field but does not explain the register choice.

**Documentation change:** add a short Laboratory guide. Explain the register choice, how to obtain an option if the list is empty, and where Save lives. Show how to confirm the letterhead in a report preview. Keep the existing time-zone explanation and link to it from Reports.

I did not change laboratory identity, register or time zone.

Evidence: [Laboratory](http://localhost:5173/studio/settings/laboratory) and [Settings guide](http://localhost:5173/studio/docs/settings).

### F08. Settings / Connectors, 6/10

The guide tells me to select a connector type such as Postgres or SMTP Email. The new connector form starts with **Category: Plugin**, a Sink plugin selector, and a message saying no sink plugins are installed. Database setup only appears after switching Category to **Host**.

**Refutation check:** I expanded Category and chose Host without saving. The database type and host/port fields then appeared. Database connectors were available; they were hidden behind an undocumented choice.

**Why I hesitated:** the default screen suggests that Marketplace installation is a prerequisite. That was not necessary to reach Postgres configuration.

**Documentation change:** introduce Plugin versus Host before the first create procedure. Include a screenshot with Category → Host highlighted, followed by Database type. Explain why an email connector is found in that category if applicable. Use the visible Add connector label instead of alternating between add action and New.

No credentials were entered and no connector was saved.

Evidence: [Connectors](http://localhost:5173/studio/settings/connectors) and [Connectors guide](http://localhost:5173/studio/docs/connectors).

### F09. Settings / Data Exposure, 5/10

The page says hidden columns are unavailable to analytics. It lists technical field names with Shown, Hidden and PII labels. The action menu offers Save and Discard. There is no explanation of the affected scope or a way to understand the consequences from the manual.

**Refutation check:** I searched Docs for exposure. It returned No results. The Settings guide does not cover this page.

**Documentation change:** define PII as personally identifiable information. Explain which screens and outputs the setting affects, when saved changes apply, and what existing queries will show afterward. Include a reversible example using a non-sensitive field and explicit verification steps. Do not imply that these switches prove broader data-access protection without testing it.

I did not toggle or save anything. This is a guidance finding, not a security finding.

Evidence: [Data Exposure](http://localhost:5173/studio/settings/data-exposure) and documentation search for exposure.

## Suspicions I ruled out

| Initial suspicion | Result of the UI check |
|---|---|
| Reports has no starter content. | REFUTED. Ten report entries appeared after loading. I opened Test Volume Over Time and its Parameters sheet. |
| Dashboard lacks a guided widget builder. | REFUTED. Add widget opened Builder with data, measures and preview controls. |
| Terminology import cannot be found through Actions. | REFUTED. Actions → Term contains Import terms and Download template. |
| Workflow nodes are missing. | REFUTED. Fit View revealed the complete six-node Ingest graph. |
| Audit cannot explain an event. | REFUTED. Its detail sheet exposed identifiers, actor, timestamp and before/after values. |

The initial Reports empty state and initial workflow placeholder were not treated as stable data states. I did not measure loading performance.

## Using annotations in these docs

The proposed visual style fits short procedural screenshots. I would use it first on the steps where the text and controls currently diverge.

| Guide | Suggested annotation text and target |
|---|---|
| Start Here | "Open the page here" at navigation, then "Read its guide here" at Docs. |
| Reports | "Set the required dates first" at Parameters. |
| Report Designer | Label Publish revision and Create report from this design with their distinct outcomes. |
| Workflows | "Fit the whole workflow" at Fit View, then "Select a node to configure it." |
| Facilities | Label the actual code field after its meaning is reconciled with the guide. |
| Users / Roles | Point to the available Role control and state its actual selection behavior. |
| Connectors | "Choose Host for database setup" at Category. |
| Data Exposure | "Review scope before saving" beside the Save procedure. |

[neat-annotations](https://github.com/syabro/neat-annotations) supplies CSS arrows and labels around HTML targets. Its README says labels sit outside their targets and reserve no space. That needs deliberate spacing in narrow documentation columns. It also says annotations must not be the only source of essential instructions. Repeat each instruction in ordinary text.

My recommendation is one task per image, with a few numbered pointers and matching steps underneath. Use screenshots with the relevant menu already open. An arrow cannot make an unopened menu's contents visible. For screenshot callouts, target the specific image region rather than decorating the entire image. Keep annotations readable without color and avoid covering controls. On phones, place labels below the image if side labels do not fit.

I inspected the linked project's README only. I did not install it, inspect its implementation, or test compatibility with Studio. These are presentation suggestions, not an implementation plan.

## Limits and pass-two candidates

**HONEST NON-PROOF:** this pass establishes desktop navigation and documentation observations only. No OpenLDR source, backend endpoints, database, console logs or network responses were inspected. Filesystem access was limited to agent instructions, checking for docs instructions, and writing/verifying this report.

The desktop screenshots were 1280 by 720. I requested a 375 by 812 viewport, but the tool continued returning the desktop layout. I reset that override. Mobile layout is therefore unverified. Only a real phone can confirm behavior around retractable browser chrome and bottom-anchored controls.

The English UI and English manual were reviewed. French, Portuguese, documentation downloads and the public docs were not evaluated. Environment variables and deployment guidance were outside the UI-navigation task. Form building, report publishing and import execution were not completed.

Suggested pass-two exercises, pending your instructions:

- Ingest representative fixtures, then trace one payload through Activity and its workflow history.
- Run reports with data, inspect output, and compare empty results with genuine failures.
- Import facilities, reconcile observed codes, and check what reports display.
- Test terminology imports, value-set membership and coded form choices.
- Submit forms and verify validation, stored responses and version behavior.
- Test actual roles with authentication enabled, including navigation and denied actions.
- Exercise connector failures, sync activity and plugin installation in an agreed test setup.
- Test documentation and first tasks on a real phone.

No fixture files were opened or uploaded. No messages were sent. No credentials, roles, sync settings, exposure switches or installed packages were changed. No destructive actions were taken. No source changes, commits or pushes were made.

One observable side effect needs disclosure. Audit showed a dev-admin dashboard.update event at 08:22:39 during this review. I had entered dashboard edit mode and opened then closed a new widget without choosing Save. The visible excerpt did not establish whether the entire before/after objects were identical, so I do not claim the dashboard was untouched. I also opened an unsaved report template; it was absent from the explorer when I returned. No cleanup deletion was performed.

This report ends pass one. It does not authorize fixes or begin pass two.
