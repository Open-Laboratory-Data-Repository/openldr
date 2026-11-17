import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fhirXmlToJson } from './from-xml';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

describe('fhirXmlToJson', () => {
  it('turns the culture Bundle sent as XML into the same JSON the lab sent as JSON', () => {
    const res = fhirXmlToJson(fixture('culture-bundle.xml'));
    expect(res).toEqual({ ok: true, json: JSON.parse(fixture('culture-bundle.json')) });
  });

  it('keeps lists, numbers and the comparator the way FHIR JSON has them', () => {
    const res = fhirXmlToJson(fixture('culture-bundle.xml'));
    if (!res.ok) throw new Error(res.error);
    const entries = (res.json as { entry: { resource: Record<string, unknown> }[] }).entry;
    const count = entries[4].resource as { valueQuantity: unknown; basedOn: unknown[] };
    expect(count.valueQuantity).toEqual({ value: 100000, comparator: '>', unit: 'CFU/mL', system: 'http://unitsofmeasure.org', code: '{CFU}/mL' });
    expect(count.basedOn).toHaveLength(1);
    expect((entries[0].resource as { name: { given: unknown }[] }).name[0].given).toEqual(['Ruth']);
  });

  it('reads one resource on its own, with meta, narrative, an extension, a primitive extension and true/false', () => {
    const xml = `<?xml version="1.0"?>
<Patient xmlns="http://hl7.org/fhir">
  <id value="p1"/>
  <meta><versionId value="2"/><lastUpdated value="2026-11-17T08:00:00Z"/><profile value="http://example.org/p"/></meta>
  <text><status value="generated"/><div xmlns="http://www.w3.org/1999/xhtml"><p>Ruth <b>Chirwa</b></p></div></text>
  <extension url="http://example.org/ext/ward"><valueString value="OPD 2"/></extension>
  <extension url="http://example.org/ext/visits"><valueInteger value="3"/></extension>
  <active value="true"/>
  <name id="n1"><family value="Chirwa"/><given value="Ruth"/><given value="Anna"/></name>
  <birthDate value="1988-03-08"><extension url="http://example.org/ext/estimated"><valueBoolean value="false"/></extension></birthDate>
  <multipleBirthInteger value="2"/>
</Patient>`;
    const res = fhirXmlToJson(xml);
    expect(res).toEqual({
      ok: true,
      json: {
        resourceType: 'Patient',
        id: 'p1',
        meta: { versionId: '2', lastUpdated: '2026-11-17T08:00:00Z', profile: ['http://example.org/p'] },
        text: { status: 'generated', div: '<div xmlns="http://www.w3.org/1999/xhtml"><p>Ruth <b>Chirwa</b></p></div>' },
        extension: [
          { url: 'http://example.org/ext/ward', valueString: 'OPD 2' },
          { url: 'http://example.org/ext/visits', valueInteger: 3 },
        ],
        active: true,
        name: [{ id: 'n1', family: 'Chirwa', given: ['Ruth', 'Anna'] }],
        birthDate: '1988-03-08',
        _birthDate: { extension: [{ url: 'http://example.org/ext/estimated', valueBoolean: false }] },
        multipleBirthInteger: 2,
      },
    });
  });

  it('accepts a namespace prefix on the FHIR elements', () => {
    const res = fhirXmlToJson('<f:Patient xmlns:f="http://hl7.org/fhir"><f:id value="p2"/><f:gender value="female"/></f:Patient>');
    expect(res).toEqual({ ok: true, json: { resourceType: 'Patient', id: 'p2', gender: 'female' } });
  });

  it('refuses XML that is not FHIR, with 415', () => {
    const res = fhirXmlToJson('<results><row pat_no="LAB-1"/></results>');
    expect(res).toMatchObject({ ok: false, status: 415 });
    if (res.ok) return;
    expect(res.error).toContain('http://hl7.org/fhir');
  });

  it('refuses a FHIR resource type CE does not store, with 415 naming it', () => {
    const res = fhirXmlToJson('<Medication xmlns="http://hl7.org/fhir"><id value="m1"/></Medication>');
    expect(res).toMatchObject({ ok: false, status: 415 });
    if (res.ok) return;
    expect(res.error).toContain('Medication');
  });

  it('refuses a Bundle that holds a resource type CE does not store', () => {
    const res = fhirXmlToJson('<Bundle xmlns="http://hl7.org/fhir"><type value="collection"/><entry><resource><Medication><id value="m1"/></Medication></resource></entry></Bundle>');
    expect(res).toMatchObject({ ok: false, status: 415 });
  });

  it('refuses broken XML with 400', () => {
    expect(fhirXmlToJson('<Patient xmlns="http://hl7.org/fhir"><id value="p1"></Patient>')).toMatchObject({ ok: false, status: 400 });
    expect(fhirXmlToJson('')).toMatchObject({ ok: false, status: 400 });
  });

  it('refuses a DOCTYPE, so no entity can expand, with 400', () => {
    const xml = '<?xml version="1.0"?><!DOCTYPE p [<!ENTITY a "aaaa">]><Patient xmlns="http://hl7.org/fhir"><id value="&a;"/></Patient>';
    expect(fhirXmlToJson(xml)).toMatchObject({ ok: false, status: 400 });
  });

  it('refuses a number element that does not hold a number, with 400', () => {
    const res = fhirXmlToJson('<Patient xmlns="http://hl7.org/fhir"><multipleBirthInteger value="two"/></Patient>');
    expect(res).toMatchObject({ ok: false, status: 400 });
    if (res.ok) return;
    expect(res.error).toContain('Patient.multipleBirthInteger');
  });
});
