import type { FastifyInstance } from 'fastify';
import type { AppContext } from '@openldr/bootstrap';
import { getUserPreferences, saveUserPreferences, userPreferencesPatchSchema } from '@openldr/bootstrap';

// A signed-in user's own studio preferences (theme, sidebar state, first page). No capability
// gate: every user has a look, whatever their role. The user id always comes from the session,
// never from the request, so one user cannot read or change another's row.
export function registerMePreferencesRoutes(app: FastifyInstance<any, any, any, any>, ctx: Pick<AppContext, 'internalDb'>): void {
  app.get('/api/me/preferences', async (req, reply) => {
    if (!req.user) { reply.code(401); return { error: 'authentication required' }; }
    return getUserPreferences(ctx.internalDb, req.user.id);
  });

  app.put('/api/me/preferences', async (req, reply) => {
    if (!req.user) { reply.code(401); return { error: 'authentication required' }; }
    const parsed = userPreferencesPatchSchema.safeParse(req.body);
    if (!parsed.success) { reply.code(400); return { error: 'invalid preferences' }; }
    return saveUserPreferences(ctx.internalDb, req.user.id, parsed.data);
  });
}
