import { describe, expect, it } from 'vitest';
import { canRunOffThread, usesWorker } from './extism-runner';

describe('off the main thread', () => {
  it('a_clean_process_can_run_a_call_off_the_main_thread', () => {
    expect(canRunOffThread([])).toBe(true);
    expect(canRunOffThread(['--max-old-space-size=4096'])).toBe(true);
  });
  it('a_process_started_with_a_loader_flag_cannot', () => {
    for (const argv of [['--import', 'x'], ['--require', 'x'], ['-r', 'x'], ['--loader', 'x'], ['--import=x'], ['--experimental-loader=x']]) {
      expect(canRunOffThread(argv)).toBe(false);
    }
  });
  it('pinned_hosts_use_the_worker_as_before_whatever_the_flags', () => {
    expect(usesWorker({ allowedHosts: ['a:443'] }, ['--import', 'x'])).toBe(true);
    expect(usesWorker({ allowedHosts: [] }, [])).toBe(false);
    expect(usesWorker({}, [])).toBe(false);
  });
  it('offThread_uses_the_worker_only_in_a_clean_process', () => {
    expect(usesWorker({ offThread: true }, [])).toBe(true);
    expect(usesWorker({ offThread: true }, ['--import', 'x'])).toBe(false);
    expect(usesWorker({ offThread: false }, [])).toBe(false);
  });
});
