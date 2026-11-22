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

/** The open rule the form routes, the entries routes and the CLI share. An editor manages every
 *  form, so opens every one; anyone else opens the forms their roles may open. */
export function formOpenRule(access: Pick<FormAccessCheck, 'mayOpen' | 'visible'>) {
  const isEditor = (user: FormUser): boolean => user.capabilities.includes('forms.edit');
  return {
    isEditor,
    async mayOpen(user: FormUser, formId: string): Promise<boolean> {
      return isEditor(user) || access.mayOpen(user, formId);
    },
    /** The forms of `formIds` the person may open. */
    async openable(user: FormUser, formIds: string[]): Promise<Set<string>> {
      return isEditor(user) ? new Set(formIds) : access.visible(user, formIds);
    },
  };
}

/** True when the form is filled in on another app page, not on the Forms page. Such a form is left
 *  out of the forms list for anyone who cannot edit forms (design 2026-11-22-form-entries 5.6). */
export function drivesAppPage(targetPages: string[] | null): boolean {
  return !!targetPages && targetPages.length > 0 && !targetPages.includes('forms');
}

/** A refused change of a form's lists: the form or a role does not exist. */
export class FormAccessError extends Error {
  constructor(message: string, readonly reason: 'no-form' | 'no-role') { super(message); }
}

/** Set who may open and submit a form. A role is named by its id or its slug and stored by id,
 *  each once. The route and the CLI both call this, then audit `before` and `after`. */
export async function setFormAccess(
  deps: {
    access: Pick<FormAccessStore, 'set'>;
    forms: { get(id: string): Promise<unknown | null> };
    roles: { list(): Promise<Array<{ id: string; slug: string }>> };
  },
  formId: string,
  input: FormAccess,
): Promise<{ before: FormAccess; after: FormAccess }> {
  if (!(await deps.forms.get(formId))) throw new FormAccessError(`no form ${formId}`, 'no-form');
  const roles = await deps.roles.list();
  const idOf = (name: string): string => {
    const role = roles.find((r) => r.id === name) ?? roles.find((r) => r.slug === name);
    if (!role) throw new FormAccessError(`no role ${name}`, 'no-role');
    return role.id;
  };
  const resolve = (names: string[]) => [...new Set(names.map(idOf))];
  const next = { open: resolve(input.open), submit: resolve(input.submit) };
  // Before and after come from the save itself, read under its lock (roles review FR10).
  return deps.access.set(formId, next);
}

/** A person's role ids and capabilities by their user id, found as sign-in finds them: by the
 *  user's subject, or the id when there is none. Null for an unknown user. A served CLI command
 *  knows only the caller's id, so it asks here (roles review FR4). */
export async function formUserOf(
  deps: {
    users: { get(id: string): Promise<{ id: string; subject?: string | null } | null | undefined> };
    roles: { resolveCapabilities(subject: string): Promise<string[]>; rolesForUser(subject: string): Promise<Array<{ id: string }>> };
  },
  userId: string,
): Promise<FormUser | null> {
  const u = await deps.users.get(userId);
  if (!u) return null;
  const subject = u.subject ?? u.id;
  return {
    roleIds: (await deps.roles.rolesForUser(subject)).map((r) => r.id),
    capabilities: await deps.roles.resolveCapabilities(subject),
  };
}
