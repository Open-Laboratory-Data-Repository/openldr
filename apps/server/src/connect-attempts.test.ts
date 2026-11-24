import net from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { CONNECT_ATTEMPT_TIMEOUT_MS, widenConnectAttempts } from './connect-attempts';

describe('widenConnectAttempts', () => {
  const before = net.getDefaultAutoSelectFamilyAttemptTimeout();
  afterEach(() => net.setDefaultAutoSelectFamilyAttemptTimeout(before));

  it('gives each address of an outbound connection 2 seconds, not the Node default of 250 ms', () => {
    net.setDefaultAutoSelectFamilyAttemptTimeout(250);
    widenConnectAttempts();
    expect(CONNECT_ATTEMPT_TIMEOUT_MS).toBe(2000);
    expect(net.getDefaultAutoSelectFamilyAttemptTimeout()).toBe(2000);
  });

  it('never shortens a longer value set before it', () => {
    net.setDefaultAutoSelectFamilyAttemptTimeout(5000);
    widenConnectAttempts();
    expect(net.getDefaultAutoSelectFamilyAttemptTimeout()).toBe(5000);
  });
});
