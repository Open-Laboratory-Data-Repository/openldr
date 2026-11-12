import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  normalizeDiscriminator,
  toStoredDiscriminator,
  type DiscriminatorCondition,
  type DiscriminatorOp,
  type DiscriminatorRule,
  type FormField,
} from '@openldr/forms/pure';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

/** Each shows its name from formBuilder.discriminator.ops, keyed without spaces. */
const OPS: { value: DiscriminatorOp; key: string }[] = [
  { value: 'equals', key: 'equals' },
  { value: 'not equals', key: 'notEquals' },
  { value: 'starts with', key: 'startsWith' },
];

export interface DiscriminatorEditorProps {
  field: FormField;
  onUpdate: (patch: Partial<FormField>) => void;
}

/**
 * Which entry of a repeating FHIR list the field fills: a list of conditions, each an element, an
 * operator and a value. Ported from corlix `FieldEditor.tsx:594-716`.
 *
 * Every edit goes through `toStoredDiscriminator`, so a rule the old map can express is stored as
 * the map and an old form opened and left alone stays byte-identical.
 */
export function DiscriminatorEditor({ field, onUpdate }: DiscriminatorEditorProps): JSX.Element {
  const { t } = useTranslation();
  const rule: DiscriminatorRule = normalizeDiscriminator(field.fhirDiscriminator) ?? { join: 'all', conds: [] };
  const writeRule = (next: DiscriminatorRule) => onUpdate({ fhirDiscriminator: toStoredDiscriminator(next) });
  const writeCond = (i: number, patch: Partial<DiscriminatorCondition>) =>
    writeRule({ ...rule, conds: rule.conds.map((c, k) => (k === i ? { ...c, ...patch } : c)) });

  return (
    <div className="col-span-2 space-y-2">
      <div className="flex items-center gap-2">
        <Checkbox
          id="mapping-array-element"
          aria-label={t('formBuilder.discriminator.arrayElement')}
          checked={!!field.fhirDiscriminator}
          onCheckedChange={(checked) =>
            onUpdate(
              checked
                ? { fhirDiscriminator: {}, fhirValueField: 'value' }
                : { fhirDiscriminator: undefined, fhirValueField: undefined },
            )
          }
        />
        <Label htmlFor="mapping-array-element" className="text-xs">
          {t('formBuilder.discriminator.arrayElement')}
        </Label>
      </div>

      {field.fhirDiscriminator && (
        <div className="min-w-0 space-y-2 rounded-md border border-border p-3">
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground">{t('formBuilder.discriminator.matchCriteria')}</span>
            {/* The join decides nothing with one condition, so it is not asked until there are two. */}
            {rule.conds.length > 1 && (
              <div className="ml-auto inline-flex shrink-0 overflow-hidden rounded border border-border">
                {(['all', 'any'] as const).map((join) => (
                  <Button
                    key={join}
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-pressed={rule.join === join}
                    className={`h-6 rounded-none px-2 text-[10px] ${
                      rule.join === join ? 'bg-primary/15 text-primary' : 'text-muted-foreground'
                    }`}
                    onClick={() => writeRule({ ...rule, join })}
                  >
                    {join === 'all' ? t('formBuilder.discriminator.all') : t('formBuilder.discriminator.any')}
                  </Button>
                ))}
              </div>
            )}
          </div>

          {rule.conds.map((cond, i) => (
            <div key={i} className="flex min-w-0 flex-wrap items-center gap-1 sm:flex-nowrap">
              <Input
                aria-label={t('formBuilder.discriminator.condElement', { n: i + 1 })}
                className="h-7 min-w-0 flex-1 text-xs"
                placeholder={t('formBuilder.discriminator.element')}
                value={cond.el}
                onChange={(e) => writeCond(i, { el: e.target.value })}
              />
              <Select value={cond.op} onValueChange={(v) => writeCond(i, { op: v as DiscriminatorOp })}>
                <SelectTrigger aria-label={t('formBuilder.discriminator.condOperator', { n: i + 1 })} className="h-7 w-[104px] shrink-0 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OPS.map((op) => (
                    <SelectItem key={op.value} value={op.value}>
                      {t(`formBuilder.discriminator.ops.${op.key}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                aria-label={t('formBuilder.discriminator.condValue', { n: i + 1 })}
                className="h-7 min-w-0 flex-1 text-xs"
                placeholder={t('formBuilder.discriminator.value')}
                value={cond.val}
                onChange={(e) => writeCond(i, { val: e.target.value })}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t('formBuilder.discriminator.removeCondition')}
                className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                onClick={() => writeRule({ ...rule, conds: rule.conds.filter((_, k) => k !== i) })}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}

          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 w-full border-dashed text-[11px] font-normal text-primary"
            onClick={() => writeRule({ ...rule, conds: [...rule.conds, { el: '', op: 'equals', val: '' }] })}
          >
            {t('formBuilder.discriminator.addCondition')}
          </Button>

          <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4">
            <Label htmlFor="mapping-value-field" className="whitespace-nowrap text-xs">
              {t('formBuilder.discriminator.valueField')}
            </Label>
            <Input
              id="mapping-value-field"
              aria-label={t('formBuilder.discriminator.valueField')}
              className="h-7 font-mono text-xs"
              value={field.fhirValueField ?? ''}
              onChange={(e) => onUpdate({ fhirValueField: e.target.value || undefined })}
              placeholder={t('formBuilder.discriminator.valueFieldHint')}
            />
          </div>
        </div>
      )}
    </div>
  );
}
