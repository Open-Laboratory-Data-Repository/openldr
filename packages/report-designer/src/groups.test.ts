import { describe, it, expect } from 'vitest';
import { resolveGroups, groupMembers } from './groups';
import type { DesignPage } from './schema';

const page = (over: Partial<DesignPage> = {}): DesignPage => ({
  id: 'p1',
  groups: [{ id: 'g1', name: 'Letterhead' }],
  elements: [
    { id: 'a', kind: 'text', name: 'a', rect: { x: 0, y: 0, w: 10, h: 10 }, groupId: 'g1' },
    { id: 'b', kind: 'text', name: 'b', rect: { x: 0, y: 20, w: 10, h: 10 }, groupId: 'g1' },
    { id: 'c', kind: 'text', name: 'c', rect: { x: 0, y: 40, w: 10, h: 10 } },
  ],
  ...over,
});

describe('resolveGroups', () => {
  it('is a no-op for a page with no groups, returning the same object', () => {
    const plain: DesignPage = { id: 'p', elements: [{ id: 'a', kind: 'text', name: 'a', rect: { x: 0, y: 0, w: 1, h: 1 } }] };
    expect(resolveGroups(plain)).toBe(plain);
  });

  it('ORs a hidden group onto its members and leaves non-members alone', () => {
    const out = resolveGroups(page({ groups: [{ id: 'g1', name: 'L', hidden: true }] }));
    expect(out.elements.map((e) => Boolean(e.hidden))).toEqual([true, true, false]);
  });

  it('ORs a locked group the same way', () => {
    const out = resolveGroups(page({ groups: [{ id: 'g1', name: 'L', locked: true }] }));
    expect(out.elements.map((e) => Boolean(e.locked))).toEqual([true, true, false]);
  });

  it('never UNSETS a member that is hidden or locked on its own', () => {
    const p = page();
    p.elements[0].hidden = true;
    p.elements[0].locked = true;
    const out = resolveGroups(p); // group itself is neither hidden nor locked
    expect(out.elements[0].hidden).toBe(true);
    expect(out.elements[0].locked).toBe(true);
  });

  it('keeps element order, because array order is z-order', () => {
    const out = resolveGroups(page({ groups: [{ id: 'g1', name: 'L', hidden: true }] }));
    expect(out.elements.map((e) => e.id)).toEqual(['a', 'b', 'c']);
  });

  it('ignores a dangling groupId rather than throwing', () => {
    const p = page({ groups: [] });
    expect(() => resolveGroups(p)).not.toThrow();
    expect(resolveGroups(p).elements.every((e) => !e.hidden)).toBe(true);
  });
});

describe('groupMembers', () => {
  it('returns every element id in the group, in page order', () => {
    expect(groupMembers(page(), 'g1')).toEqual(['a', 'b']);
    expect(groupMembers(page(), 'nope')).toEqual([]);
  });
});

describe('groups in a rendered PDF', () => {
  const NOW = new Date('2026-09-01T10:00:00Z');
  const norm = (b: Buffer) => b.toString('latin1')
    .replace(/\(D:\d+Z?\)/g, '(D:X)').replace(/\/ID \[<[0-9a-f]+> <[0-9a-f]+>\]/g, '/ID [X]');
  const design = (pageOver: Partial<DesignPage>) => ({
    id: 'd', name: 'D', paper: 'A4' as const, orientation: 'portrait' as const, status: 'published' as const,
    parameters: [],
    pages: [{
      id: 'p1',
      elements: [
        { id: 'keep', kind: 'text' as const, name: 'keep', rect: { x: 0, y: 40, w: 200, h: 20 }, text: 'kept' },
        { id: 'm1', kind: 'text' as const, name: 'm1', rect: { x: 0, y: 80, w: 200, h: 20 }, text: 'member one', groupId: 'g1' },
        { id: 'm2', kind: 'text' as const, name: 'm2', rect: { x: 0, y: 110, w: 200, h: 20 }, text: 'member two', groupId: 'g1' },
      ],
      ...pageOver,
    }],
  });

  it('a hidden group removes its members from the page', async () => {
    const { renderReportDesignPdf } = await import('./render/index');
    const shown = await renderReportDesignPdf(design({ groups: [{ id: 'g1', name: 'L' }] }) as never, new Map(), { now: NOW });
    const hidden = await renderReportDesignPdf(design({ groups: [{ id: 'g1', name: 'L', hidden: true }] }) as never, new Map(), { now: NOW });
    expect(norm(shown)).not.toBe(norm(hidden));
    // Identical to a design that simply never had the members.
    const without = {
      ...design({}), pages: [{ id: 'p1', elements: [design({}).pages[0].elements[0]] }],
    };
    const bare = await renderReportDesignPdf(without as never, new Map(), { now: NOW });
    expect(norm(hidden)).toBe(norm(bare));
  });

  it('is inert when unset: groups present but neither hidden nor locked changes nothing', async () => {
    const { renderReportDesignPdf } = await import('./render/index');
    const withGroups = await renderReportDesignPdf(design({ groups: [{ id: 'g1', name: 'L' }] }) as never, new Map(), { now: NOW });
    const noGroups = await renderReportDesignPdf(design({}) as never, new Map(), { now: NOW });
    expect(norm(withGroups)).toBe(norm(noGroups));
  });
});
