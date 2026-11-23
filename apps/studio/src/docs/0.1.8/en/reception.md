# Reception

Reception is the lab's front desk. When a sample arrives, you find its order by the requisition number, register the order if the lab has no record of it, link the patient and record the sample with its condition. You can also return a request to its site, reject a sample or a test, and link the redraw. Reception staff and lab managers use it.

You need **Receive samples** to open **Reception**. The built-in **Reception** and **Lab Manager** roles hold it. A user with a data limit cannot open Reception, whatever their role gives.

Returning, rejecting and **Corrected by site** also need **Return and reject**. The **Reception** and **Lab Manager** roles hold both. **Lab Technician** holds **Return and reject** but not **Receive samples**, so it cannot open Reception.

**Worklists and result review are not in this release.** They come in later releases.

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
3. Choose **Birth date**. If no one knows it, type the age in **Age in years** instead. If you fill in both, the birth date is used.
4. If the patient has an identifier, type **Identifier system** and **Identifier value**.
5. Open the dots menu beside **Find** and select **Register patient**.

**Expected result:** a message says the patient is registered. The sheet closes, and the new patient is used for the order.

With an age in place of a birth date, OpenLDR estimates the birth date as 1 January of the year the age gives. The patient record says the birth date is an estimate.

An identifier needs both its system and its value. Leave both empty when the patient has none.

## Link the patient to a found order

Do this when an order shows **No patient linked**, or the wrong patient.

1. Open the order panel's dots menu and select **Link patient**.
2. Find the patient, or register a new one, as in the two tasks above.
3. Open the dots menu beside **Find** and select **Use this patient**, or **Register patient** for a new one.

**Expected result:** a message says the patient is linked to the order. The panel shows the patient's name.

The link is kept as a correction, with your name and the reason `Patient linked at reception`. Samples already received for the order move to the new patient too.

## Receive the sample

1. Open the order panel's dots menu and select **Receive sample**.
2. Choose **Sample type**. The list holds the sample types the order's tests take, from the test catalog.
3. Choose **Condition**, or leave it at **Not recorded**.
4. Under **For tests**, keep ticked the tests this sample is for.
5. Open the sheet's dots menu and select **Receive sample**.

**Expected result:** a message says, for example, `Sample received for order CS-0001.` The sample shows under **Samples**, with its condition and the time it was received.

An order keeps one sample of each type. Receiving the same type again updates that sample and keeps the time it was first received.

A rejected sample cannot be received again. Register a redraw order for the new sample, as in [Link a redraw to the rejected order](#link-a-redraw-to-the-rejected-order).

The condition list comes from your lab's sample condition value set. If the sheet says `The tests on this order name no sample type. Map these tests to a sample type in the test catalog.`, add the sample types to those tests in the test catalog.

## Correct a typo in an order

A correction can change the priority, the clinician and the note. To change the patient, use **Link patient**.

1. Open the order panel's dots menu and select **Correct order**.
2. Change **Priority**, **Clinician** or **Note**.
3. Type why in **Reason**, for example `Clinician name misspelt`.
4. Open the sheet's dots menu and select **Save correction**.

**Expected result:** a message says, for example, `Order CS-0001 corrected.` The panel shows the new values.

Each correction is kept with your name and the reason, and is recorded in **Audit**.

A wrong requisition number, facility or test list cannot be corrected. For an order **Registered at the desk**, cancel the registration and register the order again, as in the next task. For an order from the **Lab order form**, someone who may mark entries in error marks the entry on the form's **Entries** tab, then you register the order again. Read [Forms](/docs/forms).

## Cancel a desk registration

Do this when an order registered at the desk has the wrong number, facility or test list. **Cancel registration** shows only for an order marked **Registered at the desk**.

1. Open the order panel's dots menu and select **Cancel registration**.
2. Type why in **Reason**, for example `Wrong test list`.
3. Open the sheet's dots menu and select **Cancel registration**.

**Expected result:** a message says, for example, `Order CS-0001 cancelled.` Each test on the order shows the status **Entered in error**.

Each cancelled test is kept with your name and the reason, and the cancel is recorded in **Audit**. A cancelled order takes no sample.

To register the order again with the right details, search for the number and follow [Register an order that is not found](#register-an-order-that-is-not-found). The new tests show in the same panel. The cancelled ones stay listed as **Entered in error**.

## Return an order to its site

Do this when a request form has a mistake only the site can fix, such as an incomplete form. You need **Return and reject**.

1. Open the order panel's dots menu and select **Return to site**.
2. Choose why in **Reason**.
3. Type a **Note** for the site if it helps.
4. Open the sheet's dots menu and select **Return to site**.

**Expected result:** a message says, for example, `Order CS-0001 returned to its site.` Each test shows **On hold**. The panel shows **Returned to site** with the reason, who returned it and when.

**Return to site** does not show for an order **Registered at the desk**. Correct a desk order yourself instead. It does not show for an order already returned either. It is also hidden when a test is already on hold, and when the order has no facility.

While an order is returned, **Correct order** is not in the menu. The site makes the corrections.

A site cannot yet see a returned request on its own screen. Tell the site by phone or message, with the reason.

## Mark a returned order corrected

Do this when the site sends back its corrections. You need **Return and reject**. **Corrected by site** shows only on a returned order.

1. Open the order panel's dots menu and select **Corrected by site**.
2. Change **Priority**, **Clinician** or **Note** to what the site sent. Leave them if the site fixed something else.
3. Type why in **Reason**, for example `Site sent the completed form`.
4. Open the sheet's dots menu and select **Mark corrected**.

**Expected result:** a message says, for example, `Order CS-0001 marked corrected.` The tests come off hold and show **Active**. **Correct order** is back in the menu.

## Reject a sample

Do this when a sample cannot be tested, for example because it is unlabelled or clotted. You need **Return and reject**.

1. Open the order panel's dots menu and select **Reject sample**.
2. Choose **Sample type**. The list holds the sample types the order's tests take.
3. Choose **Condition**.
4. Choose why in **Reason**.
5. Leave **Ask for a redraw** on to ask the site for a new sample. Turn it off if no new sample is needed.
6. Open the sheet's dots menu and select **Reject sample**.

**Expected result:** a message says, for example, `Sample rejected for order CS-0001.` Each test this sample is for shows **Revoked**, with `Rejected:` and the reason under it.

Rejecting a sample rejects every test it is for. To reject one test only, use the next task.

The sample shows **Rejected** under **Samples**.

**Reject sample** is hidden when every test on the order is cancelled or rejected.

## Reject one test

Do this when one test cannot be run, but the order's other tests can go on. You need **Return and reject**.

1. Open the dots menu at the right of the test's row and select **Reject test**.
2. Check the test name beside **Test**.
3. Choose why in **Reason**.
4. Leave **Ask for a redraw** on, or turn it off if no new sample is needed.
5. Open the sheet's dots menu and select **Reject test**.

**Expected result:** a message says the test is rejected. The test shows **Revoked**, with `Rejected:` and the reason under it. The order's other tests do not change.

On an order saved before this release, several tests can share one request. Those test rows have no dots menu. Reject them with **Reject sample**.

## Link a redraw to the rejected order

Do this when the new sample arrives for a rejected order. The redraw comes on its own request form, with a new requisition number. The old number still names the rejected order.

1. Find the redraw's order by its new number, or register it.
2. Open the redraw's order panel dots menu and select **Replaces a rejected order**.
3. Type the old number in **Rejected order number**.
4. Open the sheet's dots menu and select **Link redraw**.

**Expected result:** a message says, for example, `Order CS-0002 linked as the redraw of CS-0001.`

Both orders must be from the same facility. The redraw must hold at least one test the old order rejected. You need **Receive samples** for this task.

**Replaces a rejected order** is hidden when every test on the order is cancelled or rejected.

A site cannot yet see a redraw request on its own screen. Tell the site that the lab needs a new sample.

## Limits

- Worklists and result review come in later releases.
- A site cannot yet see a returned request or a redraw request on its own screen. The lab tells the site.
- Returning, rejecting and linking a redraw are not `openldr` commands yet.
- Each test on a new order is its own request. An order saved before this release keeps all its tests in one request, and Reception lists all of them.
- A user with a data limit loses **Receive samples** and **Return and reject**, so Reception is not in their menu.

## Troubleshooting

- **Reception is missing from the main menu.** Your account does not hold **Receive samples**, or it has a data limit. Ask an administrator. Read [Users](/docs/users).
- **A search finds no order you expected.** Check the number on the form for a typo. An order made by another system appears once that system's data has reached OpenLDR. If an order you know is stored still does not appear, an administrator can rebuild the search with `openldr lab requisitions rebuild --force`.
- **Search finds no patient.** Check the identifier, or type the full name with the birth date. If the patient is still not found, register them.
- **Save correction says `Nothing has changed.`** Change at least one of **Priority**, **Clinician** or **Note** first.
- **Return to site, Reject sample or Reject test is missing.** Your account does not hold **Return and reject**. Return to site is also missing for a desk order and for an order already returned.
- **Link redraw is refused.** Check that you typed the rejected order's number, not the redraw's own. Check that both orders are from the same facility, and that the redraw holds a test the old order rejected.
- **A reason you need is not in the list.** Add it in **Terminology**, to `urn:openldr:valueset:order-return-reason` for returns, `urn:openldr:valueset:order-reject-reason` for samples, `urn:openldr:valueset:test-reject-reason` for tests, or `urn:openldr:valueset:sample-condition` for conditions. Read [Terminology](/docs/terminology).

## Related guides

- [Lab setup](/docs/lab-setup)
- [Terminology](/docs/terminology)
- [Forms](/docs/forms)
- [Roles](/docs/roles)
- [Users](/docs/users)
