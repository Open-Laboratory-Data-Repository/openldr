import { describe, expect, it } from 'vitest';
import { formCreateFromImport } from './form-import';

describe('formCreateFromImport', () => {
  it('returns null for a file with no name', () => {
    expect(formCreateFromImport({ fields: [], sections: [] })).toBeNull();
  });

  it("wraps the file as schema and defaults targetPages to ['forms']", () => {
    const file = { name: 'Intake', fields: [], sections: [] };
    expect(formCreateFromImport(file)).toEqual({
      name: 'Intake',
      versionLabel: null,
      fhirResourceType: null,
      targetPages: ['forms'],
      schema: file,
    });
  });
});
