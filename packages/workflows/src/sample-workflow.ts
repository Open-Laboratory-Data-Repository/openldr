import type { Workflow } from './types';

// The seeded default workflows for a fresh install: ONE unified ingestion workflow that
// routes by the SHAPE of the posted payload, plus one reactive demo.
//
//   Ingest (wf-ingest, ENABLED):
//     Webhook (POST /api/workflows/hooks/ingest, X-Webhook-Token)
//       → Switch  rule "fhir": body is a FHIR transaction Bundle OR a bare resource array
//           ├─ handle "fhir" → Unwrap FHIR Bundle (sourcePath 'body'; entry[].resource →
//           │                   one item per FHIR resource, tolerates a bare array)
//           └─ fallback "form" → Form Validate ("Lab order" form; sourcePath 'body' →
//                                 answers → ServiceRequest/Observation)
//       → Persist Store (source: webhook-ingest → emits data.persisted)
//       → Log
//     ONE webhook handles BOTH form answers AND pre-built FHIR (e.g. the CDR toolchain); ONE
//     persist stores every resource and the projection routes each by resourceType
//     (Observation → lab_results, ServiceRequest → lab_requests,
//     QuestionnaireResponse → questionnaire_responses, …).
//
//   Reactive (wf-sample-reactive, ENABLED):
//     Event Trigger (data.persisted, source: webhook-ingest) → Log
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
/** Switch rule: route a FHIR transaction Bundle or a bare resource array to the "fhir" branch. */
const FHIR_ROUTE_CONDITION =
  "Array.isArray($json.body) || (!!$json.body && $json.body.resourceType === 'Bundle')";

export interface DefaultWorkflowInput {
  /** Id of the seeded "Lab order" form the ingest workflow's form branch validates against. */
  orderFormId: string;
  /** Per-install shared secret for the ingest webhook (sent as X-Webhook-Token). */
  webhookSecret: string;
}

export function buildDefaultWorkflows({ orderFormId, webhookSecret }: DefaultWorkflowInput): Workflow[] {
  const ingest: Workflow = {
    id: 'wf-ingest',
    name: 'Ingest',
    description:
      'Unified ingestion. POST to /api/workflows/hooks/ingest with header X-Webhook-Token → a ' +
      'Switch routes by payload shape: a FHIR transaction Bundle (or bare resource array) is ' +
      'unwrapped into one item per resource, while form ANSWERS are validated against the ' +
      '"Lab order" form → both persist to the FHIR store (the projection routes each resource ' +
      'by type) → emit data.persisted. Enabled by default — form capture submits through it; ' +
      'copy the webhook secret to let external senders post to it too.',
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
          id: 'route-1',
          type: 'condition',
          position: { x: 360, y: 220 },
          data: {
            label: 'Route by payload shape',
            rules: [{ name: 'fhir', condition: FHIR_ROUTE_CONDITION }],
            fallbackOutput: 'form',
            templateId: 'switch',
            iconName: 'Split',
          },
        },
        {
          id: 'unwrap-1',
          type: 'action',
          position: { x: 660, y: 120 },
          data: {
            label: 'Unwrap FHIR Bundle',
            action: 'unwrap-bundle',
            config: { sourcePath: 'body' },
            templateId: 'unwrap-bundle',
            iconName: 'PackageOpen',
          },
        },
        {
          id: 'form-validate-1',
          type: 'action',
          position: { x: 660, y: 320 },
          data: {
            label: 'Validate form answers',
            action: 'form-validate',
            config: { formId: orderFormId, sourcePath: 'body' },
            templateId: 'form-validate',
            iconName: 'ClipboardCheck',
          },
        },
        {
          id: 'persist-1',
          type: 'action',
          position: { x: 960, y: 220 },
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
          position: { x: 1260, y: 220 },
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
        { id: 'e1', source: 'trigger-1', target: 'route-1' },
        { id: 'e2', source: 'route-1', target: 'unwrap-1', sourceHandle: 'fhir' },
        { id: 'e3', source: 'route-1', target: 'form-validate-1', sourceHandle: 'form' },
        { id: 'e4', source: 'unwrap-1', target: 'persist-1' },
        { id: 'e5', source: 'form-validate-1', target: 'persist-1' },
        { id: 'e6', source: 'persist-1', target: 'log-1' },
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
