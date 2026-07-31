import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { MoreHorizontal, Pencil, EyeOff, Trash2, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

interface Props {
  /** Opens the parameters sheet. Parameters live here rather than in a always-on bar so the
   *  report itself starts near the top of the viewport on a phone. */
  onOpenParameters?: () => void;
  onOpenHistory?: () => void;
  onOpenSchedules?: () => void;
  canManageSchedules?: boolean;
  /** The linked report-designer template id for a data-driven (source==='design') report. */
  designId?: string;
  /** The report-def id, needed for the Unpublish/Delete actions (source==='design' only). */
  reportId?: string;
  /** 'design' = a report-defs record (unpublish/delete apply); 'catalog' = a built-in report. */
  source?: string;
  /** Manager gate for Unpublish/Delete, independent of canManageSchedules. */
  canManage?: boolean;
  onUnpublish?: () => void;
  onDelete?: () => void;
}

/** SP-3b: Run History (SP-2) and Schedules (manager-only) are live. Unpublish/Delete apply to source==='design' reports. */
export function ReportActionsMenu({
  onOpenParameters, onOpenHistory, onOpenSchedules, canManageSchedules, designId, reportId, source, canManage, onUnpublish, onDelete,
}: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const showManageActions = source === 'design' && canManage;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t('common.actions')}>
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {onOpenParameters && (
          <>
            <DropdownMenuItem onSelect={() => onOpenParameters()}>
              <SlidersHorizontal className="mr-2 h-4 w-4" /> {t('reports.parameters')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem onSelect={() => onOpenHistory?.()}>
          {t('reports.runHistory')}
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!canManageSchedules}
          title={canManageSchedules ? undefined : t('reports.comingSoon')}
          onSelect={() => { if (canManageSchedules) onOpenSchedules?.(); }}
        >
          {t('reports.schedules')}
        </DropdownMenuItem>
        {designId && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={!canManageSchedules}
              title={canManageSchedules ? undefined : t('reports.comingSoon')}
              onSelect={() => { if (canManageSchedules) navigate(`/report-designer/${designId}`); }}
            >
              <Pencil className="mr-2 h-4 w-4" /> {t('reports.editTemplate')}
            </DropdownMenuItem>
          </>
        )}
        {showManageActions && reportId && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onUnpublish?.()}>
              <EyeOff className="mr-2 h-4 w-4" /> {t('reports.unpublish')}
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onSelect={() => setConfirmDeleteOpen(true)}
            >
              <Trash2 className="mr-2 h-4 w-4" /> {t('reports.deleteReport')}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>

      <ConfirmDialog
        open={confirmDeleteOpen}
        onOpenChange={setConfirmDeleteOpen}
        title={t('reports.deleteConfirmTitle')}
        description={t('reports.deleteConfirmBody')}
        confirmLabel={t('reports.deleteReport')}
        cancelLabel={t('common.cancel')}
        destructive
        onConfirm={() => { setConfirmDeleteOpen(false); onDelete?.(); }}
      />
    </DropdownMenu>
  );
}
