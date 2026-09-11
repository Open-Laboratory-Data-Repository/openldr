import { expect, it } from 'vitest';
import { createShutdown } from './shutdown';

it('drains requests and workers before closing dependencies, once across repeated signals', async () => {
  const actions: string[] = [];
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const shutdown = createShutdown({
    stopUpdateCheck() { actions.push('update stopped'); },
    async closeApp() { actions.push('requests stopped'); await blocked; actions.push('requests drained'); },
    async stopWorker() { actions.push('worker stopped'); await blocked; actions.push('worker drained'); },
    async closeIngest() { actions.push('ingest closed'); },
    async closeContext() { actions.push('context closed'); },
  });
  const first = shutdown();
  const second = shutdown();
  expect(second).toBe(first);
  expect(actions).toEqual(['update stopped', 'requests stopped', 'worker stopped']);
  release();
  await first;
  expect(actions).toEqual([
    'update stopped', 'requests stopped', 'worker stopped', 'requests drained', 'worker drained',
    'ingest closed', 'context closed',
  ]);
});
