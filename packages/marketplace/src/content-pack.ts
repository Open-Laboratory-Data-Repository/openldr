import { z } from 'zod';

export const CONTENT_PACK_FORMAT_VERSION = 1;
export class ContentPackError extends Error {}
const NEWER = 'this pack needs a newer CE';
const KINDS = ['code-system', 'value-set', 'facility-register', 'link-matching', 'custom-queries', 'test-mappings', 'result-mappings', 'datasets'] as const;

/** A dataset's name: it becomes a table name in the warehouse's `dataset` schema. */
export const DATASET_NAME = /^[a-z][a-z0-9_]{2,47}$/;

const fhir = (resourceType: 'CodeSystem' | 'ValueSet') =>
  z.object({ resourceType: z.literal(resourceType), url: z.string().min(1) }).passthrough();

const stepSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('code-system'), resource: fhir('CodeSystem') }),
  z.object({ kind: z.literal('value-set'), resource: fhir('ValueSet') }),
  // `extraColumns`: CSV headers the register import keeps in each row's `extras`. Any other unknown
  // header is still refused. A CE without this field strips it and refuses those headers too.
  z.object({
    kind: z.literal('facility-register'), url: z.string().min(1), name: z.string().min(1), code: z.string().min(1), csv: z.string().min(1),
    extraColumns: z.array(z.string().min(1)).optional(),
  }),
  z.object({ kind: z.literal('link-matching'), registerUrl: z.string().min(1) }),
  z.object({ kind: z.literal('custom-queries'), file: z.object({ queries: z.array(z.object({ name: z.string() }).passthrough()) }).passthrough() }),
  // Lab test codes mapped to catalog tests by LOINC (test mapping spec 4.7). A CE without this kind
  // refuses the pack as needing a newer CE.
  z.object({
    kind: z.literal('test-mappings'),
    mappings: z.array(z.object({
      system: z.string().min(1), code: z.string().min(1), loinc: z.string().regex(/^\d{1,7}-\d$/),
    })).min(1),
  }),
  // Lab result codes mapped to result fields by LOINC (result field mapping spec 4.7). A kind of its
  // own, not a level key on test-mappings: z.object drops unknown keys, so a CE from before this step
  // would read a level key as nothing and write result codes as test mappings. As a new kind, that CE
  // refuses the pack as needing a newer CE.
  z.object({
    kind: z.literal('result-mappings'),
    mappings: z.array(z.object({
      system: z.string().min(1), code: z.string().min(1), loinc: z.string().regex(/^\d{1,7}-\d$/),
    })).min(1),
  }),
  // Datasets: each a name and one SELECT. CE stores the SELECT's result as a table in the warehouse and
  // rebuilds it after the warehouse changes, so a report reads a table made once and does not redo a
  // heavy step on every run. A CE without this kind refuses the pack as needing a newer CE.
  z.object({
    kind: z.literal('datasets'),
    tables: z.array(z.object({
      name: z.string().regex(DATASET_NAME),
      sql: z.string().min(1),
      // Each entry is the columns of one plain index.
      indexes: z.array(z.array(z.string().min(1)).min(1)).optional(),
    })).min(1).superRefine((tables, ctx) => {
      const seen = new Set<string>();
      tables.forEach((t, i) => {
        if (seen.has(t.name)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [i, 'name'], message: `the dataset ${t.name} is listed twice` });
        seen.add(t.name);
      });
    }),
  }),
]);

export const contentPackSchema = z.object({ formatVersion: z.literal(CONTENT_PACK_FORMAT_VERSION), steps: z.array(stepSchema).min(1) });
export type ContentPack = z.infer<typeof contentPackSchema>;
export type ContentPackStep = ContentPack['steps'][number];

export function parseContentPack(raw: unknown): ContentPack {
  const head = raw as { formatVersion?: unknown; steps?: unknown } | null;
  if (!head || head.formatVersion !== CONTENT_PACK_FORMAT_VERSION) throw new ContentPackError(NEWER);
  if (Array.isArray(head.steps) && head.steps.some((s) => !KINDS.includes((s as { kind?: never })?.kind as never))) {
    throw new ContentPackError(NEWER);
  }
  const parsed = contentPackSchema.safeParse(raw);
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    throw new ContentPackError(`invalid pack: ${i.path.join('.') || 'pack'}: ${i.message}`);
  }
  return parsed.data;
}

export function summarizeContentPack(pack: ContentPack): { kind: string; label: string; count: number }[] {
  return pack.steps.map((s) => {
    switch (s.kind) {
      case 'code-system':
      case 'value-set': {
        const r = s.resource as { name?: string; url: string };
        return { kind: s.kind, label: r.name ?? r.url, count: 1 };
      }
      case 'facility-register':
        return { kind: s.kind, label: s.name, count: s.csv.split(/\r?\n/).slice(1).filter((l) => l.trim() !== '').length };
      case 'link-matching':
        return { kind: s.kind, label: s.registerUrl, count: 1 };
      case 'custom-queries':
        return { kind: s.kind, label: s.file.queries.map((q) => q.name).join(', '), count: s.file.queries.length };
      case 'test-mappings':
        return { kind: s.kind, label: 'Test mappings', count: s.mappings.length };
      case 'result-mappings':
        return { kind: s.kind, label: 'Result mappings', count: s.mappings.length };
      case 'datasets':
        return { kind: s.kind, label: s.tables.map((t) => t.name).join(', '), count: s.tables.length };
    }
  });
}
