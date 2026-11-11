import { browserOffset, fromOptions, problems, toOptions } from './options';

const ok = { tz: '+02:00', database: '', from: '', to: '', panels: '' };

describe('import options', () => {
  it('turns the browser offset into the text the plugin expects', () => {
    expect(browserOffset(-120)).toBe('+02:00');
    expect(browserOffset(0)).toBe('Z');
    expect(browserOffset(210)).toBe('-03:30');
  });

  it('accepts a time zone alone and names each wrong field', () => {
    expect(problems(ok)).toEqual([]);
    expect(problems({ ...ok, tz: 'CAT' })).toEqual(['tz']);
    expect(problems({ ...ok, tz: '' })).toEqual(['tz']);
    expect(problems({ ...ok, database: 'Open LDR' })).toEqual(['database']);
    expect(problems({ ...ok, from: '2024-1-1' })).toEqual(['from']);
    expect(problems({ ...ok, from: '2024-02-01', to: '2024-01-01' })).toEqual(['range']);
    expect(problems({ ...ok, panels: 'HIVVL, VIRAL' })).toEqual([]);
    expect(problems({ ...ok, panels: "HIVVL'; DROP" })).toEqual(['panels']);
  });

  it('sends only the options that were filled in', () => {
    expect(toOptions({ tz: ' +02:00 ', database: '', from: '2024-01-01', to: '', panels: ' HIVVL , VIRAL ,' }))
      .toEqual({ tz: '+02:00', from: '2024-01-01', panels: 'HIVVL,VIRAL' });
    expect(fromOptions({ tz: 'Z', panels: 'A' })).toEqual({ tz: 'Z', database: '', from: '', to: '', panels: 'A' });
  });
});
