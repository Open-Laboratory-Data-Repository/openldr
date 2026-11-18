import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';
import { Label } from '@/components/ui/label';
import { MultiSelect } from '@/components/ui/multi-select';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { X } from 'lucide-react';
import type { DataScope, DataScopeChoices } from '@/api';

const NOTHING: DataScope = { limited: true, facilities: [], districts: [], regions: [] };
// A district is one value in the picker: its region and name, joined by a character neither holds.
const districtKey = (d: { region: string; district: string }) => `${d.region}\u0000${d.district}`;
const FACILITY_MATCHES = 50;

/**
 * The Data row of the Users sheet (roles part 3): Everything, or Limited to facilities, districts
 * and regions picked from the register. Label left, input right, as the role row above it.
 */
export function DataScopeFields({ scope, choices, onChange }: {
  scope: DataScope;
  choices: DataScopeChoices;
  onChange: (next: DataScope) => void;
}) {
  const { t } = useTranslation();
  const limited = scope.limited ? scope : null;
  const facilityName = (id: string) => {
    const f = choices.facilities.find((x) => x.id === id);
    return f ? f.name : id;
  };
  const facilityOptions = choices.facilities
    .filter((f) => !limited?.facilities.includes(f.id))
    .map((f) => ({ value: f.id, label: [f.name, f.district ?? f.region].filter(Boolean).join(', ') }));

  return (
    <div data-testid="user-data-scope" className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-3 px-6 py-4 border-b border-border">
      <Label htmlFor="user-data-scope-select" className="whitespace-nowrap">{t('users.dataScope.label')}</Label>
      <Select value={scope.limited ? 'limited' : 'everything'} onValueChange={(v) => onChange(v === 'limited' ? (limited ?? NOTHING) : { limited: false })}>
        <SelectTrigger id="user-data-scope-select" className="w-full" aria-label={t('users.dataScope.label')}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="everything">{t('users.dataScope.everything')}</SelectItem>
          <SelectItem value="limited">{t('users.dataScope.limited')}</SelectItem>
        </SelectContent>
      </Select>

      {limited ? (
        <>
          <Label className="self-start whitespace-nowrap pt-2">{t('users.dataScope.regions')}</Label>
          <MultiSelect
            options={choices.regions.map((r) => ({ value: r, label: r }))}
            value={limited.regions}
            onChange={(regions) => onChange({ ...limited, regions })}
            placeholder={t('users.dataScope.addRegion')}
            removeLabel={(name) => t('users.dataScope.remove', { name })}
            aria-label={t('users.dataScope.regions')}
          />

          <Label className="self-start whitespace-nowrap pt-2">{t('users.dataScope.districts')}</Label>
          <MultiSelect
            options={choices.districts.map((d) => ({ value: districtKey(d), label: `${d.district} (${d.region})` }))}
            value={limited.districts.map(districtKey)}
            onChange={(keys) => onChange({
              ...limited,
              districts: keys.map((k) => { const [region, district] = k.split('\u0000'); return { region: region!, district: district! }; }),
            })}
            placeholder={t('users.dataScope.addDistrict')}
            removeLabel={(name) => t('users.dataScope.remove', { name })}
            aria-label={t('users.dataScope.districts')}
          />

          <Label className="self-start whitespace-nowrap pt-2">{t('users.dataScope.facilities')}</Label>
          <div className="flex min-w-0 flex-col gap-1.5">
            {limited.facilities.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {limited.facilities.map((id) => (
                  <Badge key={id} variant="secondary" className="max-w-full gap-1 pr-0.5">
                    <span className="truncate">{facilityName(id)}</span>
                    <Button
                      type="button" variant="ghost" size="icon" className="h-4 w-4 shrink-0"
                      aria-label={t('users.dataScope.remove', { name: facilityName(id) })}
                      onClick={() => onChange({ ...limited, facilities: limited.facilities.filter((x) => x !== id) })}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </Badge>
                ))}
              </div>
            ) : null}
            <Combobox
              options={facilityOptions}
              value={null}
              onChange={(id) => onChange({ ...limited, facilities: [...limited.facilities, id] })}
              placeholder={t('users.dataScope.addFacility')}
              searchPlaceholder={t('users.dataScope.searchFacility')}
              limit={FACILITY_MATCHES}
            />
          </div>

          <p className="col-span-2 text-xs text-muted-foreground">
            {limited.facilities.length + limited.districts.length + limited.regions.length === 0
              ? t('users.dataScope.seesNothing') : t('users.dataScope.seesListed')}
            {' '}{t('users.dataScope.removes')}
          </p>
        </>
      ) : null}
    </div>
  );
}
