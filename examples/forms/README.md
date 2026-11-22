# Form examples

`lab-order.form.json` is a short lab order form. It builds a FHIR ServiceRequest. It has two
sections:

- Patient, with a patient search.
- Order details, with the tests to run, a priority and a box for clinical notes.

The tests come from the install's own test list, the value set `urn:openldr:valueset:lab-tests`.

## Import in studio

1. Open the Forms page.
2. Open the form actions menu and choose Import.
3. Choose `lab-order.form.json`.

## Import from the command line

There is no command for this. Use the Forms page.

## What you see afterwards

The Forms page lists `Example: lab order` as a draft. Open it in the builder to change it, then
publish it when it is ready to use.
