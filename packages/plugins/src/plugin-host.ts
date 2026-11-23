import type { Capability } from '@openldr/marketplace';
import type { PluginCaller, TableShape } from '@openldr/db';
import type { HostFn } from './runner';

/** What CE knows about a plugin when it builds its host functions. Every field comes from the
 *  stored, signed manifest row, never from the plugin's input. */
export interface HostPlugin {
  id: string;
  version: string;
  capabilities: Capability[];
  tables: TableShape[];
}

/** Builds the CE host functions for one call: one plugin, one caller. The caller comes from CE's
 *  session (the broker), never from the plugin. Implemented in @openldr/bootstrap (plugin-host.ts). */
export interface PluginHost {
  forCall(plugin: HostPlugin, caller: PluginCaller): Record<string, HostFn>;
}

/** The capabilities that give a plugin CE host functions. */
export const HOST_FN_CAPABILITY_KINDS = ['host:db', 'host:ce-read', 'emit-fhir'] as const;

/** Whether a plugin's grant gives it any CE host function. */
export function hasHostFnCapability(capabilities: readonly Capability[] | undefined): boolean {
  return (capabilities ?? []).some((c) => (HOST_FN_CAPABILITY_KINDS as readonly string[]).includes(c.kind));
}
