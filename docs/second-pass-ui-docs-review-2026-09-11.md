# Second pass: UI actions with data

33 observed features: 21 scored at least 8, and 12 scored below 8. Two security risks scored 0.

This is a review of the running UI and its user documentation. It is not a code audit or an implementation request. Deletion and installation completion remain pending, as listed below.

| Page | Feature tested | Score / 10 | Observed result |
|---|---|---:|---|
| Dashboard | Find a way to create another dashboard | 3 | No New action found in the selector or either menu state. See SP2-05. |
| Dashboard | Add and save two widgets | 8 | Order count and Patient count persisted after finishing Edit mode and reloading. |
| Query | Run a synthetic query | 9 | Success message, row count, duration, and result appeared. |
| Query | Save, update, and name a reusable query | 6 | Save and update succeeded, but naming guidance could not be followed. See SP2-06. |
| Report Designer | Create a template and bind a table | 8 | Saved a table bound to the synthetic query, with two selected columns. |
| Report Designer | Publish a revision | 8 | The saved template displayed PUBLISHED. |
| Report Designer | Create a library report from the design | 7 | The report appeared, but confirmation named the template instead. See SP2-07. |
| Reports | Run the published report | 9 | Document and Spreadsheet displayed the updated synthetic value. |
| Reports | Request PDF/CSV and inspect history | 8 | History recorded both exports and the preview. Local downloaded files were not verified. |
| Reports | Create, edit, run, and disable a schedule | 7 | Save confirmed; scheduled history showed OK. Timing and run feedback need explanation. See SP2-08. |
| Workflows | Create, save, rename, and reopen | 8 | The named workflow and its single node persisted. |
| Workflows | Execute a manual trigger and inspect history | 9 | UI explained the extra trigger click, then reported one completed step. |
| Terminology | Create a draft term | 8 | The synthetic term appeared with DRAFT status. |
| Terminology | Edit and disable the term | 8 | Updated name and DISABLED status persisted and appeared in Audit. |
| Facilities | Register an import source | 8 | The new register became selectable in the import wizard and manual form. |
| Facilities | Create a facility using offered values | 2 | Create rejected the Level selected from its own list. See SP2-03. |
| Forms | Build and publish a custom form | 8 | Required field previewed; Publish saved and confirmed publication. |
| Forms | Validate and submit that form | 3 | Required validation worked; a completed response failed extraction. See SP2-04. |
| Forms | Archive and check submission restriction | 8 | Archive confirmed; View/Run explained that submission was disabled. |
| Settings / General | Change and restore automatic update checks | 9 | Toggle saved with feedback; original enabled state restored. |
| Settings / Laboratory | Edit, reload, and restore Contact | 8 | Temporary text persisted after reload; original blank value restored. |
| Settings / Notifications | Change and restore Update available | 9 | Save feedback and busy state appeared; original enabled state restored. |
| Settings / Distributed sync | Change and restore interval while disabled | 8 | Interval persisted; final revisit showed disabled sync and 15 minutes. |
| Settings / Distributed sync | Select Sync now while disabled | 5 | No explanatory response observed; activity remained not started. See SP2-09. |
| Settings / Roles | Create and edit a role with no capabilities | 9 | Named save toast, edited description, and zero members were visible. |
| Settings / Connectors | Create a host connector | 6 | Creation succeeded after discovering Category; no initial Enabled choice. See SP2-10. |
| Settings / Connectors | Reopen and rename saved configuration | 6 | Non-secret fields reopened blank, although Test retained the address. See SP2-11. |
| Settings / Connectors | Disable and test a deliberately unreachable host | 9 | Disabled state persisted; Test showed the exact refused address and port. |
| Settings / Marketplace | Inspect installation permissions | 0 | Details said no special permissions; approval requested input and FHIR creation. See SP2-02. |
| Settings / Marketplace | Create, rename, and disable a registry | 7 | Changes persisted, but creation feedback said Refresh. See SP2-12. |
| Settings / Data Exposure | Save and check the stated query protection | 0 | A connector query used a hidden column despite the blanket UI promise. See SP2-01. |
| Audit | Filter test events and inspect a change | 8 | Filter returned exactly the term create/update events; detail showed the saved values. |
| Activity | Search a payload, inspect lifecycle, and refresh | 8 | Search isolated one payload; detail showed Received and Persisted events. |

## Scope and evidence

Reviewed on 11 September 2026 at `http://localhost:5173/studio`. Settings reported development version 0.1.8. The documentation selector showed 0.1.0. The browser displayed Authentication bypass active throughout.

I used the UI, visible accessibility information, screenshots, and rendered documentation. I did not inspect application source, APIs, network traffic, browser storage, databases, or server logs. SQL below was entered through the Query page, which documents that operation.

Scores describe the tested action, including discovery, guidance, validation, persistence, and feedback. A score of 8 or more means intuitive. A security risk overrides the usability score to 0, as requested. These are not vulnerability severity scores.

The tests used named synthetic content. I did not upload another fixture or change an existing clinical record. Live totals changed during the review, so numerical differences between visits were not treated as defects.

This pass exercised representative actions across the navigation and every settings section. It did not execute every available node, report, connector type, or destructive operation.

## Findings below 8

### SP2-01: The hidden-column promise does not describe connector queries accurately

Score **0**, security risk in the stated protection.

At [Data Exposure](http://localhost:5173/studio/settings/data-exposure), the page says queries, dashboards, and reports never see hidden columns. Patient `id`, `plugin_version`, and personal fields displayed Hidden. I saved the unchanged policy and received `Column policy saved`.

At [Query](http://localhost:5173/studio/query), I expanded the existing Target Warehouse connector. Its visible Explorer listed `public.patients`. I ran:

```sql
SELECT COUNT(id) AS hidden_id_count FROM public.patients
```

The UI reported one successful row in 30 ms. The grid displayed `hidden_id_count = 5189`. A second query selecting the hidden `plugin_version` column also succeeded and displayed one blank cell. I did not save either test query or display patient identifiers.

This proves the observed connector query can reference a column labelled Hidden. It does not prove that a restricted account can bypass authorization. Authentication was bypassed, and the UI does not explain whether external connectors are outside this policy. The warehouse's underlying relationship to the application's data was not inspected.

The risk is trusting this blanket statement when giving someone query access. The documentation search had no Data Exposure guide in the first pass, and the current sidebar still has none.

The guide should identify the exact query paths this policy covers, the paths it does not cover, and how an administrator can verify enforcement. An annotated example should show a hidden column and the expected refusal. Documentation alone cannot establish that the restriction is enforced.

### SP2-02: Marketplace permission screens contradict each other

Score **0**, security disclosure risk.

At [Marketplace](http://localhost:5173/studio/settings/marketplace), I opened `tabular` version 0.1.0 from Local registry. It showed OpenLDR Reference Publisher and Verified. Details displayed `Payload details unavailable` and `No special permissions requested`.

Details > Install then opened an approval dialog requesting:

- `read-input`
- `emit-fhir` for Patient, Specimen, and Observation

The final dialog does disclose capabilities. This is not evidence of a silent grant. The earlier statement is still misleading security information during package selection. Missing payload details should not read as proof that no permissions are required.

The [Marketplace guide](http://localhost:5173/studio/docs/marketplace) tells users to inspect capabilities in Details. Show the same capability list at both steps. Explain what reading input and creating FHIR records permits. Annotate the capability list and final approval action together.

Installation was not approved. The action-time permission request remains pending.

### SP2-03: Facility creation rejects a value offered by its Level field

Score **2**.

At [Facilities](http://localhost:5173/studio/facilities), I created the source `Review P2 - Test register` through Import facilities > Register a source. Its URI is `urn:review:p2:facilities`.

I then opened Add facility and entered:

| Field | Value selected or entered |
|---|---|
| System | Review P2 - Test register |
| Facility code | REVIEW-P2-001 |
| Name | Review P2 - Synthetic facility |
| Country | Tanzania, United Republic of, selected from the search result |
| Zone | Review zone |
| District | Review district |
| Status | Active, selected from the search result |
| Level | District Hospital, selected from the search result |

Searching Level for `hospital` offered District Hospital with code `district-hospital`. Create returned:

```text
create facility failed: level 'District Hospital' is not a recognised canonical level value
```

The form retained its inputs. No facility was created. A new user should not need to translate an option the UI supplied.

My earlier suspicion that the selectors had no values was wrong. Searches for `active` and `hospital` returned choices. The reproducible problem is rejection of the selected Level.

The [Facilities guide](http://localhost:5173/studio/docs/facilities) also describes National code and Local code, while this form shows System and Facility code. A manual-entry walkthrough should use the current labels, show the source-registration prerequisite, and explain how search selections become codes. Annotate the selected Level and the saved row, not just the empty form.

### SP2-04: A published custom form cannot submit its completed response

Score **3**.

At [Forms](http://localhost:5173/studio/forms), I created `Review P2 - Feedback form`. FHIR version and resource type remained None. I added one enabled, required text field labelled `Review note` and published the form. Publication confirmed by name and showed Published v1 in the builder.

View/Run rejected a blank submission, as expected. Its message used the internal field name:

```text
field new-text-field is required
```

I entered `Synthetic UI review response.` and submitted again. The page returned:

```text
submit form response failed: form produced no resources: the form declares no fhirResourceType and no field is flagged observationExtract with a code, so no extractor applies.
```

The [Forms guide](http://localhost:5173/studio/docs/forms) presents custom forms as an option and tells users to publish, fill required fields, and submit. It does not explain this extraction prerequisite. A successful preview and publication therefore did not establish that this form could collect a response.

The guide needs a complete custom-form example that reaches successful submission. Explain any required resource mapping before publication. Validation should identify `Review note`, the label the user sees. An annotation should connect the prerequisite configuration to submission, with the expected success message shown.

I later archived the form. Archive confirmed by name. View/Run correctly explained that submission was disabled. The list showed both Archived and Active; those separate states need a short explanation. No successful response storage was observed.

### SP2-05: Creating another dashboard is not discoverable

Score **3**.

At [Dashboard](http://localhost:5173/studio), the selector contained only Lab Overview. In view mode, Dashboard menu offered Edit, Export, and Import. In Edit mode it offered Add widget, Edit filters, Done, Delete, Export, and Import.

I found no New dashboard action in either location. This is a UI discovery finding, not proof that the backend lacks dashboard creation.

I added `Review P2 - Order count` and `Review P2 - Patient count` to the sample dashboard instead. Both persisted after Editor menu > Save, Dashboard menu > Done, and reload.

The [Dashboard guide](http://localhost:5173/studio/docs/dashboard) should say whether multiple dashboards can be created here. If Import is the intended route, give an actual example and explain whether it replaces or adds content. Annotate the selector, dashboard menu, widget Save, and Done as separate steps.

An earlier second-widget attempt did not survive an immediate reload. After waiting and finishing Edit mode, both widgets persisted. I am not reporting a confirmed persistence defect from that earlier attempt.

### SP2-06: Saved-query naming guidance has no visible matching step

Score **6**.

At [Query](http://localhost:5173/studio/query), I ran:

```sql
SELECT 'Review P2' AS label, 7 AS value
```

Save immediately confirmed a custom query named `Query #1`. It did not ask for a name. I updated it to:

```sql
SELECT 'Review P2 updated' AS label, 8 AS value
```

Saving updated the same query. The published report later displayed the updated text and 8, which verifies reuse of the saved change.

The [Custom Queries guide](http://localhost:5173/studio/docs/query) says renaming is unavailable, then advises saving a new query with the desired name. I could not find the naming step needed to follow that advice.

Show exactly where a new query gets its name, or state the current limitation plainly. Annotate the tab title, Save, and saved Explorer entry in one example. Generic names become difficult to distinguish in Report Designer's query picker.

### SP2-07: Report creation confirmation names the wrong object

Score **7**.

In [Report Designer](http://localhost:5173/studio/report-designer/rt-1789106332323), I created and published `Review P2 - Synthetic report`. I chose Create report from this design and entered the report name `Review P2 - Published sample`.

The confirmation said `Published` followed by the template's name and `as a report`. The library correctly contained `Review P2 - Published sample`.

The action succeeded, but its feedback did not name the object I had just created. The [designer guide](http://localhost:5173/studio/docs/report-designer) should distinguish saving a design, publishing its revision, and creating the report library entry. Use the actual menu labels and show the resulting report name. A link to that report in the confirmation would make the next step clear.

### SP2-08: Schedule saving is clear; execution timing and feedback are not

Score **7**.

For `Review P2 - Published sample`, I opened Actions > Schedules > New Schedule. I saved Monthly, day 1, XLSX. The UI confirmed `Schedule saved.` and showed the next run at 1 October 2026, 09:00.

The form offered frequency, day, and format. It did not expose the execution time or time zone. It repeated the automatic date-window message.

Run now produced no immediate completion message that I observed. After another interaction, Last showed 11 September, 09:19:55. Run History > Scheduled Runs eventually showed XLSX and OK, with a Download action. I changed the schedule to CSV, saved it, and disabled it. The disabled row continued to show the same Next timestamp.

The [Reports guide](http://localhost:5173/studio/docs/reports) explains how to open Schedules but not these choices. Document the execution time, time zone, automatic window, output retrieval, and disabled-state meaning. Annotate Run now and the separate Scheduled Runs history tab. A visible queued/running/completed response would reduce repeated clicks.

The scheduled job's UI status was verified. Its downloaded file contents were not.

### SP2-09: Sync now gives no useful response while sync is disabled

Score **5**.

At [Distributed sync](http://localhost:5173/studio/settings/sync), Enable sync was off and connection fields were blank. I changed the interval from 15 to 16, saved, restored 15, and later revisited to verify it.

Activity > Actions still offered Sync now. I selected it. The settled page still showed both workers not started, Last checked never, Last success never, and no events. I observed no message explaining that sync was disabled or unconfigured.

The [Distributed Sync guide](http://localhost:5173/studio/docs/sync) should describe what Sync now does in this state. Either disable the action with a reason or show a refusal that identifies the missing prerequisite. Annotate the master switch and activity action together.

No transfer was verified. I did not enable sync or configure a remote server.

### SP2-10: Connector creation differs from its documented setup steps

Score **6**.

At [Connectors](http://localhost:5173/studio/settings/connectors), Add connector defaulted to Category Plugin. It showed no installed sink plugins. Choosing Category Host exposed the database fields.

The [Connectors guide](http://localhost:5173/studio/docs/connectors) tells users to pick a type and choose whether the connector starts enabled. It does not explain the Category step. The creation sheet had no Enabled control, and the new connector started enabled.

I created a credential-free test connector targeting `127.0.0.1:1`, database and user `review_p2`. Save confirmed by name. I then disabled it. No workflow was attached to it.

Document Category before Type, and describe the actual initial enabled state. Annotate the category choice and the list toggle. Do not tell users to select an option that is absent from the creation form.

### SP2-11: Saved connector fields look empty even when configuration remains stored

Score **6**.

Reopening the test connector showed blank Host, Port, Database, and User fields. The list's Host column also showed no value. The page explains that secrets are not shown again, but these blank fields include ordinary connection details.

I checked whether the configuration had actually been lost. Test returned:

```text
Test failed: connect ECONNREFUSED 127.0.0.1:1
```

I renamed the connector to `Review P2 - Disabled test host` without refilling the blank fields. Save confirmed. Test still targeted `127.0.0.1:1`.

This refutes loss of the saved host and port in that flow. It leaves a readback problem: a user cannot tell which fields are stored, absent, or unchanged when blank. The [guide](http://localhost:5173/studio/docs/connectors) explains hidden passwords and tokens, but not this broader behavior.

Explain field preservation during edits and show a saved-state indicator. An annotated before/after example should distinguish stored configuration from an empty value. The deliberate connection refusal itself was clear and is not a defect.

### SP2-12: Registry creation feedback does not say what was saved

Score **7**.

At Marketplace > Registries, I created `Review P2 - Registry copy` pointing to the same local directory as the existing Local registry. The row appeared, but the notification read `Refresh` rather than identifying a saved registry.

The [Marketplace guide](http://localhost:5173/studio/docs/marketplace) also tells users to enter an enabled state during creation. The form offered Name, Type, and Location only. The new row started enabled.

I disabled the copy and renamed it `Review P2 - Disabled registry copy`. The original registry remained enabled and unchanged.

Show a named save confirmation and explain that disabling occurs in the list after creation. Annotate the new row and its toggle so users can verify both identity and state.

## Work retained for inspection

| Item | Final observed state |
|---|---|
| Lab Overview sample dashboard | Two added widgets, Review P2 - Order count and Review P2 - Patient count. Existing widgets retained. |
| Query #1 | Saved synthetic query returns Review P2 updated and 8. Bound to the review template/report. |
| Review P2 - Synthetic report | Published template, ID `rt-1789106332323`. |
| Review P2 - Published sample | Published library report, ID `r-498fd390-19f9-4c1c-b765-167bac0c98c4`. |
| Report schedule | Disabled. Monthly day 1, CSV. ID `c8064327-71c5-4dd9-ae3f-7fd6bfaccba2`. One earlier XLSX run showed OK. |
| Review P2 - Manual check updated | Saved, enabled, one Manual Trigger only. ID `wf_mtwjtxuz_qx53wa`. One completed manual run. |
| Review P2 - Feedback form | Archived. ID `form-cd247d53-208c-4261-ad82-9f7b70fd6199`. No successful submission observed. |
| REVIEW-P2-NONCLINICAL | Disabled term under LOCAL. Display name Review P2 - Disabled nonclinical term. |
| Review P2 - Test register | Registered source, URI `urn:review:p2:facilities`, code `review-p2`. No facility saved under it. |
| Review P2 - No access | Role with zero capabilities and zero members. Description edited. Deletion pending confirmation. |
| Review P2 - Disabled test host | Disabled connector. ID `b0a47dd1-a507-44cd-9556-b42629737bbb`. No password entered. |
| Review P2 - Disabled registry copy | Disabled registry pointing to the existing local bundle directory. ID `f034aaa8-5a60-4f0e-ad2e-fe26ecd3578f`. |

General update checks, notification preference, laboratory Contact, and sync interval were restored. Data Exposure was saved without changing its switches. Audit records from the review remain. No permanent deletion was performed.

## Pending and unproved operations

| Operation | What was inspected or attempted | Why completion is not claimed |
|---|---|---|
| Delete the review role | Created and edited an isolated role; inspected its Delete menu item. | Browser action-time confirmation was requested and has not arrived. |
| Install tabular | Read Details and opened the final capability approval dialog. | Permission approval was requested and has not arrived. No installation completed. |
| Create or modify a user account | Opened New user and inspected required identity fields, Password, and Role. | New credential entry requires user handoff under the browser tool rules. No account or access changes made. |
| Enroll a site | Opened enrollment; it requires Site ID and Central URL and mints a sync client. | No remote test endpoint or action-time credential/access approval supplied. No site enrolled. |
| Add a terminology code system | Selected Code system > New. No form appeared; the browser reported no JavaScript dialog. | I could not distinguish an app issue from native-dialog support in this browser. Term creation was tested separately. |
| Facility import | Created a source and inspected the wizard. | No file imported. Manual creation reached the concrete refusal documented above. |
| Destructive maintenance | Not executed. | Resetting existing lab data is outside the isolated test-object changes used in this pass. |
| Real sync, email, and external connector operations | Not executed. | No remote test services or credentials configured. |

HONEST NON-PROOF: An OK run or export history entry does not prove the downloaded file opened correctly. The browser download wait timed out for CSV. I did not classify that tool result as an application export failure.

HONEST NON-PROOF: Authentication bypass prevents conclusions about restricted roles, unauthenticated access, or role enforcement. Neither score-0 finding establishes exploitation by another user. A separate authenticated review would need least-privilege test accounts and known connector-policy scope.

HONEST NON-PROOF: No phone testing or French/Portuguese action review was performed. This pass used the desktop English UI. It does not verify mobile bottom-edge behavior.

## Documentation changes I would prioritize

Use a complete task as the unit of documentation. The strongest example from this pass is one saved query becoming a published template, then a named report, then a scheduled output. Each step should show both the action and evidence that it succeeded.

For annotations, the [neat-annotations reference](https://github.com/syabro/neat-annotations) could support these focused examples:

| Screenshot sequence | What to label |
|---|---|
| Query to published report | Query name, selected columns, Publish revision, Create report from this design, resulting library name. |
| Dashboard editing | Dashboard selector, widget Save, Done, and the widget after reload. |
| Custom-form submission | Required mapping, field label, publication state, and actual submit success. |
| Facility entry | Registered System, coded search result, selected Level, and create result. |
| Connector editing | Category Host, saved configuration indicators, enabled toggle, and Test response. |
| Security settings | Exact policy scope and a refused query; identical capability information at selection and approval. |
| Scheduled output | Execution time and zone, disabled state, Run now feedback, and Scheduled Runs download. |

Keep the instruction text beside the screenshot. Arrows should help locate a control, not carry the only explanation. Reserve space around annotation labels and check narrow screens. No annotation library or application change was installed in this pass.

The two security statements and the two blocked submission paths deserve attention before cosmetic documentation work. The remaining findings mainly concern missing steps, mismatched labels, and unclear completion feedback.
