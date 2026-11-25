import { describe, it, expect, vi } from 'vitest';
import type { BrokerPrincipal } from '@openldr/bootstrap';
import { EVERYTHING } from '@openldr/rbac';
import { callPlugin } from './plugin-call';

const principal: BrokerPrincipal = { id: 'cli', username: 'ops', roles: ['lab_admin'], capabilities: ['lab.settings'], dataScope: EVERYTHING };

function broker(result: unknown) {
  return { handle: vi.fn(async () => result) };
}

describe('openldr plugin call', () => {
  it('sends one invoke op with the parsed input and gives the answer', async () => {
    const b = broker({ ok: true, data: { items: [1] } });
    const out = await callPlugin({ broker: b as never, principal }, 'lab', 'lab_list_items', '{"a":1}');
    expect(b.handle).toHaveBeenCalledWith('lab', principal, { kind: 'invoke', entrypoint: 'lab_list_items', input: { a: 1 } });
    expect(out).toMatchObject({ exitCode: 0, answer: { items: [1] } });
  });

  it('no --input sends an empty object', async () => {
    const b = broker({ ok: true, data: {} });
    await callPlugin({ broker: b as never, principal }, 'lab', 'lab_settings_get', undefined);
    expect(b.handle).toHaveBeenCalledWith('lab', principal, { kind: 'invoke', entrypoint: 'lab_settings_get', input: {} });
  });

  it('input that is not JSON exits 1 and calls nothing', async () => {
    const b = broker({ ok: true, data: {} });
    const out = await callPlugin({ broker: b as never, principal }, 'lab', 'lab_list_items', '{not json');
    expect(out.exitCode).toBe(1);
    expect(out.message).toContain('--input is not JSON');
    expect(b.handle).not.toHaveBeenCalled();
  });

  it('a broker refusal exits 1 and gives its text', async () => {
    const refusal = 'the action lab_list_item_save of plugin lab needs one of these permissions: Lab settings';
    const out = await callPlugin({ broker: broker({ ok: false, error: refusal }) as never, principal }, 'lab', 'lab_list_item_save', '{}');
    expect(out.exitCode).toBe(1);
    expect(out.message).toContain(refusal);
  });

  it('a plugin error answer exits 1 and gives its message', async () => {
    const out = await callPlugin({ broker: broker({ ok: true, data: { error: { code: 'refused', message: 'x' } } }) as never, principal }, 'lab', 'lab_list_item_save', '{}');
    expect(out.exitCode).toBe(1);
    expect(out.message).toContain('refused: x');
    expect(out.answer).toEqual({ error: { code: 'refused', message: 'x' } });
  });
});
