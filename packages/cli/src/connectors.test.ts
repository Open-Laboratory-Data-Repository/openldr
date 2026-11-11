import { expect, it } from 'vitest';
import { buildProgram } from './program';
import { formatDiagnose } from './connectors';

it('offers scoped connector inspection and updates from a JSON file', () => {
  const connector = buildProgram().commands.find((command) => command.name() === 'connectors');
  expect(connector).toBeDefined();
  expect(connector!.commands.map((command) => command.name())).toEqual(['inspect', 'update', 'diagnose']);
  expect(connector!.commands[1].options.some((option) => option.long === '--file' && option.mandatory)).toBe(true);
});

it('offers connector diagnosis with a --json switch', () => {
  const connector = buildProgram().commands.find((command) => command.name() === 'connectors')!;
  const diagnose = connector.commands.find((command) => command.name() === 'diagnose');
  expect(diagnose).toBeDefined();
  expect(diagnose!.options.some((option) => option.long === '--json')).toBe(true);
});

it('prints one line per step, with the hint under a failed step', () => {
  const text = formatDiagnose({ ok: false, steps: [
    { id: 'config', status: 'pass', detail: 'LABSRV:1433' },
    { id: 'dns', status: 'pass', detail: 'LABSRV resolved to 10.0.0.5' },
    { id: 'tcp', status: 'fail', hint: 'tcpTimeout', detail: 'no answer on port 1433 within 5000 ms' },
    { id: 'login', status: 'skip' },
  ] });
  const lines = text.split('\n');
  expect(lines[0]).toMatch(/^PASS\s+config\s+LABSRV:1433$/);
  expect(lines[2]).toMatch(/^FAIL\s+tcp\s+no answer on port 1433/);
  expect(lines[3]).toMatch(/^\s+A firewall|^\s+No answer on this port/);
  expect(lines[4]).toMatch(/^SKIP\s+login$/);
  expect(text).toContain('Connection check failed at: tcp');
});

it('says all checks passed when nothing failed', () => {
  expect(formatDiagnose({ ok: true, steps: [{ id: 'login', status: 'pass' }] })).toContain('All checks passed.');
});

it('offers show and set for a user\'s studio preferences', () => {
  const user = buildProgram().commands.find((command) => command.name() === 'user')!;
  const prefs = user.commands.find((command) => command.name() === 'preferences');
  expect(prefs?.commands.map((command) => command.name())).toEqual(['show', 'set']);
});

it('offers the import commands', () => {
  const imports = buildProgram().commands.find((command) => command.name() === 'import')!;
  expect(imports.commands.map((command) => command.name())).toEqual(['allow', 'revoke', 'allowed', 'start', 'resume', 'status', 'stop', 'failures']);
  const start = imports.commands.find((command) => command.name() === 'start')!;
  expect(start.options.filter((option) => option.mandatory).map((option) => option.long)).toEqual(['--plugin', '--connector']);
});
