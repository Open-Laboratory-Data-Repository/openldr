import { describe, expect, it } from 'vitest';
import { createPortSelection, maySelectPort, portChoices, type PortChoice } from './serial';

const PORTS = [
  { portId: 'a1', portName: 'COM3', displayName: 'USB Serial Port' },
  { portId: 'b2', portName: 'COM4' },
  { portId: 'c3', portName: 'ttyUSB0', displayName: 'FT232R USB UART' },
];

describe('portChoices', () => {
  it('labels each port with its name and display name', () => {
    expect(portChoices(PORTS, undefined)).toEqual([
      { id: 'a1', label: 'COM3    USB Serial Port', last: false },
      { id: 'b2', label: 'COM4', last: false },
      { id: 'c3', label: 'ttyUSB0    FT232R USB UART', last: false },
    ]);
  });

  it('marks the port used last time, and none when it is not in the list', () => {
    expect(portChoices(PORTS, 'COM4').map((p) => p.last)).toEqual([false, true, false]);
    expect(portChoices(PORTS, 'COM9').map((p) => p.last)).toEqual([false, false, false]);
    expect(portChoices([], 'COM4')).toEqual([]);
  });

  it('marks one row only when two ports carry the same name', () => {
    const twins = [{ portId: 'x', portName: 'COM3' }, { portId: 'y', portName: 'COM3' }];
    expect(portChoices(twins, 'COM3').map((p) => p.last)).toEqual([true, false]);
  });

  it('shows a name that is empty or over long as plain, bounded text', () => {
    const odd = portChoices([{ portId: 'z', portName: '', displayName: 'x'.repeat(500) }], undefined)[0]!;
    expect(odd.label.length).toBeLessThanOrEqual(200);
    expect(odd.label.trim().length).toBeGreaterThan(0);
  });
});

describe('maySelectPort', () => {
  const ok = { isMainWindow: true, isMainFrame: true, frameUrl: 'http://127.0.0.1:3990/studio/x/analyzer', shownAddress: 'http://127.0.0.1:3990/studio/', connectMode: false };

  it('allows a request only from the main window, the main frame and the trusted origin', () => {
    expect(maySelectPort(ok)).toBe(true);
    expect(maySelectPort({ ...ok, isMainWindow: false })).toBe(false);
    expect(maySelectPort({ ...ok, isMainFrame: false })).toBe(false);
    expect(maySelectPort({ ...ok, frameUrl: 'http://127.0.0.1:4000/studio/' })).toBe(false);
    expect(maySelectPort({ ...ok, frameUrl: 'https://example.org/' })).toBe(false);
    expect(maySelectPort({ ...ok, shownAddress: undefined })).toBe(false);
    expect(maySelectPort({ ...ok, frameUrl: 'not a url' })).toBe(false);
  });

  it('allows the connected server over https, and no plain http server', () => {
    const https = { isMainWindow: true, isMainFrame: true, frameUrl: 'https://labpc:3443/studio/x/analyzer', shownAddress: 'https://labpc:3443/studio/', connectMode: true };
    expect(maySelectPort(https)).toBe(true);
    // The same https address when the app is not in connect mode is not the app's own.
    expect(maySelectPort({ ...https, connectMode: false })).toBe(false);
    expect(maySelectPort({ ...https, frameUrl: 'http://labpc:3080/studio/', shownAddress: 'http://labpc:3080/studio/' })).toBe(false);
  });
});

function harness() {
  const shown: Array<PortChoice[] | undefined> = [];
  const answers: string[] = [];
  const selection = createPortSelection((ports) => void shown.push(ports));
  const rows = portChoices(PORTS, undefined);
  return { selection, shown, answers, rows, answer: (id: string) => void answers.push(id) };
}

describe('createPortSelection', () => {
  it('shows the rows, answers with the chosen id and stops being active', () => {
    const h = harness();
    expect(h.selection.active()).toBe(false);
    h.selection.begin(h.rows, h.answer);
    expect(h.selection.active()).toBe(true);
    expect(h.shown).toEqual([h.rows]);
    h.selection.choose('b2');
    expect(h.answers).toEqual(['b2']);
    expect(h.selection.active()).toBe(false);
    // The window is told to close.
    expect(h.shown.at(-1)).toBeUndefined();
  });

  it('answers empty on cancel', () => {
    const h = harness();
    h.selection.begin(h.rows, h.answer);
    h.selection.cancel();
    expect(h.answers).toEqual(['']);
    expect(h.selection.active()).toBe(false);
    expect(h.shown.at(-1)).toBeUndefined();
  });

  it('answers empty for an id that is not in the list', () => {
    const h = harness();
    h.selection.begin(h.rows, h.answer);
    h.selection.choose('nope');
    expect(h.answers).toEqual(['']);
    expect(h.selection.wasChosen('nope')).toBe(false);
  });

  it('cancels a second choice that begins while one is open, and keeps the first', () => {
    const h = harness();
    const second: string[] = [];
    h.selection.begin(h.rows, h.answer);
    h.selection.begin(h.rows, (id) => void second.push(id));
    expect(second).toEqual(['']);
    expect(h.answers).toEqual([]);
    expect(h.selection.active()).toBe(true);
    h.selection.choose('a1');
    expect(h.answers).toEqual(['a1']);
    expect(second).toEqual(['']);
  });

  it('updates the rows while open and ignores an update when not', () => {
    const h = harness();
    h.selection.update(h.rows);
    expect(h.shown).toEqual([]);
    h.selection.begin([], h.answer);
    h.selection.update(h.rows);
    expect(h.shown).toEqual([[], h.rows]);
    // A row that came with the update can be chosen.
    h.selection.choose('c3');
    expect(h.answers).toEqual(['c3']);
    h.selection.update(h.rows);
    expect(h.shown).toHaveLength(3);
  });

  it('answers empty when the chosen port left the list before it was pressed', () => {
    const h = harness();
    h.selection.begin(h.rows, h.answer);
    h.selection.update(h.rows.filter((r) => r.id !== 'b2'));
    h.selection.choose('b2');
    expect(h.answers).toEqual(['']);
  });

  it('never answers twice', () => {
    const h = harness();
    h.selection.begin(h.rows, h.answer);
    h.selection.choose('a1');
    h.selection.cancel();
    h.selection.choose('b2');
    expect(h.answers).toEqual(['a1']);
    const again = harness();
    again.selection.begin(again.rows, again.answer);
    again.selection.cancel();
    again.selection.cancel();
    again.selection.choose('a1');
    expect(again.answers).toEqual(['']);
  });

  it('remembers only the ports that were pressed', () => {
    const h = harness();
    h.selection.begin(h.rows, h.answer);
    expect(h.selection.wasChosen('a1')).toBe(false);
    h.selection.choose('a1');
    expect(h.selection.wasChosen('a1')).toBe(true);
    expect(h.selection.wasChosen('b2')).toBe(false);
    expect(h.selection.wasChosen('c3')).toBe(false);
    // A cancelled choice adds nothing.
    h.selection.begin(h.rows, h.answer);
    h.selection.cancel();
    expect(h.selection.wasChosen('b2')).toBe(false);
  });

  it('answers empty when the main window goes away', () => {
    const h = harness();
    h.selection.begin(h.rows, h.answer);
    // main.ts calls cancel for the window closing, a navigation, and the app ending.
    h.selection.cancel();
    expect(h.answers).toEqual(['']);
  });

  it('answers empty at once when the window cannot be shown, and is free for the next request', () => {
    let fail = true;
    const shown: Array<PortChoice[] | undefined> = [];
    const selection = createPortSelection((ports) => { if (fail && ports !== undefined) throw new Error('no window'); shown.push(ports); });
    const answers: string[] = [];
    expect(() => selection.begin(portChoices(PORTS, undefined), (id) => void answers.push(id))).not.toThrow();
    // A request with no window would wait for ever. It is answered with no port, once.
    expect(answers).toEqual(['']);
    expect(selection.active()).toBe(false);
    selection.cancel();
    expect(answers).toEqual(['']);
    fail = false;
    selection.begin(portChoices(PORTS, undefined), (id) => void answers.push(id));
    expect(selection.active()).toBe(true);
    selection.choose('a1');
    expect(answers).toEqual(['', 'a1']);
  });

  it('answers empty when the window cannot be redrawn with a changed list', () => {
    let fail = false;
    const selection = createPortSelection((ports) => { if (fail && ports !== undefined) throw new Error('window gone'); });
    const answers: string[] = [];
    selection.begin(portChoices(PORTS, undefined), (id) => void answers.push(id));
    fail = true;
    expect(() => selection.update([])).not.toThrow();
    expect(answers).toEqual(['']);
    expect(selection.active()).toBe(false);
  });

  it('is not stopped by an answer that throws', () => {
    const selection = createPortSelection(() => {});
    selection.begin(portChoices(PORTS, undefined), () => { throw new Error('gone'); });
    expect(() => selection.choose('a1')).not.toThrow();
    expect(selection.active()).toBe(false);
  });
});
