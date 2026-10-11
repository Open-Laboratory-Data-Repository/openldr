import { djb2Hex } from './relational/row-id';

// The warehouse copy of the test mappings (docs/superpowers/specs/2026-10-11-test-mapping-design.md, 4.2).

/** The levels a `test_map` row can hold. This slice writes 'test'. The result-field slice adds 'result'. */
export type TestMapLevel = 'test' | 'result';

const MAX_ID_LENGTH = 200;

/** `test_map.id`: readable `<level>|<system>|<code>` while it fits, else a djb2 hash of it. It must be
 *  deterministic, because every rebuild recomputes it. Same rule as `facilityMapId`. */
export function testMapId(level: TestMapLevel, sourceSystem: string, sourceCode: string): string {
  const readable = `${level}|${sourceSystem}|${sourceCode}`;
  return readable.length <= MAX_ID_LENGTH ? readable : `tm-${djb2Hex(readable)}`;
}
