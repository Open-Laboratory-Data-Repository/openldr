import * as React from 'react';
import { Plus, X } from 'lucide-react';
import type { FormField, VisibilityCondition, VisibilityOperator, VisibilityRule } from '@openldr/forms/pure';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const OPERATORS: VisibilityOperator[] = [
  'equals',
  'notEquals',
  'oneOf',
  'isEmpty',
  'isNotEmpty',
  'gt',
  'lt',
  'gte',
  'lte',
];

const NO_VALUE_OPERATORS = new Set<VisibilityOperator>(['isEmpty', 'isNotEmpty']);

export interface VisibilityRuleEditorProps {
  rule: VisibilityRule | undefined;
  /** The fields a condition can read. The caller leaves out the field being edited. */
  candidateFields: FormField[];
  onChange: (rule: VisibilityRule | undefined) => void;
}

/** A visibility rule for a field or a section. Corlix's props, `components/VisibilityRuleEditor.tsx:40-48`. */
export function VisibilityRuleEditor({
  rule,
  candidateFields,
  onChange,
}: VisibilityRuleEditorProps): JSX.Element {
  const combinator = rule?.combinator ?? 'all';
  const conditions = rule?.conditions ?? [];

  const emit = (next: VisibilityCondition[], comb: 'all' | 'any' = combinator) => {
    onChange(next.length === 0 ? undefined : { combinator: comb, conditions: next });
  };

  const addCondition = () => {
    const first = candidateFields[0];
    emit([
      ...conditions,
      { fieldId: first?.id ?? '', operator: 'isNotEmpty' as VisibilityOperator },
    ]);
  };

  const updateCondition = (i: number, patch: Partial<VisibilityCondition>) => {
    emit(conditions.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  };

  const removeCondition = (i: number) => {
    emit(conditions.filter((_, j) => j !== i));
  };

  return (
    <section className="mt-2">
      <div className="py-4 space-y-2">
        {/* Combinator row */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Show when</span>
          <Select
            value={combinator}
            onValueChange={(v) => emit(conditions, v as 'all' | 'any')}
          >
            <SelectTrigger
              aria-label="Combinator"
              className="h-7 w-20 text-xs"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">all</SelectItem>
              <SelectItem value="any">any</SelectItem>
            </SelectContent>
          </Select>
          <span className="text-xs text-muted-foreground">of the following are true</span>
        </div>

        {/* Condition rows */}
        {conditions.map((cond, i) => {
          const showValue = !NO_VALUE_OPERATORS.has(cond.operator);

          return (
            <div key={i} className="flex items-center gap-1.5">
              {/* Controlling field select (excludes self) */}
              <Select
                value={cond.fieldId || '__none'}
                onValueChange={(v) => updateCondition(i, { fieldId: v === '__none' ? '' : v })}
              >
                <SelectTrigger
                  aria-label="Controlling field"
                  className="h-7 flex-1 text-xs"
                >
                  <SelectValue placeholder="Select field" />
                </SelectTrigger>
                <SelectContent>
                  {candidateFields.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.displayLabel}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Operator select */}
              <Select
                value={cond.operator}
                onValueChange={(v) =>
                  updateCondition(i, { operator: v as VisibilityOperator })
                }
              >
                <SelectTrigger
                  aria-label="Operator"
                  className="h-7 w-28 text-xs"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OPERATORS.map((op) => (
                    <SelectItem key={op} value={op}>
                      {op}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Value input — hidden for isEmpty/isNotEmpty */}
              {showValue && (
                <Input
                  aria-label="Value"
                  className="h-7 w-32 text-xs"
                  value={cond.value ?? ''}
                  placeholder="value"
                  onChange={(e) => updateCondition(i, { value: e.target.value })}
                />
              )}

              {/* Remove button */}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                aria-label="Remove condition"
                onClick={() => removeCondition(i)}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          );
        })}

        {/* Add condition button */}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          onClick={addCondition}
        >
          <Plus className="mr-1 h-3 w-3" />
          Add condition
        </Button>
      </div>
    </section>
  );
}
