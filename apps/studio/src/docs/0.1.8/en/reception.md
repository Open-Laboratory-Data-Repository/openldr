# Reception

Reception is the lab's front desk. When a sample arrives, you find its order by the requisition number, register the order if the lab has no record of it, link the patient and record the sample with its condition. Reception staff and lab managers use it.

You need **Receive samples** to open **Reception**. The built-in **Reception** and **Lab Manager** roles hold it. A user with a data limit cannot open Reception, whatever their role gives.

**Returning a request to its site, rejecting a sample, worklists and result review are not in this release.** They come in later releases.

## Find an order

The barcode on a request form holds its requisition number. A scanner types the number into the box and presses Enter for you.

1. Select **Reception** in the main menu.
2. Scan the request form's barcode, or type the requisition number in the box at the top and press Enter.

**Expected result:** each order with that number shows as a panel. The panel shows the number, where the order came from, **Facility** and **Patient**. It also shows **Priority**, **Clinician** and **Note** when the order has them. Below are the order's tests, with **Test**, **Code** and **Status**, and its **Samples**.

After a search, the number in the box stays selected. The next scan replaces it, so you never clear the box by hand.

The label beside the number says where the order came from: **Registered at the desk**, **Lab order form** or **From another system**.

Two facilities may use the same number. Then you see one panel for each. Check **Facility** before you go on.

When no order has the number, the page says, for example, `No order CS-0001 was found. Use the menu to register it.`

## Register an order that is not found

Do this when the request form is in front of you but the lab has no record of its order.

1. Search for the number, as in the task above.
2. Open the dots menu at the right of the box and select **Register this order**.
3. Check the number in **Requisition number**. It is filled in from your search.
4. In **Facility**, type two letters of the facility's name or code, then choose the facility from the list.
5. In **Tests**, type part of a test name and tick each test the request asks for.
6. Open the sheet's dots menu and select **Find or register patient**. Then follow the next task.
7. Choose **Priority**, and type **Clinician** and **Note** if the request form gives them.
8. Open the sheet's dots menu and select **Register order**.

**Expected result:** a message says, for example, `Order CS-0001 registered.` The order shows as a panel marked **Registered at the desk**.

The facility, the number and the tests cannot change after you register. Check them before step 8.

An order needs a number, a facility, at least one test and a patient. Without one of them, nothing is saved.

**Register this order** stays in the menu after any search, even when an order was found, because another facility may use the same number. The same number from the same facility cannot be registered twice.

## Find the patient

The **Patient** sheet opens from **Find or register patient** in the register sheet, or from **Link patient** in an order panel's dots menu.

1. Type the patient's identifier in **Identifier**. Or type the first name and surname in **Full name** and choose the **Birth date**.
2. Open the dots menu beside **Find** and select **Search**.
3. Select the patient in the list.
4. Open the same dots menu and select **Use this patient**.

**Expected result:** the sheet closes. The patient's name shows beside **Patient**.

A search shows a patient only for an exact identifier, or a full name with the full birth date. Part of a name, or a name with no birth date, finds no one. This lets you confirm a patient you already know without browsing the patient list.

An identifier search uses the identifier systems your lab has made searchable.

## Register a new patient

Do this when the search says `No patient matches. Register them below.`

1. Under **New patient**, type **First name** and **Surname**.
2. Choose **Sex**.
3. Choose **Birth date**. If no one knows it, type the age in **Age in years** instead.
4. If the patient has an identifier, type **Identifier system** and **Identifier value**.
5. Open the dots menu beside **Find** and select **Register patient**.

**Expected result:** a message says the patient is registered. The sheet closes, and the new patient is used for the order.

With an age in place of a birth date, OpenLDR estimates the birth date as 1 January of the year the age gives. The patient record says the birth date is an estimate.

An identifier needs both its system and its value. Leave both empty when the patient has none.

## Link the patient to a found order

Do this when an order shows **No patient linked**, or the wrong patient.

1. Open the order panel's dots menu and select **Link patient**.
2. Find the patient, or register a new one, as in the two tasks above.
3. Select **Use this patient**, or **Register patient** for a new one.

**Expected result:** a message says the patient is linked to the order. The panel shows the patient's name.

The link is kept as a correction, with your name and the reason `Patient linked at reception`.

## Receive the sample

1. Open the order panel's dots menu and select **Receive sample**.
2. Choose **Sample type**. The list holds the sample types the order's tests take, from the test catalog.
3. Choose **Condition**, or leave it at **Not recorded**.
4. Under **For tests**, keep ticked the tests this sample is for.
5. Open the sheet's dots menu and select **Receive sample**.

**Expected result:** a message says, for example, `Sample received for order CS-0001.` The sample shows under **Samples**, with its condition and the time it was received.

An order keeps one sample of each type. Receiving the same type again updates that sample.

The condition list comes from your lab's sample condition value set. If the sheet says `The tests on this order name no sample type.`, add the sample types to those tests in the test catalog.

## Correct a typo in an order

A correction can change the priority, the clinician and the note. To change the patient, use **Link patient**.

1. Open the order panel's dots menu and select **Correct order**.
2. Change **Priority**, **Clinician** or **Note**.
3. Type why in **Reason**, for example `Clinician name misspelt`.
4. Open the sheet's dots menu and select **Save correction**.

**Expected result:** a message says, for example, `Order CS-0001 corrected.` The panel shows the new values.

Each correction is kept with your name and the reason, and is recorded in **Audit**.

A wrong requisition number, facility or test list cannot be corrected. Mark the entry as entered in error and register the order again. For an order from the **Lab order form**, someone who may mark entries in error does this on the form's **Entries** tab. Read [Forms](/docs/forms).

## Limits

- Returning a request to its site, rejecting a sample, worklists and result review come in later releases.
- An order registered at the desk cannot be marked as entered in error in this release. Check its number, facility and tests before you register it.
- Each test on a new order is its own request. An order saved before this release keeps all its tests in one request, and Reception lists all of them.
- A user with a data limit loses **Receive samples** and **Return and reject**, so Reception is not in their menu.

## Troubleshooting

- **Reception is missing from the main menu.** Your account does not hold **Receive samples**, or it has a data limit. Ask an administrator. Read [Users](/docs/users).
- **A search finds no order you expected.** Check the number on the form for a typo. An order made by another system appears once that system's data has reached OpenLDR. If an order you know is stored still does not appear, an administrator can rebuild the search with `openldr lab requisitions rebuild --force`.
- **Search finds no patient.** Check the identifier, or type the full name with the birth date. If the patient is still not found, register them.
- **Save correction says `Nothing has changed.`** Change at least one of **Priority**, **Clinician** or **Note** first.

## Related guides

- [Lab setup](/docs/lab-setup)
- [Forms](/docs/forms)
- [Roles](/docs/roles)
- [Users](/docs/users)
