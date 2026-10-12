import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppShell } from '@/shell/AppShell';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { PatientsTab } from '@/patients/PatientsTab';
import { PatientSheet } from '@/patients/PatientSheet';
import { IdentifierSystemsTab } from '@/patients/IdentifierSystemsTab';
import { useAuth } from '@/auth/AuthProvider';

// Patient Index (docs/superpowers/specs/2026-10-12-patient-index-design.md, section 3). Tabs copy
// TestCatalog.tsx. data-[state=inactive]:hidden stops a flex panel out-ranking Radix's hidden rule
// (AGENTS.md section 6).
export function Patients() {
  const { t } = useTranslation();
  const { hasCapability } = useAuth();
  const [openRef, setOpenRef] = useState<string | null>(null);
  return (
    <AppShell title={t('patients.title')} fullBleed>
      <Tabs defaultValue="patients" className="flex min-h-0 flex-1 flex-col">
        <div className="border-b border-border px-4">
          <TabsList className="border-b-0">
            <TabsTrigger value="patients" data-testid="patients-tab-patients">{t('patients.tabs.patients')}</TabsTrigger>
            <TabsTrigger value="systems" data-testid="patients-tab-systems">{t('patients.tabs.systems')}</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="patients" className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden">
          <PatientsTab onOpen={setOpenRef} />
        </TabsContent>
        <TabsContent value="systems" className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden">
          <IdentifierSystemsTab canManage={hasCapability('patients.manage')} />
        </TabsContent>
      </Tabs>
      <PatientSheet patientRef={openRef} onClose={() => setOpenRef(null)} onOpen={setOpenRef} />
    </AppShell>
  );
}
