import { isMultiValued, resolveReferenceSource } from '@openldr/forms/pure';
import type { FormSchema, RuntimeAnswers } from './types';

/**
 * Build a synthetic set of answers for a form schema — one plausible value per
 * enabled field. Used by the builder's live Preview panel to populate the form
 * without requiring the user to type anything.
 */
export function makeExampleAnswers(schema: FormSchema): RuntimeAnswers {
  const answers: RuntimeAnswers = {};

  for (const field of schema.fields) {
    // Skip disabled fields
    if (field.enabled === false) continue;

    switch (field.fieldType) {
      case 'text':
      case 'phone':
      case 'email':
      case 'identifier':
      case 'address':
        answers[field.id] = 'Example';
        break;

      case 'number':
        answers[field.id] = 1;
        break;

      case 'boolean':
        answers[field.id] = true;
        break;

      case 'date':
        answers[field.id] = '2026-01-01';
        break;

      case 'datetime':
        answers[field.id] = '2026-01-01T00:00';
        break;

      case 'select': {
        const code = field.valueSetOptions?.[0]?.code;
        if (code !== undefined) answers[field.id] = code;
        break;
      }

      case 'multiselect': {
        const code = field.valueSetOptions?.[0]?.code;
        answers[field.id] = code !== undefined ? [code] : [];
        break;
      }

      // Reference-family fields render a picker whose value is an object, not a string. The
      // literal 'example' string this used to emit crashed the picker outright once the control
      // was swapped in (`'reference' in 'example'` is a TypeError), so shape the example to
      // whatever source the field declares.
      case 'reference':
      case 'facility':
      case 'organism':
      case 'antibiogram': {
        const resolved = resolveReferenceSource(field);
        if (!resolved.ok) {
          // No declared source: facility/organism/antibiogram degrade to a plain text input, so
          // a bare string is the correct example for them. A sourceless `reference` has no
          // usable control at all, so it gets no example.
          if (field.fieldType !== 'reference') answers[field.id] = 'Example';
          break;
        }
        const one = resolved.source.kind === 'entity'
          ? { reference: `${resolved.source.target}/example`, display: 'Example' }
          : {
              system: resolved.source.mode === 'valueset' ? resolved.source.url : resolved.source.system,
              code: 'example',
              display: 'Example',
            };
        answers[field.id] = isMultiValued(field) ? [one] : one;
        break;
      }

      // group and attachment — omit
      case 'group':
      case 'attachment':
      default:
        break;
    }
  }

  return answers;
}
