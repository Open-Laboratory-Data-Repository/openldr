import { isCompatible, type ContentPackStep } from '@openldr/marketplace';
import type { PackItemKind, PackItemStore, RoleStore } from '@openldr/db';
import { slugify } from '@openldr/rbac';
import { layoutInputSchema, type LayoutInput, type LayoutList, type LayoutPreset } from './layout-presets';

// The needs, role, layout and form steps of a content pack (profile packs design 5.1 to 5.3).
// checkProfileSteps is the check phase: it reads and never writes. runProfileStep and dropLeftOut
// are the write phase. Steps write one at a time with no transaction around them (design 5.1b), so
// each write is safe to run again: ownership is looked up by pack id and key, never by version.

export interface ProfileDeps {
  packItems: PackItemStore;
  roles: Pick<RoleStore, 'get' | 'getBySlug' | 'create' | 'update' | 'remove'>;
  /** Display names of the users who hold a role. */
  roleMembers(roleId: string): Promise<string[]>;
  layouts: {
    list(): Promise<LayoutList>;
    save(id: string | null, input: LayoutInput, actor: string | null): Promise<LayoutPreset>;
    remove(id: string): Promise<LayoutPreset>;
  };
  forms: {
    /** Create (formId null) or update a form from a Questionnaire, publish it, return its id. */
    install(formId: string | null, questionnaire: unknown, versionLabel: string, actorId: string | null): Promise<string>;
    /** Throws when the Questionnaire would not load. Writes nothing. */
    check(questionnaire: unknown): void;
    /** Sets who may open and submit the form. Takes role slugs. */
    setAccess(formId: string, access: { open: string[]; submit: string[] }): Promise<void>;
  };
  /** Installed version of a plugin or content pack, or null. */
  installedVersion(bundleId: string): Promise<string | null>;
  capabilityKeys: readonly string[];
}

/** The capabilities of the person installing. 'all' when nothing limits them, as on the CLI. */
export type InstallerCapabilities = readonly string[] | 'all';

/** An update or removal would drop a role that users still hold. */
export class PackRemovalError extends Error {
  constructor(readonly holders: { role: string; users: string[] }[]) {
    super(`users still hold a role this pack made: ${holders.map((h) => `${h.role} (${h.users.join(', ')})`).join('; ')}`);
    this.name = 'PackRemovalError';
  }
}

const holds = (caps: InstallerCapabilities, key: string): boolean => caps === 'all' || caps.includes(key);

/** Throws on the first problem. Writes nothing. */
export async function checkProfileSteps(
  deps: ProfileDeps, packId: string, steps: ContentPackStep[], caps: InstallerCapabilities,
): Promise<void> {
  const items = await deps.packItems.list(packId);
  // An update that leaves out a role this pack made deletes that role, so it needs roles.manage too.
  const touchesRoles = steps.some((s) => s.kind === 'role') || items.some((i) => i.kind === 'role');
  if (touchesRoles && !holds(caps, 'roles.manage')) {
    throw new Error('installing this pack needs the roles.manage capability');
  }

  const ownedId = (kind: PackItemKind, key: string): string | null =>
    items.find((i) => i.kind === kind && i.key === key)?.itemId ?? null;
  const known = new Set(deps.capabilityKeys);
  // Slugs of the roles the steps so far create. A layout or form may name only these.
  const created = new Set<string>();
  const namesEarlierRoles = (n: number, slugs: string[]) => {
    for (const slug of slugs) {
      if (!created.has(slug)) throw new Error(`step ${n} names the role ${slug}, which no earlier step of this pack creates`);
    }
  };
  let layouts: LayoutList | null = null;
  const layoutNames = new Set<string>();

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const n = i + 1;
    switch (step.kind) {
      case 'needs':
        for (const b of step.bundles) {
          const version = await deps.installedVersion(b.id);
          if (version === null) throw new Error(`this pack needs ${b.id} ${b.version}, which is not installed`);
          if (!isCompatible(b.version, version)) throw new Error(`this pack needs ${b.id} ${b.version}; ${version} is installed`);
        }
        break;
      case 'role': {
        // RoleStore.create slugifies the slug, so a slug that is not already its own slug would be
        // stored under another one and the next run would not find it.
        if (slugify(step.slug) !== step.slug) {
          throw new Error(`the role slug ${step.slug} must be lowercase letters, digits and single hyphens`);
        }
        for (const key of step.capabilities) {
          if (!known.has(key)) throw new Error(`unknown capability: ${key}`);
          if (!holds(caps, key)) throw new Error(`you cannot install a role that grants ${key}, because you do not hold it`);
        }
        const existing = await deps.roles.getBySlug(slugify(step.slug));
        if (existing && existing.id !== ownedId('role', step.slug)) {
          throw new Error(`a role with the slug ${step.slug} already exists and this pack did not make it`);
        }
        created.add(step.slug);
        break;
      }
      case 'layout': {
        namesEarlierRoles(n, step.roles);
        const parsed = layoutInputSchema.safeParse({ name: step.name, startPage: step.startPage, pages: step.pages, roles: step.roles });
        if (!parsed.success) throw new Error(parsed.error.issues[0].message);
        if (layoutNames.has(parsed.data.name)) {
          throw new Error(`step ${n} uses the layout name ${parsed.data.name}, which an earlier step of this pack already uses`);
        }
        layoutNames.add(parsed.data.name);
        layouts ??= await deps.layouts.list();
        const existing = layouts.layouts.find((l) => l.name === parsed.data.name);
        if (existing && existing.id !== ownedId('layout', step.key)) {
          throw new Error(`a layout named ${parsed.data.name} already exists and this pack did not make it`);
        }
        break;
      }
      case 'form':
        namesEarlierRoles(n, [...step.open, ...step.submit]);
        deps.forms.check(step.questionnaire);
        break;
      default:
        break;
    }
  }

  // A role this pack made that the new steps leave out is removed on install (design 5.2). Refuse
  // while users still hold it, and list them all, so the admin can move them in one pass.
  const holders: { role: string; users: string[] }[] = [];
  for (const item of items) {
    if (item.kind !== 'role' || created.has(item.key)) continue;
    const role = await deps.roles.get(item.itemId);
    if (!role) continue;
    const users = await deps.roleMembers(role.id);
    if (users.length > 0) holders.push({ role: role.slug, users });
  }
  if (holders.length > 0) throw new PackRemovalError(holders);
}

/** What runStep records in the audit for one profile step. */
export interface ProfileStepAudit {
  action: 'role.create' | 'role.update' | 'layout.create' | 'layout.update' | 'form.install';
  entityType: 'role' | 'layout' | 'form';
  entityId: string;
}

/** Runs one role, layout or form step. Safe to run again. Returns what to audit. A needs step writes nothing. */
export async function runProfileStep(
  deps: ProfileDeps, packId: string, version: string, step: ContentPackStep, actorId: string | null,
): Promise<ProfileStepAudit | null> {
  const owned = async (kind: PackItemKind, key: string): Promise<string | null> =>
    (await deps.packItems.list(packId)).find((i) => i.kind === kind && i.key === key)?.itemId ?? null;

  switch (step.kind) {
    case 'role': {
      const fields = { name: step.name, description: step.description ?? null, capabilities: step.capabilities };
      const itemId = await owned('role', step.slug);
      // A row whose role an admin deleted counts as not found, so the role is made again.
      if (itemId && (await deps.roles.get(itemId))) {
        await deps.roles.update(itemId, fields);
        return { action: 'role.update', entityType: 'role', entityId: itemId };
      }
      const role = await deps.roles.create({ slug: step.slug, ...fields });
      await deps.packItems.put({ packId, kind: 'role', key: step.slug, itemId: role.id });
      return { action: 'role.create', entityType: 'role', entityId: role.id };
    }
    case 'layout': {
      // The trimmed name, the one the check phase compared.
      const input = { name: step.name.trim(), startPage: step.startPage, pages: step.pages, roles: step.roles };
      const itemId = await owned('layout', step.key);
      if (itemId && (await deps.layouts.list()).layouts.some((l) => l.id === itemId)) {
        await deps.layouts.save(itemId, input, actorId);
        return { action: 'layout.update', entityType: 'layout', entityId: itemId };
      }
      const layout = await deps.layouts.save(null, input, actorId);
      await deps.packItems.put({ packId, kind: 'layout', key: step.key, itemId: layout.id });
      return { action: 'layout.create', entityType: 'layout', entityId: layout.id };
    }
    case 'form': {
      const formId = await deps.forms.install(await owned('form', step.key), step.questionnaire, version, actorId);
      await deps.packItems.put({ packId, kind: 'form', key: step.key, itemId: formId });
      await deps.forms.setAccess(formId, { open: step.open, submit: step.submit });
      return { action: 'form.install', entityType: 'form', entityId: formId };
    }
    default:
      return null;
  }
}

/** One role or layout dropLeftOut deleted. `before` is the row as it was, for the audit. */
export interface Removed { kind: 'role' | 'layout'; key: string; itemId: string; name: string; before: unknown }

/** What dropLeftOut deleted, and the keys of the forms it let go. Items already gone are not listed. */
export interface LeftOut { roles: Removed[]; layouts: Removed[]; formsKept: string[] }

/** After every step succeeded: remove roles and layouts the pack owns that the new steps leave out.
 *  Forms it leaves out lose their owner and stay (design 5.2). The check phase already refused when
 *  users still hold a left-out role. `onRemoved` runs right after each delete, so a later delete that
 *  throws cannot leave an earlier one unaudited. An item an admin already deleted is forgotten, and
 *  neither listed nor passed to `onRemoved`. */
export async function dropLeftOut(
  deps: ProfileDeps, packId: string, steps: ContentPackStep[], onRemoved: (r: Removed) => Promise<void> = async () => undefined,
): Promise<LeftOut> {
  const keep = new Set<string>();
  for (const s of steps) {
    if (s.kind === 'role') keep.add(`role:${s.slug}`);
    else if (s.kind === 'layout' || s.kind === 'form') keep.add(`${s.kind}:${s.key}`);
  }
  const out: LeftOut = { roles: [], layouts: [], formsKept: [] };
  let layouts: LayoutList | null = null;
  for (const item of await deps.packItems.list(packId)) {
    if (keep.has(`${item.kind}:${item.key}`)) continue;
    if (item.kind === 'role') {
      const role = await deps.roles.get(item.itemId);
      if (role) {
        await deps.roles.remove(item.itemId);
        const r: Removed = { kind: 'role', key: item.key, itemId: item.itemId, name: role.name, before: role };
        out.roles.push(r);
        await onRemoved(r);
      }
    } else if (item.kind === 'layout') {
      layouts ??= await deps.layouts.list();
      if (layouts.layouts.some((l) => l.id === item.itemId)) {
        const gone = await deps.layouts.remove(item.itemId);
        const r: Removed = { kind: 'layout', key: item.key, itemId: item.itemId, name: gone.name, before: gone };
        out.layouts.push(r);
        await onRemoved(r);
      }
    } else {
      out.formsKept.push(item.key);
    }
    await deps.packItems.remove(packId, item.kind, item.key);
  }
  return out;
}
