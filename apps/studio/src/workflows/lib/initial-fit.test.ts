import { describe, it, expect } from 'vitest';
import { shouldFitLoadedWorkflow } from './initial-fit';

describe('shouldFitLoadedWorkflow', () => {
  const ready = { loadSeq: 2, fittedSeq: 1, nodeCount: 4, nodesMeasured: true };

  it('fits a newly loaded workflow once its nodes are measured', () => {
    expect(shouldFitLoadedWorkflow(ready)).toBe(true);
  });

  it('does not fit before the nodes are measured, so the fit is not spent on zero-size nodes', () => {
    expect(shouldFitLoadedWorkflow({ ...ready, nodesMeasured: false })).toBe(false);
  });

  it('does not fit an empty canvas', () => {
    expect(shouldFitLoadedWorkflow({ ...ready, nodeCount: 0 })).toBe(false);
  });

  it('does not fit the same load twice, so editing a loaded workflow keeps the person\'s zoom', () => {
    expect(shouldFitLoadedWorkflow({ ...ready, fittedSeq: 2 })).toBe(false);
  });

  it('fits again after a later load, such as switching to another workflow', () => {
    expect(shouldFitLoadedWorkflow({ ...ready, loadSeq: 3, fittedSeq: 2 })).toBe(true);
  });
});
