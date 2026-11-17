import type { Workflow } from './types';

// The seeded default workflows for a fresh install: ONE ingestion workflow, plus one reactive demo.
//
//   Ingest (wf-ingest, ENABLED):
//     Webhook (POST /api/workflows/hooks/ingest, X-Webhook-Token)
//       -> Map to FHIR (sourcePath 'body'; target Lab result; allowed form: "Lab order"; no mapping)
//            out  -> Persist Store (source: webhook-ingest, emits data.persisted) -> Log
//            held -> nothing, on purpose
//     Map to FHIR sends FHIR (a Bundle, a resource list or one resource) on as its resources, turns
//     answers to the "Lab order" form into records, and holds anything else with a reason. A lab
//     adds saved mappings for its own rows in the studio. With `held` unwired, one held item fails
//     the node and the run, naming the count and the first reasons, and Persist does not run. So a
//     sender whose data cannot be stored gets an error, as before Map to FHIR, never a 200. A
//     workflow that should store the good rows and set the bad ones aside wires `held` to a node of
//     its own. ONE persist stores every resource and the
//     projection routes each by resourceType (Observation -> lab_results, ServiceRequest ->
//     lab_requests, QuestionnaireResponse -> questionnaire_responses, and so on).
//
//   Reactive (wf-sample-reactive, ENABLED):
//     Event Trigger (data.persisted, source: webhook-ingest) -> Log
//
// This graph reaches fresh installs and the reset action only. A stored wf-ingest is never
// migrated: an install seeded earlier keeps its Switch, Unwrap and Form Validate graph.
//
// wf-ingest ships ENABLED. It used to ship disabled, on the reasoning that it exposes a live
// HTTP endpoint the operator should opt into — defensible while the workflow served only that
// inbound webhook. It no longer does: POST /api/forms/:id/responses runs hand-captured clinical
// data through this same workflow, so a fresh install that shipped it disabled would 409 every
// form submission. It is now install-critical infrastructure, not an optional demo.
//
// Enabling it does NOT make the endpoint open: the webhook still requires the per-install
// X-Webhook-Token secret, which is generated at seed time and never leaves the install, so an
// unauthenticated caller gets nothing. The reactive workflow also ships ENABLED (no external
// surface). Pure builder: the form id and the webhook secret are injected by the seed
// (packages/bootstrap/src/seed.ts) at seed time so no secret is committed.
//
// Seeding is create-if-absent by id (see seedDefaultWorkflowsFor), so this `enabled: true` default
// only ever applies to a FRESH install. An EXISTING install that already has the row — and, since
// wf-ingest used to ship disabled, most likely has it disabled — is repaired separately by
// `enableIngestWorkflow` in seed.ts, which flips just the `enabled` flag and leaves the operator's
// stored graph alone. `wf-sample-reactive` is NOT repaired that way: nothing depends on it.

/** Ingest webhook path, served under `/api/workflows/hooks/`. The CDR toolchain
 *  joins OPENLDR_CE_URL + OPENLDR_CE_HOOK_PATH, so that variable takes the FULL
 *  path `/api/workflows/hooks/ingest` — which is already its default, so a CE
 *  target needs no hook-path config at all. Setting it to the bare `ingest`
 *  used to be documented here and 404s. */
const INGEST_WEBHOOK_PATH = 'ingest';
/** Ingest Persist Store `source` — MUST match the reactive Event Trigger `source`. */
const INGEST_PERSIST_SOURCE = 'webhook-ingest';
/** The Map to FHIR target the Ingest node starts with. A target id, not a clinical code. */
const INGEST_MAP_TARGET = 'lab-result';

export interface DefaultWorkflowInput {
  /** Id of the seeded "Lab order" form whose answers the ingest workflow's Map to FHIR node allows. */
  orderFormId: string;
  /** Per-install shared secret for the ingest webhook (sent as X-Webhook-Token). */
  webhookSecret: string;
}

export function buildDefaultWorkflows({ orderFormId, webhookSecret }: DefaultWorkflowInput): Workflow[] {
  const ingest: Workflow = {
    id: 'wf-ingest',
    name: 'Ingest',
    description:
      'Ingestion. POST to /api/workflows/hooks/ingest with header X-Webhook-Token. Map to FHIR ' +
      'sends FHIR on as its resources, turns answers to the "Lab order" form into records, and ' +
      'turns rows into records by the mappings saved in the node. Records go to Persist store ' +
      'and emit data.persisted. If any part of a message cannot be mapped or fails the checks, ' +
      'the run fails with the reasons and nothing from it is stored. ' +
      'Enabled by default: form capture submits through it. Copy the webhook secret to let ' +
      'external senders post to it too.',
    enabled: true,
    createdBy: null,
    definition: {
      nodes: [
        {
          id: 'trigger-1',
          type: 'webhook',
          position: { x: 60, y: 220 },
          data: {
            label: 'Ingest received',
            path: INGEST_WEBHOOK_PATH,
            method: 'POST',
            secret: webhookSecret,
            templateId: 'webhook-trigger',
            iconName: 'Webhook',
          },
        },
        {
          id: 'map-1',
          type: 'action',
          position: { x: 360, y: 220 },
          data: {
            label: 'Map to FHIR',
            action: 'map-to-fhir',
            config: { sourcePath: 'body', targetId: INGEST_MAP_TARGET, formIds: [orderFormId], mappings: [] },
            templateId: 'map-to-fhir',
            iconName: 'ArrowRightLeft',
          },
        },
        {
          id: 'persist-1',
          type: 'action',
          position: { x: 660, y: 120 },
          data: {
            label: 'Persist store',
            action: 'persist-store',
            config: { source: INGEST_PERSIST_SOURCE },
            templateId: 'persist-store',
            iconName: 'Database',
          },
        },
        {
          id: 'log-1',
          type: 'action',
          position: { x: 960, y: 120 },
          data: {
            label: 'Log persisted',
            action: 'log',
            message: 'Persisted ingest: {{ $json }}',
            level: 'info',
            config: {},
            templateId: 'log',
            iconName: 'Terminal',
          },
        },
      ],
      edges: [
        { id: 'e1', source: 'trigger-1', target: 'map-1' },
        { id: 'e2', source: 'map-1', target: 'persist-1', sourceHandle: 'out' },
        { id: 'e3', source: 'persist-1', target: 'log-1' },
      ],
    },
  };

  const reactive: Workflow = {
    id: 'wf-sample-reactive',
    name: 'On Ingest Persisted → Log',
    description:
      'Reacts to the data.persisted event emitted when the Ingest workflow stores a record ' +
      '(source webhook-ingest) and logs a summary. Demonstrates the event-driven half of the ' +
      'ingestion loop — enable "Ingest" and POST to see it fire.',
    enabled: true,
    createdBy: null,
    definition: {
      nodes: [
        {
          id: 'evt-1',
          type: 'trigger',
          position: { x: 60, y: 220 },
          data: {
            label: 'On data persisted',
            triggerType: 'event',
            config: { event: 'data.persisted', source: INGEST_PERSIST_SOURCE, resourceType: '' },
            templateId: 'event-trigger',
            iconName: 'Radio',
          },
        },
        {
          id: 'log-1',
          type: 'action',
          position: { x: 300, y: 220 },
          data: {
            label: 'Log reaction',
            action: 'log',
            message: 'Reacted to {{ $json.count }} {{ $json.resourceTypes }} from {{ $json.source }}',
            level: 'info',
            config: {},
            templateId: 'log',
            iconName: 'Terminal',
          },
        },
      ],
      edges: [{ id: 'e1', source: 'evt-1', target: 'log-1' }],
    },
  };

  return [ingest, reactive];
}
