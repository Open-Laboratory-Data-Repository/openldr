import { describe, it, expect } from 'vitest';
import { issuerForSite } from './enrollment';

// REGRESSION: enrolment returned `ctx.cfg.OIDC_ISSUER_URL` verbatim — central's OWN public
// address. A central installed as 127.0.0.1 therefore handed every new site
// `https://127.0.0.1:8443/auth/realms/openldr`, which is right from a browser and wrong from
// inside the lab's api container (127.0.0.1 there is the container itself). Sync died on the
// token fetch with a bare `fetch failed`, which reads like a bad client secret and is not.
describe('issuerForSite', () => {
  const ISSUER = 'https://127.0.0.1:8443/auth/realms/openldr';

  it('rehosts the issuer onto the central URL the operator entered (the original failure)', () => {
    expect(issuerForSite(ISSUER, 'https://host.docker.internal:8443')).toBe(
      'https://host.docker.internal:8443/auth/realms/openldr',
    );
  });

  it('keeps the realm path, including a non-default realm name', () => {
    expect(issuerForSite('https://127.0.0.1:8443/auth/realms/national', 'https://central.example.org')).toBe(
      'https://central.example.org/auth/realms/national',
    );
  });

  it('carries the port from the central URL, not from the configured issuer', () => {
    expect(issuerForSite(ISSUER, 'https://central.example.org:9443')).toBe(
      'https://central.example.org:9443/auth/realms/openldr',
    );
  });

  it('is a no-op when central is already reachable at its own address', () => {
    expect(issuerForSite(ISSUER, 'https://127.0.0.1:8443')).toBe(ISSUER);
  });

  it('tolerates a trailing slash on the central URL', () => {
    expect(issuerForSite(ISSUER, 'https://host.docker.internal:8443/')).toBe(
      'https://host.docker.internal:8443/auth/realms/openldr',
    );
  });

  it('falls back to the configured issuer rather than throwing on an unparseable URL', () => {
    // Enrolment has already created the Keycloak client by this point; a bad URL must not blow up
    // the whole operation and leave an orphaned client behind.
    expect(issuerForSite(ISSUER, 'not a url')).toBe(ISSUER);
    expect(issuerForSite('also not a url', 'https://central.example.org')).toBe('also not a url');
  });
});
