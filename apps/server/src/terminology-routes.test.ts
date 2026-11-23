import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import type { AppContext } from '@openldr/bootstrap';
import { registerTerminologyRoutes } from './terminology-routes';

// The studio asks this route whether a range's unit is a UCUM code, so its wire shape is pinned here.
function appWith(codes: Array<[string, string, string]>) {
  const app = Fastify();
  const lookup = async (system: string, code: string) => {
    const hit = codes.find(([s, c]) => s === system && c === code);
    return hit
      ? { found: true, system, code, display: hit[2], properties: null }
      : { found: false, system, code, display: null, properties: null };
  };
  registerTerminologyRoutes(app, { terminology: { ops: { lookup } } } as unknown as AppContext);
  return app;
}

const UCUM = 'http://unitsofmeasure.org';

describe('GET /api/terminology/CodeSystem/$lookup', () => {
  it('answers a code the system holds by its exact code', async () => {
    const res = await appWith([[UCUM, 'g', 'gram']]).inject({
      method: 'GET', url: `/api/terminology/CodeSystem/$lookup?system=${encodeURIComponent(UCUM)}&code=g`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ resourceType: 'Parameters', parameter: [
      { name: 'display', valueString: 'gram' }, { name: 'system', valueUri: UCUM }, { name: 'code', valueCode: 'g' },
    ] });
  });

  it('answers 404 for a code the system does not hold', async () => {
    const res = await appWith([[UCUM, 'g', 'gram']]).inject({
      method: 'GET', url: `/api/terminology/CodeSystem/$lookup?system=${encodeURIComponent(UCUM)}&code=cells`,
    });
    expect(res.statusCode).toBe(404);
  });

  it('answers 400 without a code', async () => {
    const res = await appWith([]).inject({ method: 'GET', url: `/api/terminology/CodeSystem/$lookup?system=${encodeURIComponent(UCUM)}` });
    expect(res.statusCode).toBe(400);
  });
});
