import { isCompatible, type ContentPackStep } from '@openldr/marketplace';
import type { PackItemKind, PackItemStore, RoleStore } from '@openldr/db';
import { layoutInputSchema, type LayoutInput, type LayoutList, type LayoutPreset } from './layout-presets';

// The needs, role, layout and form steps of a content pack (profile packs design 5.1 to 5.3).
// This file holds the check phase: it reads and never writes.

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
  if (steps.some((s) => s.kind === 'role') && !holds(caps, 'roles.manage')) {
    throw new Error('installing this pack needs the roles.manage capability');
  }

  const items = await deps.packItems.list(packId);
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
        for (const key of step.capabilities) {
          if (!known.has(key)) throw new Error(`unknown capability: ${key}`);
          if (!holds(caps, key)) throw new Error(`you cannot install a role that grants ${key}, because you do not hold it`);
        }
        const existing = await deps.roles.getBySlug(step.slug);
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
