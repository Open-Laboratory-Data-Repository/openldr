import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildProgram } from './program';

const mocks = vi.hoisted(() => ({ runFormsLint: vi.fn().mockResolvedValue(0) }));

vi.mock('./forms', () => ({
  runFormsLint: mocks.runFormsLint,
  runFormsList: vi.fn().mockResolvedValue(0),
  runFormsExtract: vi.fn().mockReturnValue({ resourceTypes: [], invalidCount: 0, bundle: {} }),
}));

describe('forms lint, commander parsing path', () => {
  beforeEach(() => { mocks.runFormsLint.mockClear(); });

  it('passes undefined for the id when none is given', async () => {
    await buildProgram().parseAsync(['node', 'openldr', 'forms', 'lint']);
    expect(mocks.runFormsLint).toHaveBeenCalledWith(undefined, expect.objectContaining({ json: false }));
  });

  it('passes the id through when one is given', async () => {
    await buildProgram().parseAsync(['node', 'openldr', 'forms', 'lint', 'form-sample-facility']);
    expect(mocks.runFormsLint).toHaveBeenCalledWith('form-sample-facility', expect.objectContaining({ json: false }));
  });

  it('carries --json', async () => {
    await buildProgram().parseAsync(['node', 'openldr', 'forms', 'lint', '--json']);
    expect(mocks.runFormsLint).toHaveBeenCalledWith(undefined, expect.objectContaining({ json: true }));
  });
});
