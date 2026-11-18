import { DashboardSchema, type Dashboard } from '../types';
import openldrGeneral from './openldr-general.json';

/**
 * The bundled first-party "Lab Overview (Sample)" board — a full corlix-style dashboard
 * (KPIs, gauge, charts, funnel, table) driven by the Period/Test/Priority filters. Every
 * widget is a builder widget, so a user with a data limit sees it limited (roles part 3), except
 * the funnel (it counts specimens, which name no facility) and the Recent Orders table (rows, not
 * counts), which stay `mode:'sql'`. This is the vetted sample the server seeds with `id:'default'`.
 *
 * Parsed + validated through DashboardSchema so a malformed sample fails loudly at import,
 * and so both the server seed and the client get the same typed `Dashboard` shape.
 */
export const SAMPLE_DASHBOARD: Dashboard = DashboardSchema.parse({
  id: 'default',
  ownerId: null,
  isDefault: true,
  ...(openldrGeneral as Record<string, unknown>),
});
