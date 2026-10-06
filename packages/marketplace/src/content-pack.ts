import { z } from 'zod';

export const CONTENT_PACK_FORMAT_VERSION = 1;
export class ContentPackError extends Error {}
const NEWER = 'this pack needs a newer CE';
const KINDS = ['code-system', 'value-set', 'facility-register', 'link-matching', 'custom-queries'] as const;

const fhir = (resourceType: 'CodeSystem' | 'ValueSet') =>
  z.object({ resourceType: z.literal(resourceType), url: z.string().min(1) }).passthrough();

const stepSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('code-system'), resource: fhir('CodeSystem') }),
  z.object({ kind: z.literal('value-set'), resource: fhir('ValueSet') }),
  z.object({ kind: z.literal('facility-register'), url: z.string().min(1), name: z.string().min(1), code: z.string().min(1), csv: z.string().min(1) }),
  z.object({ kind: z.literal('link-matching'), registerUrl: z.string().min(1) }),
  z.object({ kind: z.literal('custom-queries'), file: z.object({ queries: z.array(z.object({ name: z.string() }).passthrough()) }).passthrough() }),
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
    }
  });
}
