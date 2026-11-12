import * as React from 'react';
import { useTranslation } from 'react-i18next';
import type { FormField, FormFieldOption } from '@openldr/forms/pure';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export interface OptionsEditorProps {
  field: FormField;
  onUpdate: (patch: Partial<FormField>) => void;
}

export function OptionsEditor({ field, onUpdate }: OptionsEditorProps) {
  const { t } = useTranslation();
  const options: FormFieldOption[] = field.valueSetOptions ?? [];

  function updateOption(index: number, key: keyof Pick<FormFieldOption, 'code' | 'display'>, value: string) {
    const next = options.map((opt, i) =>
      i === index ? { ...opt, [key]: value } : opt,
    );
    onUpdate({ valueSetOptions: next });
  }

  function addOption() {
    onUpdate({ valueSetOptions: [...options, { code: '', display: '' }] });
  }

  function removeOption(index: number) {
    onUpdate({ valueSetOptions: options.filter((_, i) => i !== index) });
  }

  return (
    <section className="mt-2">
      <div className="py-3 space-y-2">
        {options.map((opt, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input
              aria-label={t('formBuilder.options.optionCode')}
              value={opt.code}
              onChange={(e) => updateOption(i, 'code', e.target.value)}
              placeholder={t('formBuilder.options.code')}
              className="h-8 text-sm font-mono w-28 shrink-0"
            />
            <Input
              aria-label={t('formBuilder.options.optionDisplay')}
              value={opt.display}
              onChange={(e) => updateOption(i, 'display', e.target.value)}
              placeholder={t('formBuilder.options.display')}
              className="h-8 text-sm flex-1"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t('formBuilder.options.removeOption')}
              className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
              onClick={() => removeOption(i)}
            >
              ×
            </Button>
          </div>
        ))}
      </div>

      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label={t('formBuilder.options.addOption')}
        onClick={addOption}
        className="w-full mt-1"
      >
        {t('formBuilder.options.addOptionButton')}
      </Button>
    </section>
  );
}
