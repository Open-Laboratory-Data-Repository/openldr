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
