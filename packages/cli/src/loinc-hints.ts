import { loadConfig } from '@openldr/config';
import { createAppContext, recordAuditEvent } from '@openldr/bootstrap';
import { cliActor } from './cli-actor';
import { redactError } from './redact-error';

// `openldr test-catalog loinc-hints <code>` and `openldr test-catalog result-fields from-loinc <code...>`:
// the CLI doors to GET /api/test-catalog/loinc-hints/:code and POST /api/test-catalog/result-fields/from-loinc
// (test catalog hints spec, call 7). Both call ctx.loincHints, as the routes do.

const NOT_LOADED = 'LOINC and its ontology are not loaded here, so there are no hints. Import LOINC with openldr terminology import loinc.';

function fail(command: string, err: unknown, json: boolean): number {
  const msg = redactError(err);
  if (json) process.stdout.write(JSON.stringify({ error: msg }) + '\n');
  else process.stderr.write(`test-catalog ${command} failed: ${msg}\n`);
  return 1;
}

export async function runLoincHints(code: string, opts: { json: boolean }): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    const hints = await ctx.loincHints.hints(code);
    if (opts.json) { process.stdout.write(JSON.stringify(hints, null, 2) + '\n'); return 0; }
    if (!hints) { process.stdout.write(NOT_LOADED + '\n'); return 0; }
    const lines = [
      `${hints.code}  ${hints.display ?? ''}`,
      `class: ${hints.class ?? 'none'}${hints.categorySuggestion ? ` (category ${hints.categorySuggestion.code})` : ' (no matching category)'}`,
      `result: ${hints.resultType}${hints.unit ? `, unit ${hints.unit}` : ''}`,
    ];
    for (const s of hints.specimens) {
      const match = s.specimenType ? `specimen type ${s.specimenType.code}${s.tick ? ', ticked' : ''}` : 'no specimen type matches';
      lines.push(`specimen: SNOMED ${s.snomed}${s.display ? ` ${s.display}` : ''} (${s.equivalence}), ${match}`);
    }
    for (const a of hints.answers) lines.push(`answer: ${a.code}  ${a.display}`);
    for (const m of hints.panelMembers) lines.push(`member: ${m.code}  ${m.display}${m.required ? ' (required)' : ''}`);
    process.stdout.write(lines.join('\n') + '\n');
    return 0;
  } catch (err) { return fail('loinc-hints', err, opts.json); } finally { await ctx.close(); }
}

export async function runResultFieldsFromLoinc(codes: string[], opts: { panel: boolean; json: boolean }): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    const answer = await ctx.loincHints.resultFieldsFromLoinc(codes, { panel: opts.panel });
    await recordAuditEvent(ctx, cliActor(), {
      action: 'result_field.from_loinc', entityType: 'result_field', entityId: codes.join(','),
      before: null, after: { created: answer.created, valueSetsCreated: answer.valueSetsCreated },
      metadata: { codes, panel: opts.panel, reused: answer.reused },
    });
    if (opts.json) { process.stdout.write(JSON.stringify(answer, null, 2) + '\n'); return 0; }
    const made = new Set(answer.created);
    const lines = answer.params.map((p) => `${p.code}  ${p.resultType}${p.valueSetUrl ? `  ${p.valueSetUrl}` : ''}  ${made.has(p.code) ? 'made' : 'already there'}`);
    lines.push(`made ${answer.created.length} field(s) and ${answer.valueSetsCreated.length} answer set(s), used ${answer.reused.length} already there`);
    process.stdout.write(lines.join('\n') + '\n');
    return 0;
  } catch (err) { return fail('result-fields from-loinc', err, opts.json); } finally { await ctx.close(); }
}
