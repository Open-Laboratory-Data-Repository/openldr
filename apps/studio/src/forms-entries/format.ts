/** An entry's date and time in the reader's language, such as "22 Nov 2026, 14:20". The raw text
 *  when it is not a date. */
export function formatEnteredAt(iso: string, language: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  try {
    return d.toLocaleString(language, { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return d.toLocaleString();
  }
}

/** An entry's date and time apart, in the reader's language, with the same styles as
 *  formatEnteredAt: "22 Nov 2026" and "14:20". The raw text as the date when it is not a date. */
export function enteredAtParts(iso: string, language: string): { date: string; time: string } {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: iso, time: '' };
  try {
    return { date: d.toLocaleDateString(language, { dateStyle: 'medium' }), time: d.toLocaleTimeString(language, { timeStyle: 'short' }) };
  } catch {
    return { date: d.toLocaleDateString(), time: d.toLocaleTimeString() };
  }
}
