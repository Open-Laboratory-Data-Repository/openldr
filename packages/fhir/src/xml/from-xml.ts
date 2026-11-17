import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { isKnownFhirResourceType, lookupFhirPath } from '../paths';

/**
 * FHIR XML to FHIR JSON, for the resource types CE stores and the Bundles that carry them.
 *
 * XML does not say which elements repeat or which values are numbers, so the R4 path table
 * (`paths/r4-paths.generated.ts`) decides. Bundle, Extension, Meta and the narrative are not in
 * that table and have a fixed rule each below. Only XML whose root is in the FHIR namespace is
 * read. A DOCTYPE is refused, so no entity can expand.
 */

export const FHIR_NS = 'http://hl7.org/fhir';

export type FhirXmlResult =
  | { ok: true; json: Record<string, unknown> }
  | { ok: false; status: 400 | 415; error: string };

class Refusal extends Error {
  constructor(readonly status: 400 | 415, message: string) {
    super(message);
  }
}

type XmlNode = Record<string, unknown>;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: false,
  parseTagValue: false,
  parseAttributeValue: false,
  ignoreDeclaration: true,
  stopNodes: ['*.div'],
});

const local = (name: string) => name.slice(name.indexOf(':') + 1);
const toArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : [v]);
const isNode = (v: unknown): v is XmlNode => typeof v === 'object' && v !== null && !Array.isArray(v);

// Elements outside the path table that always repeat, by the end of their path.
const ALWAYS_LISTS = ['.meta.profile', '.meta.security', '.meta.tag', '.contained'];
const BUNDLE_LISTS = ['Bundle.entry', 'Bundle.link', 'Bundle.entry.link'];
// Elements outside the path table that hold numbers.
const NUMBER_PATHS = ['Bundle.total', 'Bundle.entry.search.score'];

function isList(path: string, name: string, count: number): boolean {
  if (name === 'extension' || name === 'modifierExtension') return true;
  const info = lookupFhirPath(path);
  if (info) return info.ownArray;
  if (BUNDLE_LISTS.includes(path)) return true;
  if (ALWAYS_LISTS.some((end) => path.endsWith(end))) return true;
  return count > 1;
}

type Kind = 'string' | 'number' | 'boolean';

function primitiveKind(path: string, name: string): Kind {
  const info = lookupFhirPath(path);
  if (info) return info.leafType === 'number' ? 'number' : info.leafType === 'boolean' ? 'boolean' : 'string';
  if (NUMBER_PATHS.includes(path)) return 'number';
  // Outside the table (an extension's value, mostly), the choice suffix names the type.
  if (/Boolean$/.test(name)) return 'boolean';
  if (/(Integer|Integer64|Decimal|PositiveInt|UnsignedInt)$/.test(name)) return 'number';
  return 'string';
}

/** A path the table knows as a primitive: its leaf type starts lower case (`string`, `code`). */
function isPrimitivePath(path: string): boolean {
  const info = lookupFhirPath(path);
  return !!info && /^[a-z]/.test(info.leafType);
}

function typed(raw: string, kind: Kind, path: string): string | number | boolean {
  if (kind === 'number') {
    const n = Number(raw);
    if (raw.trim() === '' || !Number.isFinite(n)) throw new Refusal(400, `${path}: expected a number`);
    return n;
  }
  if (kind === 'boolean') {
    if (raw !== 'true' && raw !== 'false') throw new Refusal(400, `${path}: expected true or false`);
    return raw === 'true';
  }
  return raw;
}

function attrs(node: XmlNode): string {
  return Object.keys(node)
    .filter((k) => k.startsWith('@_'))
    .map((k) => ` ${k.slice(2)}="${String(node[k]).replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`)
    .join('');
}

/** The narrative keeps its XHTML as one string, as FHIR JSON does. */
function divString(v: unknown): string {
  if (typeof v === 'string') return `<div>${v}</div>`;
  if (!isNode(v)) return '<div></div>';
  return `<div${attrs(v)}>${String(v['#text'] ?? '')}</div>`;
}

function extensionsOf(v: XmlNode, path: string): unknown[] | undefined {
  const key = Object.keys(v).find((k) => local(k) === 'extension');
  return key === undefined ? undefined : toArray(v[key]).map((e) => convertExtension(e, `${path}.extension`));
}

function convertExtension(v: unknown, path: string): XmlNode {
  if (!isNode(v)) throw new Refusal(400, `${path}: an extension needs a url`);
  const out: XmlNode = {};
  if (v['@_id'] !== undefined) out.id = String(v['@_id']);
  if (v['@_url'] !== undefined) out.url = String(v['@_url']);
  for (const key of Object.keys(v)) {
    if (key.startsWith('@_')) continue;
    const name = local(key);
    // An extension's own path is not in the table, so its children use the fallback rules.
    assign(out, name, `Extension.${name}`, toArray(v[key]));
  }
  return out;
}

function convertResource(type: string, v: unknown): XmlNode {
  if (type !== 'Bundle' && !isKnownFhirResourceType(type)) {
    throw new Refusal(415, `FHIR XML for ${type} is not supported. CE reads Bundle and the resource types it stores.`);
  }
  const out: XmlNode = { resourceType: type };
  if (isNode(v)) fill(out, v, type);
  return out;
}

/** A child that holds one resource: `<resource><Patient>…</Patient></resource>`. */
function convertWrapped(v: unknown, path: string): XmlNode {
  if (!isNode(v)) throw new Refusal(400, `${path}: expected a resource`);
  const keys = Object.keys(v).filter((k) => !k.startsWith('@_'));
  if (keys.length !== 1) throw new Refusal(400, `${path}: expected exactly one resource`);
  return convertResource(local(keys[0]), v[keys[0]]);
}

function convertValue(path: string, name: string, v: unknown): { value: unknown; under?: XmlNode } {
  if (name === 'div') return { value: divString(v) };
  if (name === 'extension' || name === 'modifierExtension') return { value: convertExtension(v, path) };
  if (name === 'contained' || path === 'Bundle.entry.resource' || path === 'Bundle.entry.response.outcome') {
    return { value: convertWrapped(v, path) };
  }
  if (typeof v === 'string') {
    // `<x/>` parses as '' and holds nothing. Any other text is not FHIR XML.
    if (v.trim() === '') return { value: {} };
    throw new Refusal(400, `${path}: FHIR XML keeps values in a value attribute, not as text`);
  }
  if (!isNode(v)) return { value: v };
  const hasValue = v['@_value'] !== undefined;
  if (hasValue || isPrimitivePath(path)) {
    const value = hasValue ? typed(String(v['@_value']), primitiveKind(path, name), path) : null;
    const under: XmlNode = {};
    if (v['@_id'] !== undefined) under.id = String(v['@_id']);
    const ext = extensionsOf(v, path);
    if (ext) under.extension = ext;
    return Object.keys(under).length > 0 ? { value, under } : { value };
  }
  const out: XmlNode = {};
  if (v['@_id'] !== undefined) out.id = String(v['@_id']);
  fill(out, v, path);
  return { value: out };
}

function assign(out: XmlNode, name: string, path: string, values: unknown[]): void {
  const results = values.map((v) => convertValue(path, name, v));
  const many = isList(path, name, values.length);
  if (!many && results.length > 1) throw new Refusal(400, `${path}: appears ${results.length} times but FHIR allows one`);
  out[name] = many ? results.map((r) => r.value) : results[0].value;
  if (results.some((r) => r.under)) out[`_${name}`] = many ? results.map((r) => r.under ?? null) : results[0].under;
}

function fill(out: XmlNode, node: XmlNode, path: string): void {
  for (const key of Object.keys(node)) {
    if (key.startsWith('@_') || key === '#text') continue;
    const name = local(key);
    assign(out, name, `${path}.${name}`, toArray(node[key]));
  }
}

export function fhirXmlToJson(xml: string): FhirXmlResult {
  try {
    if (xml.trim() === '') throw new Refusal(400, 'the body is empty');
    if (/<!DOCTYPE/i.test(xml)) throw new Refusal(400, 'FHIR XML may not carry a DOCTYPE');
    const valid = XMLValidator.validate(xml);
    if (valid !== true) throw new Refusal(400, `the XML is not well formed: ${valid.err.msg} (line ${valid.err.line})`);
    const doc = parser.parse(xml) as XmlNode;
    const roots = Object.keys(doc).filter((k) => !k.startsWith('?'));
    if (roots.length !== 1) throw new Refusal(400, 'expected one root element');
    const rootKey = roots[0];
    const root = (isNode(doc[rootKey]) ? doc[rootKey] : {}) as XmlNode;
    const prefix = rootKey.includes(':') ? rootKey.slice(0, rootKey.indexOf(':')) : '';
    const ns = root[prefix ? `@_xmlns:${prefix}` : '@_xmlns'];
    if (ns !== FHIR_NS) {
      throw new Refusal(415, `only FHIR XML is accepted: the root element must be in the ${FHIR_NS} namespace`);
    }
    return { ok: true, json: convertResource(local(rootKey), root) };
  } catch (err) {
    if (err instanceof Refusal) return { ok: false, status: err.status, error: err.message };
    throw err;
  }
}
