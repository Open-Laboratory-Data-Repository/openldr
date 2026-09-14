import type { FormField } from './schema/form-schema';

/**
 * A field's `fhirDiscriminator` as one short line for the field row, for example
 * `system = urn:x`.
 *
 * Two fields bound to `Location.identifier.value` are the same text on screen. The discriminator
 * is the only thing telling them apart, and until this line existed it was invisible in CE.
 * Keys are sorted, so one discriminator always reads the same whatever order it was written in.
 * Returns null when there is nothing to show, so the caller skips the line.
 *
 * Ported from corlix `apps/desktop/src/renderer/lib/discriminatorLabel.ts`. Slice S2 adds the
 * All/Any rule shape.
 */
export function discriminatorLabel(disc: FormField['fhirDiscriminator']): string | null {
  if (!disc) return null;
  const keys = Object.keys(disc).sort();
  if (keys.length === 0) return null;
  return keys.map((key) => `${key} = ${disc[key]}`).join(', ');
}
