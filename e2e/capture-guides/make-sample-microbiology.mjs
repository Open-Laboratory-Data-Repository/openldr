// Writes a FHIR transaction Bundle of made-up microbiology for the AMR examples in the docs.
// Deterministic: the same seed always gives the same file, so screenshots and doc numbers match.
//
// It is a second file, beside openldr-sample-lab-data.json, so loading it never changes the
// numbers the other guides quote from that one. Organism and antibiotic codes live in made-up
// urn:openldr:sample: systems. The organism result uses LOINC 634-6 (Bacteria identified),
// which is what the AMR reports read.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const out = process.argv[2] ?? new URL('../../apps/web/public/docs-samples/openldr-sample-microbiology.json', import.meta.url).pathname;
mkdirSync(dirname(out), { recursive: true });

let seed = 20261101;
function rand() {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
}
const pick = (list) => list[Math.floor(rand() * list.length)];
const between = (lo, hi) => lo + rand() * (hi - lo);
const pad = (n, w = 4) => String(n).padStart(w, '0');

const LOINC = 'http://loinc.org';
const INTERPRETATION = 'http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation';
const ORGANISM_SYSTEM = 'urn:openldr:sample:organism';
const ANTIBIOTIC_SYSTEM = 'urn:openldr:sample:antibiotic';
const SPECIMEN_SYSTEM = 'urn:openldr:sample:specimen-type';
const ORIGIN_EXT = 'https://openldr.org/fhir/StructureDefinition/specimen-origin';
const FACILITY_SYSTEM = 'urn:openldr:sample:facility';
// The same three clinics as openldr-sample-lab-data.json.
const FACILITIES = [
  { code: 'SAMPLE-HC-01', display: 'Sample Health Centre North' },
  { code: 'SAMPLE-HC-02', display: 'Sample Health Centre South' },
  { code: 'SAMPLE-HOSP-01', display: 'Sample District Hospital' },
];

const ANTIBIOTICS = {
  AMC: 'Amoxicillin/clavulanic acid', CAZ: 'Ceftazidime', CIP: 'Ciprofloxacin', CLI: 'Clindamycin',
  CRO: 'Ceftriaxone', ERY: 'Erythromycin', GEN: 'Gentamicin', MEM: 'Meropenem', OXA: 'Oxacillin', VAN: 'Vancomycin',
};
// Each organism: how often it is found, where, and the chance of resistance to each drug tested.
const ORGANISMS = [
  { weight: 5, code: 'eco', text: 'Escherichia coli', urine: 0.8, panel: { AMC: 0.4, CIP: 0.45, CRO: 0.35, GEN: 0.2, MEM: 0.03 } },
  { weight: 3, code: 'kpn', text: 'Klebsiella pneumoniae', urine: 0.6, panel: { AMC: 0.5, CIP: 0.4, CRO: 0.55, GEN: 0.3, MEM: 0.08 } },
  { weight: 3, code: 'sau', text: 'Staphylococcus aureus', urine: 0.1, panel: { CIP: 0.25, CLI: 0.2, ERY: 0.35, GEN: 0.1, OXA: 0.3, VAN: 0 } },
  { weight: 2, code: 'pae', text: 'Pseudomonas aeruginosa', urine: 0.4, panel: { CAZ: 0.2, CIP: 0.2, GEN: 0.15, MEM: 0.15 } },
  { weight: 1, code: 'aba', text: 'Acinetobacter baumannii', urine: 0.2, panel: { CIP: 0.7, GEN: 0.6, MEM: 0.5 } },
];
const WEIGHTED = ORGANISMS.flatMap((o) => Array(o.weight).fill(o));
const CULTURES = {
  urine: { code: '630-4', text: 'Urine culture', specimen: { code: 'UR', text: 'Urine' } },
  blood: { code: '600-7', text: 'Blood culture', specimen: { code: 'BL', text: 'Blood' } },
};
const GIVEN = ['Amani', 'Bahati', 'Neema', 'Rehema', 'Salim', 'Tumaini', 'Upendo', 'Zawadi', 'Asha', 'Hassani'];
const FAMILY = ['Example', 'Sample', 'Demo', 'Testcase'];

const entries = [];
const add = (resource) =>
  entries.push({
    fullUrl: `urn:uuid:${resource.resourceType.toLowerCase()}-${resource.id}`,
    resource,
    request: { method: 'PUT', url: `${resource.resourceType}/${resource.id}` },
  });

const PATIENTS = 30;
for (let i = 1; i <= PATIENTS; i++) {
  add({
    resourceType: 'Patient',
    id: `sample-micro-pat-${pad(i)}`,
    identifier: [{ system: 'urn:openldr:sample:patient', value: `SAMPLE-MICRO-${pad(i)}` }],
    name: [{ family: pick(FAMILY), given: [pick(GIVEN)] }],
    gender: rand() < 0.55 ? 'female' : 'male',
    birthDate: `${Math.floor(between(1940, 2024))}-${pad(Math.floor(between(1, 13)), 2)}-${pad(Math.floor(between(1, 28)), 2)}`,
  });
}

const start = Date.UTC(2026, 8, 1); // 1 September 2026, as in the other sample
// Orders stop on 27 October, so every culture, which takes up to four days, reports by 31 October
// and the whole file falls inside a September to October window.
const span = Date.UTC(2026, 9, 27) - start;
const iso = (ms) => new Date(ms).toISOString().replace('.000Z', 'Z');

const ORDERS = 48;
let last = null;
for (let i = 1; i <= ORDERS; i++) {
  // About one culture in six repeats the previous patient and organism a few days later, so the
  // first-isolate reports have a repeat to leave out.
  const repeat = last && rand() < 0.17;
  const organism = repeat ? last.organism : pick(WEIGHTED);
  const patient = repeat ? last.patient : `sample-micro-pat-${pad(1 + Math.floor(rand() * PATIENTS))}`;
  const ordered = repeat ? Math.min(last.ordered + Math.floor(between(2, 9) * 86400_000), start + span) : start + Math.floor(rand() * span);
  const culture = rand() < organism.urine ? CULTURES.urine : CULTURES.blood;
  const facility = pick(FACILITIES);
  const origin = culture === CULTURES.blood || rand() < 0.3 ? 'inpatient' : 'outpatient';
  last = { organism, patient, ordered };

  const id = `sample-micro-req-${pad(i)}`;
  add({
    resourceType: 'ServiceRequest',
    id,
    identifier: [{ system: 'urn:openldr:sample:order', value: `MIC-${pad(i)}` }],
    status: 'completed',
    intent: 'order',
    priority: 'routine',
    code: { coding: [{ system: LOINC, code: culture.code, display: culture.text }], text: culture.text },
    subject: { reference: `Patient/${patient}` },
    authoredOn: iso(ordered),
    requester: { identifier: { system: FACILITY_SYSTEM, value: facility.code }, display: facility.display },
  });

  const specimenId = `sample-micro-spec-${pad(i)}`;
  const received = ordered + Math.floor(between(1, 6) * 3600_000);
  add({
    resourceType: 'Specimen',
    id: specimenId,
    extension: [{ url: ORIGIN_EXT, valueCode: origin }],
    accessionIdentifier: { value: `MACC-${pad(i)}` },
    status: 'available',
    type: { coding: [{ system: SPECIMEN_SYSTEM, code: culture.specimen.code, display: culture.specimen.text }], text: culture.specimen.text },
    subject: { reference: `Patient/${patient}` },
    receivedTime: iso(received),
    request: [{ reference: `ServiceRequest/${id}` }],
  });

  // A culture takes two to three days.
  const resulted = received + Math.floor(between(48, 72) * 3600_000);
  const common = {
    status: 'final',
    basedOn: [{ reference: `ServiceRequest/${id}` }],
    subject: { reference: `Patient/${patient}` },
    specimen: { reference: `Specimen/${specimenId}` },
    effectiveDateTime: iso(resulted),
  };
  const resultRefs = [];
  const orgId = `sample-micro-obs-${pad(i)}-org`;
  resultRefs.push({ reference: `Observation/${orgId}` });
  add({
    resourceType: 'Observation',
    id: orgId,
    ...common,
    code: { coding: [{ system: LOINC, code: '634-6', display: 'Bacteria identified' }], text: 'Bacteria identified' },
    valueCodeableConcept: { coding: [{ system: ORGANISM_SYSTEM, code: organism.code, display: organism.text }], text: organism.text },
  });
  for (const [drug, resistance] of Object.entries(organism.panel)) {
    const roll = rand();
    const result = roll < resistance ? 'R' : roll < resistance + 0.06 ? 'I' : 'S';
    const astId = `sample-micro-obs-${pad(i)}-${drug.toLowerCase()}`;
    resultRefs.push({ reference: `Observation/${astId}` });
    add({
      resourceType: 'Observation',
      id: astId,
      ...common,
      code: { coding: [{ system: ANTIBIOTIC_SYSTEM, code: drug, display: ANTIBIOTICS[drug] }], text: ANTIBIOTICS[drug] },
      interpretation: [{ coding: [{ system: INTERPRETATION, code: result }] }],
    });
  }

  add({
    resourceType: 'DiagnosticReport',
    id: `sample-micro-rep-${pad(i)}`,
    status: 'final',
    code: { coding: [{ system: LOINC, code: culture.code, display: culture.text }], text: culture.text },
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
