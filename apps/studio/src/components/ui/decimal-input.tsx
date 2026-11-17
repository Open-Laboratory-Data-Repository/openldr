import * as React from 'react';
import { Input } from './input';

/** A number, or null for blank text or text that is not yet a finite number ("-", "."). */
export function parseDecimal(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

const format = (value: number | null): string => (value === null ? '' : String(value));

// A number on its way to being typed: "-", "11.", ".5". Anything else is refused at the keystroke.
const PARTIAL_DECIMAL = /^-?\d*\.?\d*$/;

type DecimalInputProps = Omit<React.ComponentProps<'input'>, 'value' | 'onChange' | 'type'> & {
  value: number | null;
  onValueChange: (value: number | null) => void;
};

/**
 * A text input for a number. It keeps the typed text, so "11." and "-" survive while the value
 * stays a number or null. Showing String(value) instead drops the dot: "11." parses to 11 and
 * redraws as "11", so "11.5" becomes 115.
 */
export const DecimalInput = React.forwardRef<HTMLInputElement, DecimalInputProps>(
  ({ value, onValueChange, ...props }, ref) => {
    const [text, setText] = React.useState(() => format(value));
    // The value changed from outside (a reload, a range moved up). Show it. Set during render, not in
    // an effect, so the old text never paints.
    if (parseDecimal(text) !== value && text !== format(value)) setText(format(value));
    return (
      <Input
        ref={ref}
        {...props}
        value={text}
        onChange={(e) => {
          const next = e.target.value;
          if (!PARTIAL_DECIMAL.test(next.trim())) return;
          setText(next);
          onValueChange(parseDecimal(next));
        }}
      />
    );
  },
);
DecimalInput.displayName = 'DecimalInput';
