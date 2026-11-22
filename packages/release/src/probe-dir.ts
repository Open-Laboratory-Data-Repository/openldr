import { join } from 'node:path';

/** Where the release's check install gets its folder: `<home>/.cache/openldr-release`.
 *
 *  Not the system temp folder. Docker Desktop shares the home directory with its VM by default
 *  and does not share /tmp, so a compose file mounting a config from /tmp fails with "mounts
 *  denied: not shared from the host". Measured 2026-11-22 on the 0.1.12 release: the install
 *  failed from /tmp and passed from ~/.cache. Docker Engine with no VM is fine with either. */
export function releaseProbeParent(home: string): string {
  return join(home, '.cache', 'openldr-release');
}
