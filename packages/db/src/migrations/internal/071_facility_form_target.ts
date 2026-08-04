import type { Kysely } from 'kysely';

// Facility registry slice 2: repoint an EXISTING install's seeded Facility form at the new
// Facilities page.
//
// Seeded forms are create-if-absent, deduped by NAME (`upsertPublishedForms`) and their schema is
// NEVER re-snapshotted, so editing the sample reaches fresh installs only. Without this migration an
// install that already carries the old draft would show an empty Facilities page forever.
//
// ⚠ It only touches a form that still looks UNTOUCHED — same id, still targeting ['forms'], and
// with no fields of its own. An operator who has already edited the form keeps it exactly as-is and
// sees the page's "no published facilities form" empty state instead. Silently rewriting their work
// would be worse than an empty page.
const SEEDED_ID = 'form-sample-facility';

export async function up(db: Kysely<any>): Promise<void> {
  const row = await db
    .selectFrom('form_definitions')
    .select(['id', 'target_pages', 'schema'])
    .where('id', '=', SEEDED_ID)
    .executeTakeFirst();
  if (!row) return; // never seeded here — nothing to repoint

  const targets = typeof row.target_pages === 'string' ? JSON.parse(row.target_pages) : row.target_pages;
  if (!Array.isArray(targets) || targets.length !== 1 || targets[0] !== 'forms') return; // already moved or customised

  const schema = typeof row.schema === 'string' ? JSON.parse(row.schema) : row.schema;
  const fields = (schema as { fields?: unknown[] })?.fields ?? [];
  // The shipped seed's fields all carry ids beginning `fld-fac-`; anything else means the operator
  // authored their own and must not be touched.
  const untouched = Array.isArray(fields) && fields.every((f) => String((f as { id?: string }).id ?? '').startsWith('fld-fac-'));
  if (!untouched) return;

  await db
    .updateTable('form_definitions')
    .set({ target_pages: JSON.stringify(['facilities']), status: 'published' } as never)
    .where('id', '=', SEEDED_ID)
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db
    .updateTable('form_definitions')
    .set({ target_pages: JSON.stringify(['forms']) } as never)
    .where('id', '=', SEEDED_ID)
    .execute();
}
