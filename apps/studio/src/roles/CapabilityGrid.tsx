import { useTranslation } from 'react-i18next';
import type { CapabilityGroup } from '@/api';
import { Switch } from '@/components/ui/switch';
import {
  totalCapabilityCount, selectedCapabilityCount, toggleCapability, capabilityText,
} from './capabilityGrid.model';

export interface CapabilityGridProps {
  groups: CapabilityGroup[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  readOnly?: boolean;
}

/**
 * instatic-style capability picker: a single "N of M selected" counter at the top, then one
 * card per domain group and a switch per capability (label + description). There is no
 * "select all" control — capabilities are toggled one at a time, deliberately, to avoid
 * accidentally granting a broad set of permissions in one click. All selection math lives in
 * capabilityGrid.model.ts — this component is a thin shadcn shell over those pure functions.
 */
export function CapabilityGrid({ groups, selected, onChange, readOnly = false }: CapabilityGridProps) {
  const { t, i18n } = useTranslation();
  const total = totalCapabilityCount(groups);
  const count = selectedCapabilityCount(groups, selected);

  return (
    <div className="flex flex-col gap-3" data-testid="capability-grid">
      <div className="flex items-center justify-end gap-3">
        <span className="text-xs text-muted-foreground" data-testid="capability-count">
          {t('roles.selectedCount', { selected: count, total })}
        </span>
      </div>

      {groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('roles.noCapabilities')}</p>
      ) : (
        <div className="flex flex-col gap-3">
          {groups.map((group) => (
            <div key={group.key} className="rounded-md border border-border p-3" data-testid={`capability-group-${group.key}`}>
              <div className="flex items-center justify-between gap-3 pb-2">
                <span className="text-sm font-medium">{group.label}</span>
              </div>
              {/* Bleed the divider past the card's own padding so it spans the full card width,
                  matching the app's section-divider convention (e.g. FieldEditorSheet.tsx). */}
              <div className="-mx-3 border-t border-border" />
              <div className="flex flex-col gap-4 pt-4">
                {group.capabilities.map((cap) => {
                  const capId = `capability-${cap.key}`;
                  const text = capabilityText(cap, i18n.language);
                  return (
                    <div key={cap.key} className="flex items-start justify-between gap-4">
                      <div>
                        <div className="text-sm font-medium">{text.label}</div>
                        <div className="text-xs text-muted-foreground">
                          {cap.key === 'data_exposure.manage' ? t('settings.dataExposure.description') : text.description}
                        </div>
                      </div>
                      <Switch
                        data-testid={capId}
                        checked={selected.has(cap.key)}
                        disabled={readOnly}
                        onCheckedChange={() => onChange(toggleCapability(selected, cap.key))}
                        aria-label={text.label}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
