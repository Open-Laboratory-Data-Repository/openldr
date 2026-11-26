import type { Kysely } from 'kysely';
import {
  HttpRegistrySource,
  LocalRegistrySource,
  isCompatible,
  type Bundle,
  type RegistryListing,
  type RegistrySource,
} from '@openldr/marketplace';
import { createRegistryStore, type InternalSchema, type RegistryRecord } from '@openldr/db';

// The marketplace registries, read the same way by the server's Browse routes and the CLI's
// `market browse` and `market add`. One place chooses a registry's source and reads its list, so the
// two cannot drift apart.

export interface MarketplaceRegistriesDeps {
  internalDb: Kysely<InternalSchema>;
  /** MARKETPLACE_LOCAL_REGISTRY_ROOT: a local registry must sit inside it when it is set. */
  localRoot: string;
  /** The download cap, read on each use so a changed setting needs no restart. */
  maxPayloadBytes: () => Promise<number>;
  fetchImpl?: typeof fetch;
}

/** One bundle in one registry, with whether this CE can run it when the list knows. */
export interface AvailableListing extends RegistryListing {
  registry: RegistryRecord;
  /** Set only when the listing carries the bundle's CE range. */
  compatible?: boolean;
}

export function createMarketplaceRegistries(deps: MarketplaceRegistriesDeps) {
  const store = createRegistryStore(deps.internalDb);

  async function sourceFor(reg: RegistryRecord): Promise<RegistrySource> {
    return reg.kind === 'http'
      ? new HttpRegistrySource(reg.location, deps.fetchImpl ?? fetch, undefined, await deps.maxPayloadBytes())
      : new LocalRegistrySource(reg.location, deps.localRoot);
  }

  async function enabled(): Promise<RegistryRecord[]> {
    return (await store.list()).filter((r) => r.enabled);
  }

  /** Every enabled registry's bundles. A registry that cannot be read is skipped, and the first such
   *  failure is returned with the registry's name in front, so a reader can tell which one broke. */
  async function listAvailable(ceVersion: string): Promise<{ registries: RegistryRecord[]; listings: AvailableListing[]; firstError?: string }> {
    const registries = await enabled();
    const listings: AvailableListing[] = [];
    let firstError: string | undefined;
    for (const reg of registries) {
      try {
        for (const l of await (await sourceFor(reg)).list()) {
          listings.push({ ...l, registry: reg, ...(l.ceVersion ? { compatible: isCompatible(l.ceVersion, ceVersion) } : {}) });
        }
      } catch (e) {
        firstError = firstError ?? `${reg.name}: ${e instanceof Error ? e.message : 'registry unreachable'}`;
      }
    }
    return { registries, listings, ...(firstError ? { firstError } : {}) };
  }

  /** The bundle a person names by id, optional version and optional registry name. Refuses with a
   *  plain reason when none or more than one registry has it, or when this CE cannot run it. */
  async function findBundle(
    spec: { id: string; version?: string; registryName?: string },
    ceVersion: string,
  ): Promise<{ bundle: Bundle; listing: AvailableListing }> {
    const { listings, firstError } = await listAvailable(ceVersion);
    const wanted = spec.registryName?.toLowerCase();
    const matches = listings.filter((l) => {
      if (l.id !== spec.id) return false;
      if (wanted && l.registry.name.toLowerCase() !== wanted) return false;
      if (!spec.version) return true;
      return l.version === spec.version || (l.versions ?? []).some((v) => v.version === spec.version);
    });
    const name = spec.version ? `${spec.id}@${spec.version}` : spec.id;
    if (matches.length === 0) {
      const where = spec.registryName ? ` in registry "${spec.registryName}"` : ' in any enabled registry';
      throw new Error(`${name} was not found${where}${firstError ? ` (one registry could not be read: ${firstError})` : ''}`);
    }
    if (matches.length > 1) {
      const names = matches.map((m) => `"${m.registry.name}" (${m.version})`).join(', ');
      throw new Error(`${name} is in more than one registry: ${names}. Choose one with --registry <name>.`);
    }
    const listing = matches[0];
    if (listing.compatible === false) {
      throw new Error(`${listing.id} ${listing.version} needs CE ${listing.ceVersion}; this CE is ${ceVersion}`);
    }
    const ref = spec.version && spec.version !== listing.version
      ? (listing.versions ?? []).find((v) => v.version === spec.version)!.ref
      : listing.ref;
    const bundle = await (await sourceFor(listing.registry)).getBundle(ref);
    return { bundle, listing };
  }

  return { store, sourceFor, enabled, listAvailable, findBundle };
}

export type MarketplaceRegistries = ReturnType<typeof createMarketplaceRegistries>;
