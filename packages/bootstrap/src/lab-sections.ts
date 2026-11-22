import type { Kysely } from 'kysely';
import type { InternalSchema, TerminologyAdminStore } from '@openldr/db';
import { LAB_SECTION_SYSTEM } from './test-catalog';

// The lab's own section list (lab module design 2026-11-22, 5.1). Each section is a concept of
// urn:openldr:cs:lab-section, which migration 137 seeds empty. The value set
// urn:openldr:valueset:lab-section includes the whole system, and $expand reads concepts live, so an
// added section is offered at once with no cache refresh. The settings routes and `openldr lab
// sections` both call this module, so they refuse the same input in the same words.

/** A section code. Lowercase, so a code typed twice in different case cannot become two sections. */
export const LAB_SECTION_CODE = /^[a-z][a-z0-9-]{0,39}$/;
const NAME_MAX = 100;

export interface LabSection {
  code: string;
  name: string;
}

export class LabSectionError extends Error {
  constructor(message: string, public readonly kind: 'invalid' | 'not-found' | 'conflict') {
    super(message);
    this.name = 'LabSectionError';
  }
}

export interface LabSections {
  listSections(): Promise<LabSection[]>;
  addSection(code: string, name: string): Promise<LabSection>;
  removeSection(code: string): Promise<void>;
}

export interface LabSectionsDeps {
  db: Kysely<InternalSchema>;
  admin: TerminologyAdminStore;
}

export function createLabSections(deps: LabSectionsDeps): LabSections {
  const { db, admin } = deps;

  async function find(code: string): Promise<{ code: string } | undefined> {
    return db.selectFrom('terminology_concepts').select('code')
      .where('system', '=', LAB_SECTION_SYSTEM).where('code', '=', code).executeTakeFirst();
  }

  return {
    async listSections() {
      // Codes are unique within the system, so ordering by code gives a stable list (AGENTS.md section 7).
      const rows = await db.selectFrom('terminology_concepts').select(['code', 'display'])
        .where('system', '=', LAB_SECTION_SYSTEM).orderBy('code').execute();
      return rows.map((r) => ({ code: r.code, name: r.display ?? r.code }));
    },

    async addSection(code, name) {
      if (!LAB_SECTION_CODE.test(code)) {
        throw new LabSectionError(`section code "${code}" must start with a lowercase letter and have at most 40 lowercase letters, digits or dashes`, 'invalid');
      }
      const trimmed = name.trim();
      if (trimmed.length < 1 || trimmed.length > NAME_MAX) {
        throw new LabSectionError(`a section name must be 1 to ${NAME_MAX} characters`, 'invalid');
      }
      // terms.create is an upsert, so an existing code is refused here rather than renamed.
      if (await find(code)) throw new LabSectionError(`section ${code} already exists`, 'conflict');
      // The admin store's own write, as the Terminology page adds a concept to a local system. It
      // needs no value set refresh. The section system is local to each node, so the write sends
      // no sync change signal (isLocalOnlyTerminologySystem in @openldr/db).
      await admin.terms.create({ system: LAB_SECTION_SYSTEM, code, display: trimmed, status: 'ACTIVE' });
      return { code, name: trimmed };
    },

    async removeSection(code) {
      if (!(await find(code))) throw new LabSectionError(`no section ${code}`, 'not-found');
      const used = await db.selectFrom('test_catalog_lab_settings')
        .select((eb) => eb.fn.countAll<number>().as('n'))
        .where('section', '=', code).executeTakeFirst();
      const n = Number(used?.n ?? 0);
      if (n > 0) throw new LabSectionError(`section ${code} is used by ${n} tests`, 'conflict');
      await admin.terms.delete(LAB_SECTION_SYSTEM, code);
    },
  };
}
