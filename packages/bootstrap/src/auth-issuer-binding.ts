import type { Kysely } from 'kysely';
import type { InternalSchema } from '@openldr/db';

/** Subjects and role assignments are meaningful only within the original issuer. */
export async function bindAuthIssuer(db: Kysely<InternalSchema>, issuer: string): Promise<void> {
  // The singleton constraint serializes competing first starts. Never update the winner.
  await db.insertInto('auth_issuer_binding').values({ id: 1, issuer })
    .onConflict(conflict => conflict.column('id').doNothing()).execute();
  const binding = await db.selectFrom('auth_issuer_binding').select('issuer')
    .where('id', '=', 1).executeTakeFirstOrThrow();
  if (binding.issuer !== issuer) {
    throw new Error(
      `Authentication issuer ${issuer} differs from the issuer bound to this database (${binding.issuer}). `
      + 'Restore the original OIDC_ISSUER_URL. If the same provider only moved address and user IDs are unchanged, '
      + 'run `openldr auth rebind-issuer --force`. A different provider needs an explicit identity mapping.',
    );
  }
}

export async function readAuthIssuerBinding(db: Kysely<InternalSchema>): Promise<string | null> {
  const row = await db.selectFrom('auth_issuer_binding').select('issuer').where('id', '=', 1).executeTakeFirst();
  return row?.issuer ?? null;
}

/** Operator escape for a provider that moved address. It does not map user IDs between providers. */
export async function rebindAuthIssuer(db: Kysely<InternalSchema>, issuer: string): Promise<{ previous: string | null }> {
  return db.transaction().execute(async (trx) => {
    const previous = await readAuthIssuerBinding(trx);
    await trx.insertInto('auth_issuer_binding').values({ id: 1, issuer })
      .onConflict(conflict => conflict.column('id').doUpdateSet({ issuer })).execute();
    return { previous };
  });
}
