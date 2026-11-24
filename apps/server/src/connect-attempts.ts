import net from 'node:net';

/**
 * How long one address of an outbound connection gets before Node tries the next one.
 *
 * Node tries each resolved address (IPv6 and IPv4 in turn) for 250 ms by default. Where IPv6 is
 * unreachable and the IPv4 connect takes longer than that, every attempt is cut short and the
 * fetch fails with ETIMEDOUT after about a second. Seen on 2026-11-24 on the Linux box: GitHub
 * took about 400 ms to connect over IPv4, so 3 of 5 registry fetches failed with "fetch failed".
 * At 2000 ms all 5 passed. Labs on slow links meet the same limit on every outbound call
 * (registries, DHIS2, connectors, sync to central).
 */
export const CONNECT_ATTEMPT_TIMEOUT_MS = 2000;

/** Raises Node's per-address connect time for the whole process. A longer value already set stays. */
export function widenConnectAttempts(): void {
  if (net.getDefaultAutoSelectFamilyAttemptTimeout() < CONNECT_ATTEMPT_TIMEOUT_MS) {
    net.setDefaultAutoSelectFamilyAttemptTimeout(CONNECT_ATTEMPT_TIMEOUT_MS);
  }
}
