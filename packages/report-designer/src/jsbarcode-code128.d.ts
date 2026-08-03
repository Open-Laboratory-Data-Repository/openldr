/**
 * Types for the ONE private jsbarcode subpath `encode.ts` imports.
 *
 * jsbarcode ships no type declarations for its `bin/` encoder files (and no `exports` map, which is
 * what makes the import legal in the first place). Declaring only the surface actually used keeps
 * the private dependency visible in one place: if a version bump changes this shape, the failure is
 * a type error here rather than a runtime `undefined` deep inside the drawer.
 */
declare module 'jsbarcode/bin/barcodes/CODE128/CODE128_AUTO.js' {
  class CODE128_AUTO {
    constructor(data: string, options: Record<string, unknown>);
    /** False when the input contains a character Code 128 cannot represent. */
    valid(): boolean;
    /** `data` is the bar bitstring ('1' = bar); `text` is the human-readable value. */
    encode(): { data: string; text: string };
  }
  export default CODE128_AUTO;
}
