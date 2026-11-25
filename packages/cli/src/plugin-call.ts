import { createAppContext, type BrokerPrincipal, type PluginBroker } from '@openldr/bootstrap';
import { loadConfig } from '@openldr/config';
import { EVERYTHING } from '@openldr/rbac';
import { cliActor } from './cli-actor';
import { servedCaller } from './served-caller';

/** What one call gives: the exit code, the plugin's answer (when there is one), and a line for a person. */
export interface PluginCallResult {
  exitCode: 0 | 1;
  answer: unknown;
  message: string;
}

/**
 * Runs one plugin action through CE's plugin broker, as the plugin's page calls it: the broker
 * checks the action's own permission and the caller's data limit, and audits the call. `inputText`
 * is the action's JSON input; none sends `{}`. An answer of `{ error }` from the plugin exits 1.
 */
export async function callPlugin(
  deps: { broker: Pick<PluginBroker, 'handle'>; principal: BrokerPrincipal },
  plugin: string,
  action: string,
  inputText: string | undefined,
): Promise<PluginCallResult> {
  let input: unknown = {};
  if (inputText !== undefined) {
    try {
      input = JSON.parse(inputText);
    } catch {
      return { exitCode: 1, answer: null, message: '--input is not JSON; nothing was sent' };
    }
  }
  const r = await deps.broker.handle(plugin, deps.principal, { kind: 'invoke', entrypoint: action, input });
  if (!r.ok) return { exitCode: 1, answer: null, message: `${plugin} ${action} refused: ${r.error}` };
  const error = (r.data as { error?: { code?: unknown; message?: unknown } } | null)?.error;
  if (error) {
    return { exitCode: 1, answer: r.data, message: `${plugin} ${action} answered ${String(error.code ?? 'error')}: ${String(error.message ?? '')}` };
  }
  return { exitCode: 0, answer: r.data, message: JSON.stringify(r.data, null, 2) };
}

/**
 * `openldr plugin call <plugin> <action> [--input <json>] [--json]`. A local run is the machine's
 * operator: every capability in the catalog (CE's and installed plugins' keys) and no data limit.
 * A served run is the signed-in caller, with their own capabilities and data limit.
 */
export async function runPluginCall(plugin: string, action: string, opts: { input?: string; json: boolean }): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    const actor = cliActor();
    const served = await servedCaller(ctx);
    if (served === null) {
      process.stderr.write('the signed-in account was not found\n');
      return 1;
    }
    const principal: BrokerPrincipal = served === 'local'
      ? { id: 'cli', username: actor.actorName ?? 'cli', displayName: actor.actorName ?? 'cli', roles: ['lab_admin'], capabilities: [...(await ctx.capabilityCatalog.keys())], dataScope: EVERYTHING }
      : { id: served.id, username: actor.actorName ?? served.id, displayName: actor.actorName ?? null, roles: served.roleIds, capabilities: served.capabilities, dataScope: served.dataScope };
    const out = await callPlugin({ broker: ctx.pluginBroker, principal }, plugin, action, opts.input);
    if (opts.json) process.stdout.write(`${JSON.stringify(out.exitCode === 0 ? out.answer : { error: out.message, answer: out.answer })}\n`);
    else (out.exitCode === 0 ? process.stdout : process.stderr).write(`${out.message}\n`);
    return out.exitCode;
  } finally {
    await ctx.close();
  }
}
