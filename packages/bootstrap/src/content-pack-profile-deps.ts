import type { Kysely } from 'kysely';
import { canSubmitForm, fromQuestionnaire, type FormStore } from '@openldr/forms';
import type { FormAccessStore, InternalSchema, MarketplaceInstallStore } from '@openldr/db';
import type { PluginStore } from '@openldr/plugins';
import { setFormAccess } from './form-access';
import type { ProfileDeps } from './content-pack-profile';

// The real stores behind the ProfileDeps members that are more than a pass-through. index.ts wires
// the rest (roles, layouts, capability keys) directly.

/** The users who hold a role, by display name, else username. user_roles stores the sign-in
 *  subject, or the user id for a user with none, as formUserOf finds it. A subject with no users
 *  row shows as itself. Ordered by name, then subject. */
export async function roleMemberNames(db: Kysely<InternalSchema>, roleId: string): Promise<string[]> {
  const rows = await db.selectFrom('user_roles').select('user_id').where('role_id', '=', roleId).execute();
  if (rows.length === 0) return [];
  const subjects = [...new Set(rows.map((r) => r.user_id))];
  const users = await db.selectFrom('users').select(['id', 'subject', 'username', 'display_name'])
    .where((eb) => eb.or([eb('subject', 'in', subjects), eb.and([eb('subject', 'is', null), eb('id', 'in', subjects)])]))
    .execute();
  const nameOf = new Map(users.map((u) => [u.subject ?? u.id, u.display_name || u.username]));
  return subjects
    .map((subject) => ({ subject, name: nameOf.get(subject) ?? subject }))
    .sort((a, b) => a.name.localeCompare(b.name) || (a.subject < b.subject ? -1 : a.subject > b.subject ? 1 : 0))
    .map((m) => m.name);
}

/** The name a pack form is stored under: its title, else the Questionnaire name, else its id. */
function formName(schema: { name?: string }, questionnaire: unknown): string {
  const q = questionnaire as { name?: unknown; id?: unknown };
  return schema.name || (typeof q.name === 'string' && q.name) || (typeof q.id === 'string' && q.id) || 'form';
}

/** The form members of ProfileDeps over the form store, as form-artifact-install.ts installs a form. */
export function packFormDeps(deps: {
  forms: FormStore;
  access: FormAccessStore;
  roles: { list(): Promise<Array<{ id: string; slug: string }>> };
}): ProfileDeps['forms'] {
  const { forms } = deps;
  return {
    check(questionnaire) {
      const schema = fromQuestionnaire(questionnaire as never);
      // The submit route saves a response only when an extractor makes a record from it. A form no
      // extractor covers loads, but every submission of it is refused, so refuse it here instead.
      if (!canSubmitForm(schema)) {
        throw new Error(
          `the form "${formName(schema, questionnaire)}" could never be saved: it is not bound to an order ` +
          '(ServiceRequest) and no field is marked as a result',
        );
      }
    },
    async install(formId, questionnaire, versionLabel, actorId) {
      const schema = fromQuestionnaire(questionnaire as never);
      const s = schema as { name?: string; fhirResourceType?: string | null; fhirVersion?: string | null; fhirProfileUrl?: string | null; targetPages?: string[] };
      const name = formName(schema, questionnaire);
      const input = {
        name, versionLabel, schema,
        fhirResourceType: s.fhirResourceType ?? null, fhirVersion: s.fhirVersion ?? null,
        fhirProfileUrl: s.fhirProfileUrl ?? null, targetPages: s.targetPages ?? null, status: 'draft',
      };
      // Only the form this pack made is ever updated. If an admin deleted it, make a new one.
      if (formId && (await forms.get(formId))) {
        await forms.update(formId, input as never);
        await forms.publish(formId, { versionLabel, actorId });
        return formId;
      }
      const created = await forms.create(input as never);
      await forms.publish(created.id, { versionLabel, actorId });
      return created.id;
    },
    async setAccess(formId, access) {
      await setFormAccess({ access: deps.access, forms, roles: deps.roles }, formId, access);
    },
    async name(formId) {
      return (await forms.get(formId))?.name ?? null;
    },
  };
}

/** The version of the enabled plugin `bundleId`, else of the content pack when it installed
 *  cleanly, else null. */
export async function installedBundleVersion(
  deps: { plugins: Pick<PluginStore, 'get'>; installs: Pick<MarketplaceInstallStore, 'get'> },
  bundleId: string,
): Promise<string | null> {
  const plugin = await deps.plugins.get(bundleId);
  if (plugin) return plugin.version;
  const row = await deps.installs.get(bundleId);
  return row && row.kind === 'content-pack' && row.status === 'installed' ? row.version : null;
}
