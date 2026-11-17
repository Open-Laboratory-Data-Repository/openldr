// Test helper: renders the shadcn Select as a native <select> so tests can pick by label.
// Used through `vi.mock('@/components/ui/select', () => import('./test-select-mock'))`.
import { Children, isValidElement, type ReactNode } from 'react';

export function SelectTrigger(_: { children?: ReactNode; 'aria-label'?: string; className?: string }) {
  return null;
}
export const SelectValue = (_: { placeholder?: string }) => null;
export const SelectContent = ({ children }: { children?: ReactNode }) => <>{children}</>;
export const SelectItem = ({ value, children, disabled }: { value: string; children?: ReactNode; disabled?: boolean }) => (
  <option value={value} disabled={disabled}>
    {children}
  </option>
);
export function Select({
  children,
  value,
  onValueChange,
  disabled,
}: {
  children?: ReactNode;
  value?: string;
  onValueChange?: (v: string) => void;
  disabled?: boolean;
}) {
  let label: string | undefined;
  Children.forEach(children, (c) => {
    if (isValidElement(c) && c.type === SelectTrigger) label = (c.props as { 'aria-label'?: string })['aria-label'];
  });
  return (
    <select aria-label={label} value={value ?? ''} disabled={disabled} onChange={(e) => onValueChange?.(e.target.value)}>
      <option value="">-</option>
      {children}
    </select>
  );
}
