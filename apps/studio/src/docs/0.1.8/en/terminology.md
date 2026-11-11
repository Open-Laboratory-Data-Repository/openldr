# Terminology

**Terminology** holds the codes OpenLDR understands: test codes, specimen types, rejection reasons, countries, facility types, and the large external systems such as LOINC and SNOMED CT when you load them. Forms, the test catalog, facilities and reports all read their codes from here, so a code changed here changes what they offer.

The page has three levels. **Publishers** on the left group the code systems by who maintains them. A **code system** is one list of codes, such as test rejection reasons. A **term** is one code in it, with its display name. **Value sets** pick codes from one or more code systems for a particular use, such as the answers a form field accepts.

This guide takes about 10 minutes. Select any picture or clip to enlarge it.

![Terminology, System publisher: the code systems this install holds, with their URL and source.](terminology-tour.png)

## Who can do what

| Permission | What it allows |
| --- | --- |
| **Browse terminology** | Open Terminology and read publishers, code systems, terms and value sets |
| **Manage terminology** | Add, edit and delete publishers, code systems, terms and value sets, and import |

The Terminology page and its sheets are in English only.

## What a fresh install has

The **System** publisher holds the code systems OpenLDR installs and maintains, such as **REJECT-TEST** (test rejection reasons), **REJECT-ORDER** (order rejection reasons), **TEST-CATALOG**, **TEST-CATEGORY**, **FACILITY-TYPE** and **ISO-3166** (countries). Other code systems appear as you work. Importing a facility register, as in [Facilities](/docs/facilities), adds two lists of the register's observed level and status values.

**HL7 FHIR** holds FHIR's own standard value sets. **LOINC**, **SNOMED CT**, **WHO · ICD-10**, **WHO · ICD-11**, **UCUM** and **RxNorm** are empty until you load them. Each says **No code systems or value sets yet**.

## Example 1: browse a code system

![Opening REJECT-TEST from the System publisher.](terminology-browse.mp4)

1. Open **Terminology**. The **System** publisher is selected, on the **Code systems** tab.
2. Select the **REJECT-TEST** row.

**Expected result:** four terms, all **ACTIVE**: `CLOTTED` Clotted, `CONTAINER` Wrong container, `HAEM` Haemolysed, and `QNS` Insufficient volume. These are the reasons a lab can give for rejecting one test on a Lab order.

Search filters the terms by code or name. The status box shows retired terms too. **← Code systems** goes back to the list.

## Example 2: add a rejection reason

Add **Unlabelled specimen** as a reason to reject a test, then see it on the Lab order.

![Adding UNLABELLED, Unlabelled specimen, to REJECT-TEST.](terminology-add-term.mp4)

1. With **REJECT-TEST** open, open the page's **⋯** menu. Select **Term**, then **New**. The **New term** sheet opens.
2. In **Code**, type `UNLABELLED`. In **Display name**, type `Unlabelled specimen`. Leave **Status** on **Active**.
3. Open the sheet's **⋯** menu and save.

**Expected result:** **5 terms**, with **UNLABELLED** Unlabelled specimen at the end.


Now open the Lab order: **Forms**, **Lab order**, **View/Run**. Pick any test, open its row's **⋯** menu and select **Reject with reason**. **Unlabelled specimen** is in the list, with its code.

![The Lab order's reject list now offers Unlabelled specimen.](terminology-reason-in-order.png)

To remove the reason, open its row's **⋯** menu in Terminology and select **Delete**. The other entry in that menu is **View**.

## Example 3: read the value sets

![The System publisher's Value sets tab.](terminology-value-sets.png)

1. Open **Terminology** and select the **Value sets** tab.

**Expected result:** 17 value sets, such as **Biological Sex** (4 codes), **Country** (249), **Facility Type** (63), **Test rejection reasons** and **This lab's tests**.

A value set that takes a whole code system, or that OpenLDR works out on the fly, shows **0** under **Codes** in this release, and its sheet says **Expansion is empty**. **Test rejection reasons** and **This lab's tests** are like that. Read the real list from the command line:

```bash
./openldr terminology expand urn:openldr:valueset:test-reject-reason
./openldr terminology expand urn:openldr:valueset:lab-tests
```

With the sample test catalog switched on, as in [Test catalog, Example 2](/docs/test-catalog#example-2-switch-tests-on-at-this-lab), the second prints `5 total; CREAT, FBC, GLU, HIV-VL, MAL-RDT`. That is the list the Lab order's **Tests** field offers.

A standard value set is read-only. Its sheet says to duplicate it to make changes.

## Importing terms

The page's **⋯** menu, under **Term**, has **Import terms…** and **Download template**. The template is a text file with one JSON object per line:

```text
{"type":"meta","codingSystem":"REJECT-TEST","version":"2026-01-01"}
{"code":"LEAKED","displayName":"Leaking container"}
```

`code` and `displayName` are required. `shortName`, `class`, `unit`, `status` and `metadata` are optional. Blank lines and lines starting `//` are skipped. A CSV with `code` and `display` columns is also read.

A line with no `code` or no `displayName` stops the import. The message names the line, and nothing is imported.

Large external systems are loaded from the command line:

```bash
./openldr terminology import loinc <path> --accept-license
./openldr terminology distribution import snomed --file <snomed.zip> --accept-license
```

## Where a code system came from

The code systems table shows a description under each name, when the code system has one, and a
**Source** column:

- **OpenLDR**: CE installs and maintains it. It cannot be deleted.
- **Received data**: CE made it while projecting data it received, for example the lab codes seen in
  results.
- **Imported**: an admin imported it, from this page or with `openldr terminology import resource`.
- **Content pack**: a content pack installed it. The pack and version show under the label.
- **Facility register**: a facility register. Its facilities are under Facilities.
- **Created here**: an admin created it on this page.

An imported code system takes its name and description from the resource's `title` (or `name`) and
`description`. `openldr terminology system list` prints the same source in its last column.

## Test catalog and categories

Every install has two code systems under the System publisher. **Test catalog** holds the national list of tests. **Test categories** holds the categories a test can belong to, starting with Chemistry, Haematology, Microbiology, Serology and Molecular. Add or rename categories here.

A catalog test also carries a category and specimen types that this page does not show. Its LOINC code is a mapping, shown on the term's Mappings tab. Editing a test here keeps its category, specimen types and LOINC link. A term added here has no category or specimen types. On a lab that receives the catalog from central, central's next change replaces any edit made here.

## From the command line

```bash
./openldr terminology system list
./openldr terminology term list urn:openldr:cs:reject-test
./openldr terminology lookup urn:openldr:cs:reject-test HAEM
./openldr terminology expand urn:openldr:valueset:test-reject-reason
./openldr terminology valueset list
```

`system list` prints each code system's source in its last column. `term list` prints the four REJECT-TEST terms with their status. `lookup` prints one code, here `HAEM: Haemolysed`. `validate-code --code HAEM --valueset urn:openldr:valueset:test-reject-reason` prints `true: HAEM is in urn:openldr:valueset:test-reject-reason`.

## When to use what

- Use **terms** for single coded values.
- Use **value sets** when a form field needs a controlled list of allowed answers.
- Use **ontology indexes** when users need hierarchy, relationships or concept exploration. They come with LOINC, SNOMED CT and RxNorm distributions.
- Bind forms to terminology early, so submitted data is consistent enough for reports and workflows.

## On a phone

On a phone the publishers list stays open and takes almost half the screen, with names cut short. Fold it with the button beside **PUBLISHERS** to give the table room. The table scrolls sideways to reach each row's **⋯** menu.

## Troubleshooting

- **Import terms stops with `line 3: displayName required`.** That line has no name. Fix it and import again. Nothing from the file was saved.
- **A value set shows 0 codes.** It takes a whole code system or is worked out on the fly. Use `openldr terminology expand <url>`.
- **A new term does not show on a form.** Reload the form. A value set with a fixed list of codes needs the new code added to it too.
- **Unsupported file shape:** reopen the import dialog and compare your file to the required columns and format guidance.
- **Missing code or display name:** fix the source file before importing; both are needed for usable coded fields.
- **A source is unavailable:** confirm licensing and source availability before expecting the web app to show that terminology.
- **An ontology index is empty:** the code system may not include hierarchy data, or the ontology index has not been built for that source.
- **An entry lost properties after it was edited:** before 2026-09-15, saving a term here dropped every property the page does not show, such as LOINC's parts, an organism's type or a result parameter's role. Saving no longer does. Entries damaged before then stay damaged until their source is imported again: `openldr terminology import loinc <path> --accept-license` for LOINC, `openldr terminology import organisms <file>` for organisms, and `openldr terminology import parameters <file>` for result parameters.

## Related guides

- [Forms](/docs/forms)
- [Test catalog](/docs/test-catalog)
- [Facilities](/docs/facilities)
- [Audit](/docs/audit)
