import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyEnvironment } from './commands.js';

describe('applyEnvironment and the trust file', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('drops a TRUSTED_CA_FILE the shell had when the launcher gives none', () => {
    // The person set NODE_EXTRA_CA_CERTS to a file of their own, and by chance or by copying a
    // server's settings also has TRUSTED_CA_FILE naming it. That file is theirs: it must not
    // become editable from Settings > Network.
    vi.stubEnv('TRUSTED_CA_FILE', '/etc/ssl/ours.pem');
    vi.stubEnv('NODE_EXTRA_CA_CERTS', '/etc/ssl/ours.pem');
    applyEnvironment({ PORT: '3000' });
    expect(process.env.TRUSTED_CA_FILE).toBeUndefined();
    expect(process.env.NODE_EXTRA_CA_CERTS).toBe('/etc/ssl/ours.pem');
  });

  it('sets the TRUSTED_CA_FILE the launcher gives, over one the shell had', () => {
    vi.stubEnv('TRUSTED_CA_FILE', '/etc/ssl/ours.pem');
    applyEnvironment({ TRUSTED_CA_FILE: '/data/trust/ca.pem' });
    expect(process.env.TRUSTED_CA_FILE).toBe('/data/trust/ca.pem');
  });
});
