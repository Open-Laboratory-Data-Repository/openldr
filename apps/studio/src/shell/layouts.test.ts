import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LayoutList, LayoutPreset } from '@/api';
import * as api from '@/api';
import { layoutInForce, loadLayouts, getLayoutsState, resetLayoutsForTest } from './layouts';

vi.mock('@/api', async (orig) => ({ ...(await orig<typeof import('@/api')>()), listLayouts: vi.fn() }));

const L = (id: string, roles: string[] = []): LayoutPreset => ({ id, name: id, startPage: null, pages: ['/forms'], roles });
const base: LayoutList = { layouts: [L('bench', ['tech']), L('data', ['analyst'])], roleOrder: ['analyst', 'tech'] };
// myRoles: the user's roles from the server (user_roles), not the sign-in token.
const as = (myRoles: string[]): LayoutList => ({ ...base, myRoles });
const list = as(['tech']);

describe('layoutInForce', () => {
  it("uses the user's own pick first", () => {
    expect(layoutInForce({ layout: 'data' }, as(['tech']))?.id).toBe('data');
  });
  it("full means the full sidebar, even when the role has a default", () => {
    expect(layoutInForce({ layout: 'full' }, as(['tech']))).toBeNull();
  });
  it('with no pick, uses the default of the first role that has one, in Roles page order', () => {
    expect(layoutInForce({}, as(['tech']))?.id).toBe('bench');
    // analyst comes before tech in roleOrder, whatever order the user's roles are in.
    expect(layoutInForce({}, as(['tech', 'analyst']))?.id).toBe('data');
  });
  it('a picked layout that was deleted falls back to the role default', () => {
    expect(layoutInForce({ layout: 'gone' }, as(['tech']))?.id).toBe('bench');
  });
  it('no pick and no role default means the full sidebar', () => {
    expect(layoutInForce({}, as(['lab_admin']))).toBeNull();
    expect(layoutInForce({}, base)).toBeNull(); // an older server sends no myRoles
    expect(layoutInForce({}, { layouts: [], roleOrder: [], myRoles: ['tech'] })).toBeNull();
  });
});

describe('layouts store', () => {
  beforeEach(() => resetLayoutsForTest());
  it('loads the list, and a failed load leaves an empty list, never throwing', async () => {
    vi.mocked(api.listLayouts).mockResolvedValue(list);
    await loadLayouts();
    expect(getLayoutsState()).toEqual({ loaded: true, list });
    vi.mocked(api.listLayouts).mockRejectedValue(new Error('500'));
    await loadLayouts();
    expect(getLayoutsState()).toEqual({ loaded: true, list: { layouts: [], roleOrder: [] } });
  });
});
