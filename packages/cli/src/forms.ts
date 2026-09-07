import { readFileSync } from 'node:fs';
import { createAppContext, recordAuditEvent } from '@openldr/bootstrap';
import { loadConfig } from '@openldr/config';
import { ObservationExtractor, ServiceRequestExtractor, toTransactionBundle, lintFormSchema, type ExtractionContext } from '@openldr/forms';
import type { Questionnaire, QuestionnaireResponse } from '@openldr/fhir';
import { cliActor } from './cli-actor';

export interface FormsExtractOutput {
  resourceTypes: string[];
  invalidCount: number;
  bundle: unknown;
}

export function runFormsExtract(questionnairePath: string, responsePath: string, ctx: ExtractionContext = {}): FormsExtractOutput {
  const questionnaire = JSON.parse(readFileSync(questionnairePath, 'utf8')) as Questionnaire;
  const response = JSON.parse(readFileSync(responsePath, 'utf8')) as QuestionnaireResponse;
  // The ported extractors are typed against `fhir/r4`; our CLI reads `@openldr/fhir`
  // resources, which are structurally compatible JSON — bridge the type boundary.
  const q = questionnaire as never;
  const qr = response as never;
  const resources = [...ObservationExtractor.extract(qr, q, ctx), ...ServiceRequestExtractor.extract(qr, q, ctx)];
  return {
    resourceTypes: resources.map((r) => r.resourceType),
    invalidCount: 0,
    bundle: toTransactionBundle(qr, resources),
  };
}

export async function runFormsList(opts: { json: boolean }): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    const forms = await ctx.forms.list();
    if (opts.json) {
      process.stdout.write(JSON.stringify(forms, null, 2) + '\n');
    } else {
      const lines = forms.map(
        (form) =>
          `${form.id}\t${form.name}\t${form.status}\t${form.active ? 'active' : 'inactive'}\t${form.fhirResourceType ?? ''}\t${form.fieldCount}\t${form.versionLabel ?? ''}`,
      );
      process.stdout.write((lines.length ? lines.join('\n') : '(no forms)') + '\n');
    }
    return 0;
  } finally {
    await ctx.close();
  }
}

/**
 * Lint one form, or every form when no id is given.
 *
 * Exit code mirrors the builder's publish gate: errors block, warnings do not
 * (`canPublish={!hasErrors}` in apps/studio/src/forms-builder/FormBuilderPage.tsx). A lab running
 * headless has no other way to see these findings.
 */
export async function runFormsLint(id: string | undefined, opts: { json: boolean }): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    const targets = id
      ? [await ctx.forms.get(id)].filter((f): f is NonNullable<typeof f> => f !== null)
      : await Promise.all((await ctx.forms.list()).map((s) => ctx.forms.get(s.id)))
          .then((forms) => forms.filter((f): f is NonNullable<typeof f> => f !== null));

    if (id && targets.length === 0) {
      process.stderr.write(`no form with id ${id}\n`);
      return 1;
    }

    const results = targets.map((form) => ({
      id: form.id,
      name: form.name,
      issues: lintFormSchema(form.schema),
    }));

    if (opts.json) {
      process.stdout.write(JSON.stringify(results, null, 2) + '\n');
    } else {
      const lines: string[] = [];
      for (const result of results) {
        for (const issue of result.issues) {
          lines.push(`${result.name}\t${issue.severity}\t${issue.code}\t${issue.fieldId ?? issue.sectionId ?? ''}\t${issue.message}`);
        }
      }
      process.stdout.write((lines.length ? lines.join('\n') : '(no findings)') + '\n');
    }

    return results.some((r) => r.issues.some((i) => i.severity === 'error')) ? 1 : 0;
  } finally {
    await ctx.close();
  }
}

export async function runFormsVersions(id: string, opts: { json: boolean }): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    const versions = await ctx.forms.listVersions(id);
    if (opts.json) {
      process.stdout.write(JSON.stringify(versions, null, 2) + '\n');
    } else {
      const lines = versions.map((v) => `${v.version}\t${v.versionLabel ?? ''}\t${v.publishedAt}`);
      process.stdout.write((lines.length ? lines.join('\n') : '(no published versions)') + '\n');
    }
    return 0;
  } finally {
    await ctx.close();
  }
}

/**
 * Put a published version back over the current draft.
 *
 * Destructive: it overwrites the stored draft and drops a published form back to draft, so it
 * refuses without --force, the same discipline every other destructive command here follows.
 */
export async function runFormsRestore(
  id: string,
  version: string,
  opts: { json: boolean; force: boolean },
): Promise<number> {
  if (!/^[1-9]\d*$/.test(version) || !Number.isSafeInteger(Number(version)) || Number(version) > 2147483647) {
    process.stderr.write('version must be a positive integer\n');
    return 1;
  }
  if (!opts.force) {
    process.stderr.write(
      `refusing to overwrite the draft of ${id} with version ${version}; re-run with --force\n`,
    );
    return 1;
  }
  const parsed = Number(version);
  const ctx = await createAppContext(loadConfig());
  try {
    const before = await ctx.forms.get(id);
    if (!before) {
      process.stderr.write(`no form with id ${id}\n`);
      return 1;
    }
    const restored = await ctx.forms.restore(id, parsed);
    await recordAuditEvent(ctx, cliActor(), {
      action: 'form.restore', entityType: 'form', entityId: id,
      before, after: restored, metadata: { sourceVersion: parsed },
    });
    if (opts.json) {
      process.stdout.write(JSON.stringify(restored, null, 2) + '\n');
    } else {
      process.stdout.write(`restored ${id} to version ${parsed} (now ${restored.status})\n`);
    }
    return 0;
  } finally {
    await ctx.close();
  }
}
