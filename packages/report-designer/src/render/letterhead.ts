import type { DesignElement } from '../schema';

/**
 * THE letterhead band, defined once. Every seeded design used to carry these five elements as a
 * byte-for-byte copy (`simple-design.ts` and both literal designs); the lab moved office and
 * someone edited every design, or missed one. A `letterhead` element expands to this block at
 * render time, so the geometry has exactly one home.
 *
 * Offsets are px@96 from the element's own origin, copied VERBATIM from the block they replace
 * (origin was (48, 28) in the seeds): logo (0,0) 54x54; name (64,2); address (64,20);
 * contact (64,43); closing rule at y 64, as wide as the element. `letterhead.test.ts` holds the
 * old block verbatim and proves the expansion renders byte-identical to it.
 */
export const LETTERHEAD = {
  logo: { x: 0, y: 0, w: 54, h: 54 },
  name: { x: 64, y: 2, w: 430, h: 18, fontSize: 13, color: '#0f172a' },
  address: { x: 64, y: 20, w: 430, h: 22, fontSize: 7.5, color: '#64748b' },
  contact: { x: 64, y: 43, w: 430, h: 13, fontSize: 7.5, color: '#64748b' },
  rule: { y: 64, strokeColor: '#cbd5e1', strokeWidth: 0.75 },
} as const;

/** The band's total height in px@96 (rule offset; the rule itself has no height). */
export const LETTERHEAD_H = LETTERHEAD.rule.y + 2;

/** The five elements a `letterhead` at `el.rect` expands to — synthetic, never persisted. Ids are
 *  derived from the element's own id so flow references to the letterhead stay meaningless (it is
 *  one block) while the children stay unique within the render. */
export function letterheadElements(el: DesignElement): DesignElement[] {
  const { x, y, w } = el.rect;
  const L = LETTERHEAD;
  return [
    { id: `${el.id}:logo`, kind: 'image', name: 'Lab logo', rect: { x: x + L.logo.x, y: y + L.logo.y, w: L.logo.w, h: L.logo.h }, src: '{{lab.logo}}' },
    { id: `${el.id}:name`, kind: 'text', name: 'Lab name', rect: { x: x + L.name.x, y: y + L.name.y, w: L.name.w, h: L.name.h }, text: '{{lab.name}}', style: { fontSize: L.name.fontSize, bold: true, color: L.name.color } },
    { id: `${el.id}:address`, kind: 'text', name: 'Lab address', rect: { x: x + L.address.x, y: y + L.address.y, w: L.address.w, h: L.address.h }, text: '{{lab.address}}', style: { fontSize: L.address.fontSize, color: L.address.color } },
    { id: `${el.id}:contact`, kind: 'text', name: 'Lab contact', rect: { x: x + L.contact.x, y: y + L.contact.y, w: L.contact.w, h: L.contact.h }, text: '{{lab.contact}}', style: { fontSize: L.contact.fontSize, color: L.contact.color } },
    { id: `${el.id}:rule`, kind: 'line', name: 'rule', rect: { x, y: y + L.rule.y, w, h: 0 }, style: { strokeColor: L.rule.strokeColor, strokeWidth: L.rule.strokeWidth } },
  ];
}
