// Fakes for tests of the serial gate and of what uses it. Not used by the studio itself.

import type { SerialPortLike } from './serial-gate';

/** A port whose incoming bytes the test pushes, and whose writes it records. */
export function fakePort(o: { info?: { usbVendorId?: number; usbProductId?: number }; openFails?: boolean; closeFails?: boolean } = {}) {
  const events: string[] = [];
  const written: number[][] = [];
  let push: (bytes: Uint8Array) => void = () => {};
  let fail: (err: Error) => void = () => {};
  /** While set, a write does not finish until it is called. */
  let unblock: (() => void) | null = null;
  let blockWrites = false;
  let holdOpen: Promise<void> | null = null;
  let holdClose: Promise<void> | null = null;
  const opened: unknown[] = [];
  const port: SerialPortLike & { __name?: string } = {
    readable: null,
    writable: null,
    async open(options) {
      events.push('open');
      opened.push(options);
      if (holdOpen) await holdOpen;
      if (o.openFails) throw Object.assign(new Error('Failed to open serial port.'), { name: 'NetworkError' });
      port.readable = new ReadableStream<Uint8Array>({
        start(controller) {
          push = (bytes) => controller.enqueue(bytes);
          fail = (err) => controller.error(err);
        },
        cancel() { events.push('reader.cancel'); },
      }, { highWaterMark: 0 });
      port.writable = new WritableStream<Uint8Array>({
        write(chunk) {
          written.push(Array.from(chunk));
          if (!blockWrites) return undefined;
          return new Promise<void>((resolve) => { unblock = resolve; });
        },
        abort() { events.push('writer.abort'); },
      });
    },
    async close() {
      if (port.readable?.locked) throw Object.assign(new Error('The port is locked.'), { name: 'InvalidStateError' });
      if (port.writable?.locked) throw Object.assign(new Error('The port is locked.'), { name: 'InvalidStateError' });
      events.push('port.close');
      if (holdClose) await holdClose;
      events.push('port.closed');
      port.readable = null;
      port.writable = null;
      if (o.closeFails) throw new Error('close failed');
    },
    getInfo: () => o.info ?? {},
  };
  return {
    port, events, written, opened,
    push: (bytes: number[] | Uint8Array) => push(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)),
    fail: (err: Error) => fail(err),
    blockWrites: () => { blockWrites = true; },
    unblock: () => unblock?.(),
    holdOpen: () => { let release = () => {}; holdOpen = new Promise<void>((r) => { release = r; }); return release; },
    holdClose: () => { let release = () => {}; holdClose = new Promise<void>((r) => { release = r; }); return release; },
  };
}
