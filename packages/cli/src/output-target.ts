import { lstat } from 'node:fs/promises';

/**
 * The sentence for a file a command is asked to write, or null when it may go ahead. Used by a
 * command that writes the file itself and by the client that saves a download, so both say the
 * same thing.
 *
 * A link is always refused: a write must never follow it to some other file. A folder is always
 * refused. A file that exists is refused unless `overwrite` is set, and the sentence names `flag`.
 */
export async function outputTargetRefusal(path: string, overwrite: boolean, flag: string): Promise<string | null> {
  let st;
  try {
    st = await lstat(path);
  } catch {
    // Not there (or a part of the path is not a folder): the write itself says what is wrong.
    return null;
  }
  if (st.isSymbolicLink()) return `${path} is a link. Name the file itself.`;
  if (st.isDirectory()) return `${path} is a folder. Name a file.`;
  if (!overwrite) return `${path} already exists. Run again with ${flag} to write over it.`;
  return null;
}
