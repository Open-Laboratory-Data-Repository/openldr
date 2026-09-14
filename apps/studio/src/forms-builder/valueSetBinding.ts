import type { FhirBinding } from '@openldr/fhir/paths';
import type { BindingStrength, FormField, FormFieldOption } from '@openldr/forms/pure';
import type { ExpandedCode, ValueSetInput } from '../api';

/**
 * What binding a field to a ValueSet does. Pure. Ported from corlix `lib/valueSetBinding.ts`.
 */

export const BINDING_STRENGTHS: readonly BindingStrength[] = ['required', 'extensible', 'preferred', 'example'];

/** Where "Save as a new ValueSet" anchors typed options. Migration 014 already seeds local codes on it. */
export const LOCAL_OPTIONS_SYSTEM = 'urn:openldr:cs:local';

/** `required` is the only strength that forbids a value outside the set. */
export function strengthLocksCustomValue(strength: BindingStrength): boolean {
  return strength === 'required';
}

export function codesToOptions(codes: ExpandedCode[]): FormFieldOption[] {
  return codes.map((c) => ({ code: c.code, display: c.display ?? c.code }));
}

/** The patch that binds a field: the link, the strength, and the set's stored codes as options. */
export function bindingUpdates(url: string, strength: BindingStrength, options: FormFieldOption[]): Partial<FormField> {
  const patch: Partial<FormField> = { valueSetUrl: url, bindingStrength: strength, valueSetOptions: options };
  if (strengthLocksCustomValue(strength)) patch.allowCustomValue = false;
  return patch;
}

/**
 * Whether picking a path auto-binds the field to FHIR's standard set. Only a `required` or
 * `extensible` binding does: preferred and example sets are illustrations, and some hold thousands
 * of codes. A bound field, a group, and a field that names a reference source are left alone
 * (operator ruling, 2026-09-14). Corlix auto-binds at every strength.
 */
export function autoBindApplies(field: FormField, binding: FhirBinding | null): boolean {
  if (!binding) return false;
  if (binding.strength !== 'required' && binding.strength !== 'extensible') return false;
  if (field.valueSetUrl) return false;
  if (field.fieldType === 'group') return false;
  if (field.referenceTarget) return false;
  return true;
}

export function suggestValueSetUrl(title: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'value-set';
  return `urn:openldr:valueset:${slug}`;
}

/** An enumerated ValueSet from a typed option list, on the local system. */
export function optionsToValueSetInput(p: { title: string; url: string; options: FormFieldOption[] }): ValueSetInput {
  return {
    url: p.url,
    name: p.url.split(/[:/]/).pop() || p.url,
    title: p.title,
    status: 'active',
    publisherId: 'pub-system',
    compose: { include: [{ system: LOCAL_OPTIONS_SYSTEM, concept: p.options.map((o) => ({ code: o.code, display: o.display })) }] },
  };
}
