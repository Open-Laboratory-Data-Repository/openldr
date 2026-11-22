/** The create body studio sends when a form file is imported. */
export interface FormCreateInput {
  name: string;
  versionLabel: string | null;
  fhirResourceType: string | null;
  targetPages: string[];
  schema: unknown;
}

function isImportableSchema(value: unknown): value is { name: string; fhirResourceType?: string | null; versionLabel?: string | null; targetPages?: string[] | null } {
  if (!value || typeof value !== 'object') return false;
  const schema = value as { name?: unknown };
  return typeof schema.name === 'string';
}

/**
 * Reshape a parsed form file into the create body, or null when the file has no name. The whole
 * file becomes the schema. A file without a `targetPages` list targets the Forms page.
 */
export function formCreateFromImport(raw: unknown): FormCreateInput | null {
  if (!isImportableSchema(raw)) return null;
  return {
    name: raw.name,
    versionLabel: raw.versionLabel ?? null,
    fhirResourceType: raw.fhirResourceType ?? null,
    targetPages: Array.isArray(raw.targetPages) ? raw.targetPages : ['forms'],
    schema: raw,
  };
}
