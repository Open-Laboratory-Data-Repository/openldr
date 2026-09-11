import { expect, it } from 'vitest';
import { buildProgram } from './program';

it('offers scoped connector inspection and updates from a JSON file', () => {
  const connector = buildProgram().commands.find((command) => command.name() === 'connectors');
  expect(connector).toBeDefined();
  expect(connector!.commands.map((command) => command.name())).toEqual(['inspect', 'update']);
  expect(connector!.commands[1].options.some((option) => option.long === '--file' && option.mandatory)).toBe(true);
});
