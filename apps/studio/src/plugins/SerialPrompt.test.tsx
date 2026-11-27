import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@/i18n';
import { useSerialPrompt, type SerialPickResult } from './SerialPrompt';
import type { SerialLike, SerialPortLike } from './serial-gate';

const fakePort = (): SerialPortLike => ({ open: async () => {}, close: async () => {}, readable: null, writable: null, getInfo: () => ({}) });

/** A browser serial feature whose answer the test gives. */
function fakeSerial() {
  const log: string[] = [];
  let settle: { resolve(p: SerialPortLike): void; reject(e: unknown): void } | null = null;
  const serial: SerialLike = {
    requestPort: () => { log.push('requestPort'); return new Promise<SerialPortLike>((resolve, reject) => { settle = { resolve, reject }; }); },
    addEventListener() {}, removeEventListener() {},
  };
  return { serial, log, give: (p: SerialPortLike) => settle?.resolve(p), refuse: (name: string) => settle?.reject(Object.assign(new Error('x'), { name })) };
}

let picker: { pick(): Promise<SerialPickResult>; cancel(): void } | null = null;
function Host({ label, serial, name = 'one' }: { label: string; serial: SerialLike | undefined; name?: string }) {
  const prompt = useSerialPrompt(label, serial);
  if (name === 'one') picker = prompt;
  return (
    <div>
      <button type="button" data-testid={`ask-${name}`} onClick={() => { (window as unknown as Record<string, unknown>)[`result-${name}`] = prompt.pick(); }}>ask</button>
      {prompt.element}
    </div>
  );
}
const result = (name = 'one') => (window as unknown as Record<string, Promise<SerialPickResult>>)[`result-${name}`]!;
const ask = async (name = 'one') => { await act(async () => { fireEvent.click(screen.getByTestId(`ask-${name}`)); }); };

afterEach(() => { cleanup(); picker = null; });

describe('the serial prompt', () => {
  it('names the plugin from the label it was given', async () => {
    render(<Host label="Analyzer interface" serial={fakeSerial().serial} />);
    await ask();
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    expect(screen.getByText('Analyzer interface wants to use a serial port')).toBeTruthy();
    expect(screen.getByText('Choose the port the cable is plugged into. Analyzer interface can then read and write it until this page closes.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Choose port' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
    await act(async () => { picker!.cancel(); });
  });

  it('shows a label with markup in it as plain text', async () => {
    render(<Host label={'<b>x</b><img src=y onerror=alert(1)>'} serial={fakeSerial().serial} />);
    await ask();
    expect(screen.getByText('<b>x</b><img src=y onerror=alert(1)> wants to use a serial port')).toBeTruthy();
    expect(document.querySelector('b')).toBeNull();
    expect(document.querySelector('img')).toBeNull();
    await act(async () => { picker!.cancel(); });
  });

  it('asks the browser for the port inside the press of Choose port', async () => {
    const s = fakeSerial();
    render(<Host label="Analyzer" serial={s.serial} />);
    await ask();
    expect(s.log).toEqual([]);
    // fireEvent runs the press handlers before it returns, with nothing awaited. The browser's
    // own list opens only for a call made there, so the call must already have happened.
    fireEvent.click(screen.getByRole('button', { name: 'Choose port' }));
    expect(s.log).toEqual(['requestPort']);
    await act(async () => { s.refuse('NotFoundError'); });
    await result();
  });

  it('gives the port the person chose', async () => {
    const s = fakeSerial();
    const port = fakePort();
    render(<Host label="Analyzer" serial={s.serial} />);
    await ask();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Choose port' })); });
    // The studio's own question goes away while the browser's list is up.
    expect(screen.queryByRole('alertdialog')).toBeNull();
    await act(async () => { s.give(port); });
    expect(await result()).toEqual({ port });
  });

  it('gives serial-cancelled on Cancel, on Escape, on close and on unmount', async () => {
    const s = fakeSerial();
    const { unmount } = render(<Host label="Analyzer" serial={s.serial} />);
    await ask();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Cancel' })); });
    expect(await result()).toEqual({ refused: 'serial-cancelled' });
    expect(screen.queryByRole('alertdialog')).toBeNull();

    await ask();
    await act(async () => { fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape', code: 'Escape' }); });
    expect(await result()).toEqual({ refused: 'serial-cancelled' });

    await ask();
    await act(async () => { picker!.cancel(); });
    expect(await result()).toEqual({ refused: 'serial-cancelled' });

    await ask();
    const waiting = result();
    unmount();
    expect(await waiting).toEqual({ refused: 'serial-cancelled' });
    expect(s.log).toEqual([]);
  });

  it('gives serial-cancelled when the person closes the browser list without choosing', async () => {
    const s = fakeSerial();
    render(<Host label="Analyzer" serial={s.serial} />);
    await ask();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Choose port' })); });
    await act(async () => { s.refuse('NotFoundError'); });
    expect(await result()).toEqual({ refused: 'serial-cancelled' });
  });

  it('gives serial-unavailable when the browser refuses for security', async () => {
    const s = fakeSerial();
    render(<Host label="Analyzer" serial={s.serial} />);
    await ask();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Choose port' })); });
    await act(async () => { s.refuse('SecurityError'); });
    expect(await result()).toEqual({ refused: 'serial-unavailable' });
  });

  it('gives serial-unavailable with no question when the browser has no serial feature', async () => {
    render(<Host label="Analyzer" serial={undefined} />);
    await ask();
    expect(await result()).toEqual({ refused: 'serial-unavailable' });
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('gives serial-busy to a second prompt while one is open', async () => {
    const s = fakeSerial();
    render(<><Host label="First" serial={s.serial} /><Host label="Second" serial={s.serial} name="two" /></>);
    await ask('one');
    // Radix hides everything outside the open question, so the second button is pressed directly.
    await act(async () => { fireEvent.click(document.querySelector('[data-testid="ask-two"]')!); });
    expect(await result('two')).toEqual({ refused: 'serial-busy' });
    // The same frame asking twice is refused too.
    await act(async () => { fireEvent.click(document.querySelector('[data-testid="ask-one"]')!); });
    expect(await result('one')).toEqual({ refused: 'serial-busy' });
    expect(screen.getAllByRole('alertdialog')).toHaveLength(1);
    expect(screen.getByText('First wants to use a serial port')).toBeTruthy();
    await act(async () => { picker!.cancel(); });
  });

  it('stays busy while the browser list is up, and is free once it closes', async () => {
    const s = fakeSerial();
    render(<><Host label="First" serial={s.serial} /><Host label="Second" serial={s.serial} name="two" /></>);
    await ask('one');
    const first = result('one');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Choose port' })); });
    await ask('two');
    expect(await result('two')).toEqual({ refused: 'serial-busy' });
    await act(async () => { s.refuse('NotFoundError'); });
    expect(await first).toEqual({ refused: 'serial-cancelled' });
    await ask('two');
    expect(screen.getByText('Second wants to use a serial port')).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Cancel' })); });
  });

  it('returns focus to where it was', async () => {
    const s = fakeSerial();
    render(<Host label="Analyzer" serial={s.serial} />);
    const before = screen.getByTestId('ask-one');
    before.focus();
    expect(document.activeElement).toBe(before);
    await ask();
    expect(document.activeElement).not.toBe(before);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Cancel' })); });
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(document.activeElement).toBe(before);
  });
});
