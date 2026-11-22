# Workflow examples

Try this on a test installation. Running it stores a made-up patient with lab results.

- `ingest-lab-rows.workflow.json` is a workflow that takes lab rows from a webhook. Its Map to FHIR
  step turns each row into a patient, a specimen, an order and a result, by the mapping saved in
  the step. It stores what it maps and logs it. A row it cannot map is held, not stored, and logged
  with the reason. The workflow arrives switched off and with no webhook secret.
- `payload.json` holds three made-up rows. Each patient has the surname `Example` and an ID that
  starts with `EXAMPLE-`.
- `send.sh` posts `payload.json` to the workflow's webhook, `/api/workflows/hooks/examples/lab-rows`.

## Import in studio

1. Open the Workflows page.
2. Open the workflows actions menu and choose Import.
3. Choose `ingest-lab-rows.workflow.json`.

## Import from the command line

There is no command for this. Use the Workflows page.

## Set a secret and turn it on

1. Open the workflow and select its first step, Lab rows received.
2. The Secret box fills in a new secret. Copy it, then save the workflow.
3. Back on the Workflows page, open the workflow's row menu and choose Enable.

## Send the rows

Run `send.sh` with two settings: the address you open studio with, and the secret you copied.

```
OPENLDR_URL=<the address you open studio with> OPENLDR_WEBHOOK_SECRET=<the secret> sh examples/workflows/send.sh
```

On an install with a self-signed certificate, curl needs that certificate. Add
`CURL_CA_BUNDLE=<path to the install's certificate>` to the start of the command.

The script stops if either setting is missing. It never holds a secret itself.

## What you see afterwards

The script prints the reply, with `"ok": true` and the run's ID. Open the workflow and its run
history to see the run. The three made-up patients and their results are stored on the install.
