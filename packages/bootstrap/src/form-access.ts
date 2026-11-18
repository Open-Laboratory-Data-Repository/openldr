import type { FormAccess, FormAccessStore } from '@openldr/db';

// Who may open and who may submit a form (design 2026-11-18-roles-scope, part 1). The form routes,
// the CLI and the form list all ask here, so they agree.
//
// An empty list keeps the old rule: the capability alone. A list narrows it to people who also hold
// one of the listed roles. Submitting needs the form to be open to the person too. A holder of
// `roles.manage` passes everything, so an admin can never lock themselves out of a form.

/** The person asking: the ids of their roles and their capabilities. */
export interface FormUser { roleIds: string[]; capabilities: string[] }

const ADMIN = 'roles.manage';

export function formAccess(deps: { access: FormAccessStore }) {
  const listed = (list: string[], user: FormUser): boolean => list.length === 0 || list.some((r) => user.roleIds.includes(r));
  const opens = (a: FormAccess, user: FormUser): boolean =>
    user.capabilities.includes(ADMIN) || (user.capabilities.includes('forms.view') && listed(a.open, user));
  const submits = (a: FormAccess, user: FormUser): boolean =>
    user.capabilities.includes('forms.submit') && (user.capabilities.includes(ADMIN) || (opens(a, user) && listed(a.submit, user)));
  return {
    async mayOpen(user: FormUser, formId: string): Promise<boolean> {
      return opens(await deps.access.get(formId), user);
    },
    async maySubmit(user: FormUser, formId: string): Promise<boolean> {
      return submits(await deps.access.get(formId), user);
    },
    /** The forms of `formIds` the person may open. */
    async visible(user: FormUser, formIds: string[]): Promise<Set<string>> {
      const lists = await deps.access.forForms(formIds);
      const none: FormAccess = { open: [], submit: [] };
      return new Set(formIds.filter((id) => opens(lists.get(id) ?? none, user)));
    },
  };
}
export type FormAccessCheck = ReturnType<typeof formAccess>;
