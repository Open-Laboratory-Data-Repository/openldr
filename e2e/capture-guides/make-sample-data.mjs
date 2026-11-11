// Writes a FHIR transaction Bundle of made-up lab activity for the docs examples.
// Deterministic: the same seed always gives the same file, so screenshots and doc numbers match.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

// Default output: the landing site's public folder, so deployers can download it from the docs.
const out = process.argv[2] ?? new URL('../../apps/web/public/docs-samples/openldr-sample-lab-data.json', import.meta.url).pathname;
mkdirSync(dirname(out), { recursive: true });

let seed = 20261001;
function rand() {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
}
const pick = (list) => list[Math.floor(rand() * list.length)];
const between = (lo, hi) => lo + rand() * (hi - lo);
const pad = (n, w = 4) => String(n).padStart(w, '0');

const LOINC = 'http://loinc.org';
const FACILITIES = [
  { code: 'SAMPLE-HC-01', display: 'Sample Health Centre North' },
  { code: 'SAMPLE-HC-02', display: 'Sample Health Centre South' },
  { code: 'SAMPLE-HOSP-01', display: 'Sample District Hospital' },
];
const FACILITY_SYSTEM = 'urn:openldr:sample:facility';

// Each test: the order code, the specimen type, and the results it produces. A test with one
// result gives that result the test's own name, as most lab systems do. Full blood count shows
// the other case: one order, two differently named results.
const TESTS = [
  {
    weight: 5, code: '58410-2', text: 'Full blood count', specimen: 'Whole blood',
    results: [
      { code: '718-7', text: 'Haemoglobin', unit: 'g/dL', lo: 7, hi: 17, normal: [12, 16] },
      { code: '6690-2', text: 'White cell count', unit: '10*3/uL', lo: 2, hi: 18, normal: [4, 11] },
    ],
  },
  {
    weight: 4, code: '20447-9', text: 'HIV viral load', specimen: 'Plasma',
    results: [{ code: '20447-9', text: 'HIV viral load', unit: 'copies/mL', lo: 20, hi: 60000, normal: [0, 1000] }],
  },
  {
    weight: 3, code: '2345-7', text: 'Blood glucose', specimen: 'Serum',
    results: [{ code: '2345-7', text: 'Blood glucose', unit: 'mg/dL', lo: 55, hi: 260, normal: [70, 140] }],
  },
  {
    weight: 3, code: '70569-9', text: 'Malaria rapid test', specimen: 'Whole blood',
    results: [{ code: '70569-9', text: 'Malaria rapid test', coded: ['Positive', 'Negative', 'Negative'] }],
  },
  {
    weight: 2, code: '2160-0', text: 'Creatinine', specimen: 'Serum',
    results: [{ code: '2160-0', text: 'Creatinine', unit: 'mg/dL', lo: 0.4, hi: 3.2, normal: [0.6, 1.2] }],
  },
];
const WEIGHTED = TESTS.flatMap((t) => Array(t.weight).fill(t));
const PRIORITIES = ['routine', 'routine', 'routine', 'routine', 'urgent', 'urgent', 'stat'];
const GIVEN = ['Amina', 'Baraka', 'Chausiku', 'Daudi', 'Esther', 'Faraji', 'Grace', 'Hamisi', 'Imani', 'Juma', 'Kesi', 'Lulu'];
const FAMILY = ['Example', 'Sample', 'Demo', 'Testcase'];

const entries = [];
const add = (resource) =>
  entries.push({
    fullUrl: `urn:uuid:${resource.resourceType.toLowerCase()}-${resource.id}`,
    resource,
    request: { method: 'PUT', url: `${resource.resourceType}/${resource.id}` },
  });

const PATIENTS = 24;
for (let i = 1; i <= PATIENTS; i++) {
  add({
    resourceType: 'Patient',
    id: `sample-pat-${pad(i)}`,
    identifier: [{ system: 'urn:openldr:sample:patient', value: `SAMPLE-${pad(i)}` }],
    name: [{ family: pick(FAMILY), given: [pick(GIVEN)] }],
    gender: rand() < 0.55 ? 'female' : 'male',
    birthDate: `${Math.floor(between(1950, 2020))}-${pad(Math.floor(between(1, 13)), 2)}-${pad(Math.floor(between(1, 28)), 2)}`,
  });
}

const ORDERS = 60;
const start = Date.UTC(2026, 8, 1); // 1 September 2026
const span = Date.UTC(2026, 9, 31) - start; // to 31 October 2026
const iso = (ms) => new Date(ms).toISOString().replace('.000Z', 'Z');

for (let i = 1; i <= ORDERS; i++) {
  const test = pick(WEIGHTED);
  const patient = `sample-pat-${pad(1 + Math.floor(rand() * PATIENTS))}`;
  const facility = pick(FACILITIES);
  const ordered = start + Math.floor(rand() * span);
  // Most orders are finished. Some still wait for a result, and a few were cancelled.
  const roll = rand();
  const state = roll < 0.75 ? 'completed' : roll < 0.92 ? 'active' : 'revoked';
  const id = `sample-req-${pad(i)}`;
  add({
    resourceType: 'ServiceRequest',
    id,
    identifier: [{ system: 'urn:openldr:sample:order', value: `ORD-${pad(i)}` }],
    status: state,
    intent: 'order',
    priority: pick(PRIORITIES),
    code: { coding: [{ system: LOINC, code: test.code, display: test.text }], text: test.text },
    subject: { reference: `Patient/${patient}` },
    authoredOn: iso(ordered),
    requester: { identifier: { system: FACILITY_SYSTEM, value: facility.code }, display: facility.display },
  });
  if (state === 'revoked') continue;

  const specimenId = `sample-spec-${pad(i)}`;
  const received = ordered + Math.floor(between(1, 6) * 3600_000);
  add({
    resourceType: 'Specimen',
    id: specimenId,
    accessionIdentifier: { value: `ACC-${pad(i)}` },
    status: 'available',
    type: { text: test.specimen },
    subject: { reference: `Patient/${patient}` },
    receivedTime: iso(received),
    request: [{ reference: `ServiceRequest/${id}` }],
  });
  if (state === 'active') continue;

  const resulted = received + Math.floor(between(2, 30) * 3600_000);
  const resultRefs = [];
  test.results.forEach((r, k) => {
    const obsId = `sample-obs-${pad(i)}-${k + 1}`;
    resultRefs.push({ reference: `Observation/${obsId}` });
    const obs = {
      resourceType: 'Observation',
      id: obsId,
      status: 'final',
      basedOn: [{ reference: `ServiceRequest/${id}` }],
      code: { coding: [{ system: LOINC, code: r.code, display: r.text }], text: r.text },
      subject: { reference: `Patient/${patient}` },
      specimen: { reference: `Specimen/${specimenId}` },
      effectiveDateTime: iso(resulted),
    };
    if (r.coded) {
      const value = pick(r.coded);
      obs.valueCodeableConcept = { text: value };
      if (value === 'Positive') obs.interpretation = [{ coding: [{ code: 'A', display: 'Abnormal' }] }];
    } else {
      const decimals = r.hi > 100 ? 0 : 1;
      const value = Number(between(r.lo, r.hi).toFixed(decimals));
      obs.valueQuantity = { value, unit: r.unit };
      const flag = value > r.normal[1] ? 'H' : value < r.normal[0] ? 'L' : 'N';
      obs.interpretation = [{ coding: [{ code: flag }] }];
    }
    add(obs);
  });

  add({
    resourceType: 'DiagnosticReport',
    id: `sample-rep-${pad(i)}`,
    status: rand() < 0.85 ? 'final' : 'preliminary',
    code: { coding: [{ system: LOINC, code: test.code, display: test.text }], text: test.text },
    subject: { reference: `Patient/${patient}` },
    basedOn: [{ reference: `ServiceRequest/${id}` }],
    specimen: [{ reference: `Specimen/${specimenId}` }],
    effectiveDateTime: iso(resulted),
    issued: iso(resulted + 3600_000),
    performer: [{ identifier: { system: FACILITY_SYSTEM, value: 'SAMPLE-LAB' }, display: 'Sample Central Laboratory' }],
    result: resultRefs,
  });
}

writeFileSync(out, JSON.stringify({ resourceType: 'Bundle', type: 'transaction', entry: entries }) + '\n');
process.stdout.write(`wrote ${out}: ${entries.length} resources\n`);
