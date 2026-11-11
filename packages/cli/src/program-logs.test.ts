import { describe, expect, it } from 'vitest';
import { logDestinationFd } from '@openldr/core';
import { buildProgram } from './program';

describe('CLI logging', () => {
  // The CLI prints results on stdout, and `--json` output is piped into other tools. Logs must not
  // land in the same stream, or an info line comes before the JSON and it no longer parses.
  it('sends logs to stderr, keeping stdout for results', () => {
    buildProgram();
    expect(logDestinationFd()).toBe(2);
  });
});
