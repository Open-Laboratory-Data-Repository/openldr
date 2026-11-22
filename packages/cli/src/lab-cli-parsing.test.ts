import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildProgram } from './program';

// What commander hands `runLabTestsSet` for --section and --no-section, which share one option name.
// runLabTestsSet itself is tested in lab.test.ts. A fresh Command per test: commander keeps parsed
// values across parseAsync calls on one instance.
const mocks = vi.hoisted(() => ({ runLabTestsSet: vi.fn().mockResolvedValue(0) }));
vi.mock('./lab', async (orig) => ({ ...(await orig<typeof import('./lab')>()), runLabTestsSet: mocks.runLabTestsSet }));

const parse = (...args: string[]) => buildProgram().exitOverride().parseAsync(['node', 'openldr', 'lab', 'tests', 'set', 'HIVVL', ...args]);

describe('lab tests set: commander parsing', () => {
  beforeEach(() => { mocks.runLabTestsSet.mockClear(); });

  it('passes a section code from --section', async () => {
    await parse('--section', 'haem');
    expect(mocks.runLabTestsSet).toHaveBeenCalledWith('HIVVL', expect.objectContaining({ section: 'haem' }));
  });

  it('passes false from --no-section', async () => {
    await parse('--no-section');
    expect(mocks.runLabTestsSet).toHaveBeenCalledWith('HIVVL', expect.objectContaining({ section: false }));
  });

  it('passes no section at all when neither is given, so the stored one is kept', async () => {
    await parse('--needs-review', 'false');
    const opts = mocks.runLabTestsSet.mock.calls[0][1] as Record<string, unknown>;
    expect(opts.needsReview).toBe('false');
    expect(typeof opts.section === 'string' || opts.section === false, `section was ${String(opts.section)}`).toBe(false);
  });
});
