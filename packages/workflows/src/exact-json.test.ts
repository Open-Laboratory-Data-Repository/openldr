import { describe, expect, it } from 'vitest';
import { parseJsonKeepingLongIntegers } from './exact-json';

describe('parseJsonKeepingLongIntegers', () => {
  it('keeps a whole number too long for a JSON number as its exact digits, and names the field', () => {
    const res = parseJsonKeepingLongIntegers('{"specimen_no": 4471200000000000123, "ct": 21.4, "n": 7}');
    expect(res.value).toEqual({ specimen_no: '4471200000000000123', ct: 21.4, n: 7 });
    expect(res.keptAsText).toEqual(['specimen_no']);
  });

  it('keeps a long negative whole number, and names the list it sits in', () => {
    const res = parseJsonKeepingLongIntegers('[{"ids": [-9007199254740993, 5]}]');
    expect(res.value).toEqual([{ ids: ['-9007199254740993', 5] }]);
    expect(res.keptAsText).toEqual(['ids']);
  });

  it('leaves safe whole numbers, decimals and exponents as numbers', () => {
    const text = '{"a": 9007199254740991, "b": -9007199254740991, "c": 12345678901234567.5, "d": 1e300, "e": 0}';
    const res = parseJsonKeepingLongIntegers(text);
    expect(res.value).toEqual(JSON.parse(text));
    expect(res.keptAsText).toEqual([]);
  });

  it('never touches digits inside a string, including after an escaped quote', () => {
    const text = '{"note": "id \\"4471200000000000123\\" 4471200000000000124", "k": "x"}';
    const res = parseJsonKeepingLongIntegers(text);
    expect(res.value).toEqual(JSON.parse(text));
    expect(res.keptAsText).toEqual([]);
  });

  it('names each field once, in the order met, and reads an escaped key', () => {
    const res = parseJsonKeepingLongIntegers('[{"s\\u006e": 4471200000000000123}, {"sn": 4471200000000000124}, {"other": 99999999999999999999}]');
    expect(res.keptAsText).toEqual(['sn', 'other']);
  });

  it('keeps a top-level long whole number', () => {
    expect(parseJsonKeepingLongIntegers('4471200000000000123')).toEqual({ value: '4471200000000000123', keptAsText: ['(value)'] });
  });

  it('still refuses text that is not JSON, including a leading zero', () => {
    expect(() => parseJsonKeepingLongIntegers('{"a": 1,}')).toThrow(SyntaxError);
    expect(() => parseJsonKeepingLongIntegers('{"a": 00071}')).toThrow(SyntaxError);
  });
});
