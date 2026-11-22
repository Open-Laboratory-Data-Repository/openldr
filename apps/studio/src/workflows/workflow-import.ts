/** The create body studio sends when a workflow file is imported. */
export interface WorkflowCreateInput {
  id: string;
  name: string;
  description: string | null;
  definition: { nodes: unknown[]; edges: unknown[] };
  enabled: boolean;
  createdBy: null;
}

function isImportable(value: unknown): value is { name: string; description?: string | null; enabled?: boolean; definition: { nodes: unknown[]; edges: unknown[] } } {
  if (!value || typeof value !== 'object') return false;
  const v = value as { name?: unknown; definition?: unknown };
  if (typeof v.name !== 'string') return false;
  const def = v.definition as { nodes?: unknown; edges?: unknown } | undefined;
  return !!def && Array.isArray(def.nodes) && Array.isArray(def.edges);
}

/**
 * Reshape a parsed workflow file into the create body, or null when the file has no name or no
 * definition with nodes and edges arrays. A file that omits `enabled` imports enabled.
 */
export function workflowCreateFromImport(raw: unknown, id: string): WorkflowCreateInput | null {
  if (!isImportable(raw)) return null;
  return {
    id,
    name: raw.name,
    description: raw.description ?? null,
    definition: raw.definition,
    enabled: raw.enabled ?? true,
    createdBy: null,
  };
}
