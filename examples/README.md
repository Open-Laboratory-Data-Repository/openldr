# Examples

Small files you can import into OpenLDR. Each folder matches one studio page that has an Import
action. A test in the repo runs every file through the same checks its import runs, so a file
here imports without change on the release it comes from.

All values are made up. No file holds real patient data or a country's own codes.

- `dashboards/` is two dashboards for the Dashboard page.
- `facilities/` is a facility list for the Facilities page.
- `forms/` is a lab order form for the Forms page.
- `queries/` is a file of saved queries for the Query page.
- `terminology/` is a list of terms and a value set for the Terminology page.
- `test-catalog/` is a list of tests for the Test catalog page.
- `workflows/` is a workflow with a saved mapping, a payload it maps, and a script that sends it.

Try them on a test installation first. An import adds rows to the install it runs on.
