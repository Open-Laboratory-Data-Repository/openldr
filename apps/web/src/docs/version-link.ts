/**
 * Fills the `{{version}}` placeholder in a docs link with the running version, so a link such as
 * `.../tree/v{{version}}/examples` opens the lab's own release tag. The markdown renderer
 * percent-encodes the braces before a link renderer sees the href, so both spellings are replaced.
 * Only the exact `{{version}}` token is touched; other `{{...}}` tokens stay as written.
 */
export function withDocsVersion(href: string, version: string): string {
  return href.replace(/\{\{version\}\}|%7B%7Bversion%7D%7D/gi, version);
}
