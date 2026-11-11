import type { OpenLdrPluginApi } from '@openldr/plugin-ui-sdk';

/** The host injects `window.openldr` before this page runs. Read it at call time, not at
 *  module load, so import order does not matter. Types only: no SDK code is bundled. */
export function getOpenldr(): OpenLdrPluginApi {
  const api = (window as unknown as { openldr?: OpenLdrPluginApi }).openldr;
  if (!api) throw new Error('window.openldr is not available: the host did not inject the plugin SDK');
  return api;
}
