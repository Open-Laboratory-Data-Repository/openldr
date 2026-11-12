# Terminology

Find the codes your lab uses, add your own code lists and choose which codes a form can accept. Start by checking what is already installed.

A **publisher** groups lists by who maintains them. A **code system** is a list of coded terms. A **value set** selects the codes allowed for a particular use, such as a form field.

You do not need documentation sample data. The screenshots use a built-in list and a temporary example called `DOCS-GUIDE-REVIEW`. Use your own names, codes and URLs when creating your lab's lists.

Reading needs permission to browse terminology. Creating, changing and importing need permission to manage terminology.

## Find a code and read its details

Look for an existing code before creating another one. This example finds a test rejection reason in the built-in REJECT-TEST code system.

### 1. Open Terminology

Select **Terminology** in the main menu on the left.

![Terminology is in the main menu on the left.](terminology-guide-open-terminology.png)

### 2. Choose the publisher

Select the publisher that maintains the list. For this example, select **System**.

![Choose the publisher that maintains your code system.](terminology-guide-choose-publisher.png)

### 3. Select Code systems

If the publisher offers both types of list, select **Code systems** beside its name.

![Use Code systems when the publisher also offers value sets.](terminology-guide-code-systems-tab.png)

### 4. Open a code system

Select the list you want to read. This example opens **REJECT-TEST**.

![Open the code system you want to browse. This example uses REJECT-TEST.](terminology-guide-choose-code-system.png)

### 5. Search for the code or name

Enter part of the code or display name in **Search terms…**. This example uses `HAEM`.

![Search terms by code or display name within the open code system.](terminology-guide-search-terms.png)

**Expected result:** the list shows matching terms from this code system. The status filter can narrow the results further.

![The term list is filtered to the code or name you entered.](terminology-guide-search-result.png)

### 6. Open the term

Select its row. The **Edit term** sheet shows its code, display name, status and other details.

![Select a term row to inspect its details.](terminology-guide-open-term.png)

![A term row opens its details in an editing sheet. Code is fixed after creation.](terminology-guide-term-details.png)

### 7. Close the sheet

Select **Close** at the top right to leave without saving changes.

![Close leaves the existing term unchanged.](terminology-guide-close-term.png)

## Create a code system for your own list

Create a code system when your lab needs a list that does not already exist. Choose its publisher first. The screenshots use System and leave Active checked.

**System code** is the short identifier and cannot be changed after creation. **System name** is the readable name. A **Canonical URL** identifies the list when codes are shared with other systems. It can be left blank for a custom list.

### 1. Open the page dots menu

Select the dots at the right end of the publisher breadcrumb, above the table.

![The page dots menu is at the right end of the publisher breadcrumb.](terminology-guide-system-actions.png)

### 2. Open Code system

Select **Code system** in the menu.

![Code system contains the action for a new code list.](terminology-guide-code-system-menu.png)

### 3. Choose New

Select **New**. The **New coding system** sheet opens.

![Choose New to open the coding-system sheet.](terminology-guide-new-code-system.png)

### 4. Enter a system code

Enter a unique code in **System code**. The example uses `DOCS-GUIDE-REVIEW`.

![Enter a unique short code for your code system.](terminology-guide-system-code.png)

### 5. Enter its name

Enter the name people should see in **System name**.

![Enter the name people should see for the code system.](terminology-guide-system-name.png)

### 6. Enter its canonical URL, if needed

Enter the identifier your organization uses in **Canonical URL**, or leave it blank for a custom list.

![Use a stable canonical URL when sharing these codes with other systems.](terminology-guide-system-url.png)

### 7. Create the code system

Select **Create** at the bottom of this sheet.

![Create is at the bottom of the coding-system sheet.](terminology-guide-create-system.png)

**Expected result:** the new code system appears under the selected publisher. Open its row to add terms.

![The new code system appears in the selected publisher.](terminology-guide-system-created-step-0.png)

## Add a term

Add a code and its readable name to an existing code system. Use a code that is unique within that system. New terms start as Active; short name, class, unit and metadata are optional.

### 1. Open the destination code system

Select the code system that should contain your term. Use an existing list or one you created above.

![The new code system appears in the selected publisher.](terminology-guide-system-created-step-1.png)

### 2. Open the term dots menu

Select the dots beside **Search terms…** and the status filter.

![The term dots menu sits beside Search terms and the status filter.](terminology-guide-term-actions-step-2.png)

### 3. Choose New term

Select **New term**.

![New term opens the editor for this code system.](terminology-guide-new-term.png)

### 4. Enter the code

Enter the value to store in **Code**. The example uses `EXAMPLE-1`.

![Enter the code that will be stored with this term.](terminology-guide-term-code.png)

### 5. Enter the display name

Enter a readable label in **Display name**.

![Enter a readable display name for the term.](terminology-guide-term-display.png)

### 6. Open the editor dots menu

Select the dots beside the **Details** and **Mappings** tabs.

![The term editor saves from its dots menu beside Details and Mappings.](terminology-guide-term-sheet-actions-step-6.png)

### 7. Choose Create

Select **Create** to store the new term.

![Choose Create for a new term. Existing terms use Save.](terminology-guide-create-term.png)

**Expected result:** the sheet closes and the term appears in the code system.

![The term appears in this code system with Active status.](terminology-guide-term-created.png)

## Change a term's display name

Change the readable label when it needs correcting. The stored code stays the same.

### 1. Open the term

Select the term's row in its code system.

![Select the existing term you want to change.](terminology-guide-edit-term-row.png)

### 2. Change Display name

Replace the text in **Display name**. The example changes it to `Updated example label`.

![Change the display name. The stored code remains fixed.](terminology-guide-edit-term-name.png)

### 3. Open the editor dots menu

Select the dots beside **Details** and **Mappings**.

![The term editor saves from its dots menu beside Details and Mappings.](terminology-guide-term-sheet-actions-step-3.png)

### 4. Choose Save

Select **Save**. Existing terms use Save; new terms use Create.

![Existing terms use Save in the editor dots menu.](terminology-guide-save-term.png)

**Expected result:** the list shows the new display name beside the same code.

![The existing code now has its updated display name.](terminology-guide-term-updated.png)

## Import several terms from a file

Use an import when you already have a list of codes and names. Open the destination code system first.

The downloaded template uses **JSON Lines**: one JSON object on each line. Each term needs `code` and `displayName`. The metadata line identifies the code system. For example:

```jsonl
{"type":"meta","codingSystem":"DOCS-GUIDE-REVIEW","version":"2026-01-01"}
{"code":"EXAMPLE-2","displayName":"Imported example label"}
```

Your file should use your own code-system identifier and terms. Blank lines and lines beginning with `//` are allowed.

### 1. Open the term dots menu

Select the dots beside **Search terms…**.

![The term dots menu sits beside Search terms and the status filter.](terminology-guide-term-actions-step-1.png)

### 2. Download the template if you need one

Select **Download template**. Prepare your file using its columns and examples.

![Download template provides the columns for a term import.](terminology-guide-download-template.png)

### 3. Choose Import terms

Open the term dots menu again and select **Import terms**.

![Import terms opens the file chooser for the current code system.](terminology-guide-import-terms.png)

### 4. Select your prepared file

Choose the file in your computer's file window. Import begins after you choose it. The screenshot shows the result after the example file was selected.

![After the corrected file is chosen, EXAMPLE-2 appears in the term list.](terminology-guide-import-result.png)

**Expected result:** the imported codes appear in this code system. Search can help you find a particular imported code.

## See which codes a value set allows

Read a value set when you need to know which answers a form field can offer. Its **Include** and **Exclude** rules define the list. **Expansion** shows the resulting codes.

### 1. Return to the code-system list

If a term list is open, select **← Code systems**.

![Leave the term list with the Code systems back button.](terminology-guide-back-to-systems.png)

### 2. Select Value sets

Select **Value sets** beside the publisher name. This example uses System.

![Value sets lists the allowed-code lists for the selected publisher.](terminology-guide-value-sets-tab.png)

### 3. Open a value set

Select its row. This example opens **Test rejection reasons**.

![Select a value set to inspect its composition and expansion.](terminology-guide-open-value-set.png)

### 4. Read Expansion

Scroll down to **Expansion** to read the codes produced by its rules.

![Expansion shows the allowed codes resolved from the value-set rules.](terminology-guide-value-set-expansion.png)

**Expected result:** you can read the allowed codes without changing the value set. The count depends on the code systems and rules in your installation.

## Create an allowed-code list

Create a value set to make a code system available as a controlled list. This example includes all codes from one code system. Leave the concept list empty to include the whole system. The example stays Draft while being prepared.

### 1. Open the page dots menu

Close any editing sheet first. Select the page dots beside the publisher breadcrumb.

![Open the page dots menu above the value-set table.](terminology-guide-value-set-page-actions.png)

### 2. Open Value set

Select **Value set** in the menu.

![Choose Value set in the page dots menu.](terminology-guide-value-set-menu.png)

### 3. Choose New

Select **New** to open the builder.

![New opens the value-set builder.](terminology-guide-new-value-set.png)

### 4. Enter the value-set URL

Enter a unique **Canonical URL**. Use a different URL from the code system's URL.

![Give the value set a stable, unique canonical URL.](terminology-guide-value-set-url.png)

### 5. Enter a readable title

Enter the name of your allowed-code list in **Title**.

![The title is the readable name of this allowed-code list.](terminology-guide-value-set-title.png)

### 6. Choose the source code system

Under **Include**, open **System** and choose the list that contains your terms.

![Under Include, choose the code system that supplies the allowed codes.](terminology-guide-value-set-system.png)

![Choose your code system from the System list.](terminology-guide-value-set-system-selection.png)

### 7. Open the builder dots menu

Select the dots at the top right of the value-set builder.

![Save a value set from the builder dots menu.](terminology-guide-value-set-actions.png)

### 8. Choose Save

Select **Save**. The builder computes the expansion after saving.

![Save stores the value-set rules and computes the expansion.](terminology-guide-save-value-set.png)

**Expected result:** Expansion shows the active codes supplied by the selected code system. The example contains two codes.

![The saved value set expands to the two active example codes.](terminology-guide-value-set-created.png)

A value set can also include selected concepts, exclude codes or import another value set. Creating the value set does not bind it to a form automatically. Form-field setup belongs in the [Forms guide](/docs/forms).

## Open the importer for a standard distribution

LOINC, SNOMED CT and RxNorm have a distribution ZIP importer in the browser. Use this for a provider's distribution package, rather than importing it as a small list of local terms.

### 1. Choose the external publisher

Select **LOINC**, **SNOMED CT** or **RxNorm**. The screenshot uses LOINC.

![Select the external publisher whose distribution you want to load.](terminology-guide-standard-publisher.png)

### 2. Open the page dots menu

Select the dots at the right end of the publisher breadcrumb.

![Open the page dots menu for the selected standard publisher.](terminology-guide-standard-actions.png)

### 3. Choose Import distribution...

Select **Import distribution...**.

![Import distribution opens the browser upload workflow for this publisher.](terminology-guide-import-distribution.png)

**Expected result:** the distribution importer opens. It has a ZIP file field, an optional version and a license confirmation. It imports in the background after upload.

![The importer accepts a distribution ZIP, an optional version and your license confirmation.](terminology-guide-distribution-importer.png)

You supply the distribution package and handle its license.

## Choose a publisher on a phone

The publisher list starts folded on a phone so the table has more space.

### 1. Show publishers

Select **Show publishers** at the top left of the Terminology pane.

![On a phone, Show publishers opens the publisher list.](terminology-guide-phone-show-publishers.png)

### 2. Choose the publisher

Select the publisher you need.

![Choose a publisher from the open list.](terminology-guide-phone-choose-publisher.png)

### 3. Hide the publisher list

Select **Hide publishers** to give the table the width again.

![Hide publishers gives the code table the phone width again.](terminology-guide-phone-hide-publishers.png)

**Expected result:** the selected publisher remains in the breadcrumb. Scroll the table sideways when its remaining columns are off screen.

## Troubleshooting

### The import says displayName required

The error names the line that has no readable name. Add `displayName` to that term and choose the corrected file again. The example below failed on line 2.

![The error identifies the line and missing displayName field.](terminology-guide-import-error.png)

### The Term options are disabled

Open a code system first. Term actions need a destination list.

### I cannot change Code on an existing term

The editor keeps the code fixed after creation. Display name and other editable fields can still be changed.

### The value set says it is immutable

Some standard catalog value sets are read-only. Their builder explains that they must be duplicated before changes can be made.

### A value set has an empty expansion

Check its Include rules, the selected code system and the status of its terms. A value set for this lab's tests also depends on which tests the lab has enabled.

## Related guides

[Start here](/docs/start-here) explains the installed and development CLI, including the example `openldr_ce` folders. Use that guide before running terminology commands from a terminal.

[Forms](/docs/forms) · [Test catalog](/docs/test-catalog) · [Facilities](/docs/facilities) · [Your preferences](/docs/user-preferences)
