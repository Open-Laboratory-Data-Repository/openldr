/** One reader of SQL text. It walks the text once, left to right, and sorts each character into
 *  code, string, comment or quoted name, by the rules of one engine. Engines disagree on what is a
 *  string, a comment or a name, so the dialect is always given.
 *
 *  The reader follows the engine exactly. When the engine's reading turns on its version or its
 *  settings, or is not known for certain, the reader does not guess. It throws.
 *
 *  Three settings are not checked; the reader takes the server's default for them. On MySQL, a
 *  backslash inside a string makes the next character ordinary. In a plain Postgres string, a
 *  backslash is an ordinary character. On MySQL, `"..."` is read with the same backslash rule as
 *  `'...'`, which is the server's reading while its ANSI_QUOTES setting is off.
 *
 *  A NUL character anywhere in the text throws, in every dialect.
 *
 *  Placeholders: a string becomes `''`, a comment one space, `[name]` becomes `[]`, `"name"` becomes
 *  `""`, a backtick name two backticks, and a dollar-quoted string `''`. On MySQL the opener and the
 *  closer of a `/*! ... *\/` comment each become one space, and its inside stays code.
 *
 *  Every throw is a fixed sentence. It never holds any part of the SQL. */

export type SqlDialect = 'postgres' | 'mssql' | 'mysql';

const NEVER_CLOSED = 'the SQL has a string, comment or quoted name that is never closed';
const NESTED_RUNNABLE = 'the SQL opens a /*! comment inside another one';
const VERSIONED_COMMENT = 'the SQL has a /*! comment with a version number, or a /*M! comment, which a MySQL or MariaDB server may or may not run';
const LONE_CARRIAGE_RETURN = 'the SQL has a carriage return inside a line comment that is not followed by a line feed';
const MSSQL_COMMENT_CHAR = 'the SQL has a control character or a line separator inside a SQL Server line comment';
const NUL_CHARACTER = 'the SQL holds a NUL character';
const STRING_AFTER_ESCAPE_STRING = "the SQL has a string directly after an E'...' escape string, which Postgres may read as part of it";
const DIGIT_BEFORE_STRING = "the SQL has a digit directly before an E'...' string or a dollar-quoted string, which Postgres may read as a number and then a string";
const EMPTY_TOKEN_MATCH = 'the token pattern must not match empty text';

type State = 'code' | 'quoted' | 'line' | 'block' | 'dollar';

interface Scan {
  /** The text with strings, comments and quoted names replaced by placeholders. */
  text: string;
  /** 1 for each character of the input that is code, 0 for every other character. */
  code: Uint8Array;
}

function isAsciiLetter(c: string): boolean {
  const n = c.charCodeAt(0);
  return (n >= 65 && n <= 90) || (n >= 97 && n <= 122);
}

function isDigit(c: string | undefined): boolean {
  if (c === undefined || c === '') return false;
  const n = c.charCodeAt(0);
  return n >= 48 && n <= 57;
}

function isAtOrAbove0x80(c: string): boolean {
  return c.charCodeAt(0) >= 0x80;
}

/** A character that can continue a Postgres name: a letter, a digit, `_`, `$`, or any character at
 *  or above U+0080. */
function isPostgresNameChar(c: string | undefined): boolean {
  if (c === undefined || c === '') return false;
  return isAsciiLetter(c) || isDigit(c) || c === '_' || c === '$' || isAtOrAbove0x80(c);
}

/** A character that can start a dollar tag: a letter, `_`, or any character at or above U+0080. */
function isTagStart(c: string | undefined): boolean {
  if (c === undefined || c === '') return false;
  return isAsciiLetter(c) || c === '_' || isAtOrAbove0x80(c);
}

/** The `$tag$` that opens a dollar-quoted string at `i`, or '' when there is none. */
function dollarTagAt(sql: string, i: number): string {
  let j = i + 1;
  if (isTagStart(sql[j])) {
    j++;
    while (j < sql.length && (isTagStart(sql[j]) || isDigit(sql[j]))) j++;
  }
  return sql[j] === '$' ? sql.slice(i, j + 1) : '';
}

/** A Postgres `E'...'` string: the `'` follows `E` or `e`, and that letter is not part of a
 *  longer name. */
function isEStringQuote(sql: string, i: number): boolean {
  const prev = sql[i - 1];
  return (prev === 'E' || prev === 'e') && !isPostgresNameChar(sql[i - 2]);
}

/** The index of the first character at or after `j` that is not Postgres white space and not part
 *  of a `--` comment. A `--` comment ends at a line feed or a carriage return. */
function skipSpaceAndLineComments(sql: string, j: number): number {
  while (j < sql.length) {
    const c = sql[j];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === '\v') j++;
    else if (c === '-' && sql[j + 1] === '-') {
      j += 2;
      while (j < sql.length && sql[j] !== '\n' && sql[j] !== '\r') j++;
    } else break;
  }
  return j;
}

/** Whether `--` at `i` starts a line comment. On MySQL the next character must be missing, at or
 *  below U+0020, or U+007F. SQL Server and Postgres need nothing after it. */
function opensLineComment(sql: string, i: number, dialect: SqlDialect): boolean {
  if (dialect !== 'mysql') return true;
  const after = sql[i + 2];
  if (after === undefined) return true;
  const n = after.charCodeAt(0);
  return n <= 0x20 || n === 0x7f;
}

/** Whether `c` may sit inside a SQL Server `--` comment: a tab, or a code point at or above 0x20
 *  that is not in 0x7F to 0x9F and is not U+2028 or U+2029. SQL Server's reading of any other
 *  character there is not known for certain. Line feed and carriage return are handled beside the
 *  other line rules. */
function isAllowedInMssqlLineComment(c: string): boolean {
  const n = c.charCodeAt(0);
  if (n === 0x09) return true;
  if (n < 0x20) return false;
  if (n >= 0x7f && n <= 0x9f) return false;
  return n !== 0x2028 && n !== 0x2029;
}

/** The length of a MySQL `/*!` opener at `i`, or 0 when `/*` at `i` opens an ordinary comment.
 *  Throws on `/*!` directly followed by a digit or by `!`, and on `/*M!` or `/*m!`: whether the
 *  server runs their inside turns on its version or on whether it is MariaDB. */
function runnableOpenerLength(sql: string, i: number): number {
  const third = sql[i + 2];
  if (third === '!') {
    if (isDigit(sql[i + 3]) || sql[i + 3] === '!') throw new Error(VERSIONED_COMMENT);
    return 3;
  }
  if ((third === 'M' || third === 'm') && sql[i + 3] === '!') throw new Error(VERSIONED_COMMENT);
  return 0;
}

function scan(sql: string, dialect: SqlDialect): Scan {
  if (sql.indexOf('\u0000') !== -1) throw new Error(NUL_CHARACTER);
  const code = new Uint8Array(sql.length);
  let out = '';
  let state: State = 'code';
  let close = '';
  /** In a quoted run: a backslash makes the next character ordinary. */
  let escapes = false;
  let depth = 0;
  let tag = '';
  /** Inside a MySQL `/*! ... *\/`, whose inside is code. */
  let runnable = false;
  let i = 0;

  while (i < sql.length) {
    const c = sql[i];
    const d = sql[i + 1];

    if (state === 'code') {
      if (c === "'") {
        // Postgres reads `1E'a'` as the number 1 and then `E'a'`, where this reader would see the
        // name `1E` and a plain string.
        if (dialect === 'postgres' && (sql[i - 1] === 'E' || sql[i - 1] === 'e') && isDigit(sql[i - 2])) {
          throw new Error(DIGIT_BEFORE_STRING);
        }
        state = 'quoted'; close = "'";
        escapes = dialect === 'mysql' || (dialect === 'postgres' && isEStringQuote(sql, i));
        out += "''"; i++;
      } else if (c === '"') {
        state = 'quoted'; close = '"'; escapes = dialect === 'mysql';
        out += '""'; i++;
      } else if (c === '`' && dialect === 'mysql') {
        state = 'quoted'; close = '`'; escapes = false;
        out += '``'; i++;
      } else if (c === '[' && dialect === 'mssql') {
        state = 'quoted'; close = ']'; escapes = false;
        out += '[]'; i++;
      } else if (c === '-' && d === '-' && opensLineComment(sql, i, dialect)) {
        state = 'line'; out += ' '; i += 2;
      } else if (c === '#' && dialect === 'mysql') {
        state = 'line'; out += ' '; i++;
      } else if (runnable && c === '*' && d === '/') {
        runnable = false; out += ' '; i += 2;
      } else if (c === '/' && d === '*') {
        const opener = dialect === 'mysql' ? runnableOpenerLength(sql, i) : 0;
        if (opener > 0) {
          if (runnable) throw new Error(NESTED_RUNNABLE);
          runnable = true; out += ' '; i += opener;
        } else {
          state = 'block'; depth = 1; out += ' '; i += 2;
        }
      } else if (c === '$' && dialect === 'postgres' && isDigit(sql[i - 1]) && dollarTagAt(sql, i) !== '') {
        // Postgres reads `1$$a$$` as the number 1 and then a dollar-quoted string.
        throw new Error(DIGIT_BEFORE_STRING);
      } else if (c === '$' && dialect === 'postgres' && !isPostgresNameChar(sql[i - 1]) && dollarTagAt(sql, i) !== '') {
        tag = dollarTagAt(sql, i);
        state = 'dollar'; out += "''"; i += tag.length;
      } else {
        out += c; code[i] = 1; i++;
      }
    } else if (state === 'quoted') {
      if (c === close) {
        if (d === close) { i += 2; } else {
          // Postgres joins two strings that only white space with a line break, and `--` comments,
          // keep apart. After an `E'...'` string it reads the second one with backslash escapes
          // too. This reader would read it as plain, so a quote there throws, line break or not.
          if (dialect === 'postgres' && escapes && sql[skipSpaceAndLineComments(sql, i + 1)] === "'") {
            throw new Error(STRING_AFTER_ESCAPE_STRING);
          }
          state = 'code'; i++;
        }
      } else if (c === '\\' && escapes) {
        i += 2;
      } else {
        i++;
      }
    } else if (state === 'line') {
      // The line break that ends the comment stays in the text as code. Postgres ends a line
      // comment at `\n` or `\r`. MySQL and SQL Server end it at `\n` only; a `\r` just before that
      // `\n`, or at the very end of the text, is part of the comment, and any other `\r` throws.
      // On SQL Server any other character that is not plain throws too.
      if (c === '\n' || (c === '\r' && dialect === 'postgres')) state = 'code';
      else if (c === '\r') {
        if (d !== '\n' && d !== undefined) throw new Error(LONE_CARRIAGE_RETURN);
        i++;
      } else if (dialect === 'mssql' && !isAllowedInMssqlLineComment(c)) throw new Error(MSSQL_COMMENT_CHAR);
      else i++;
    } else if (state === 'block') {
      if (c === '*' && d === '/') {
        depth--; i += 2;
        if (depth === 0) state = 'code';
      } else if (c === '/' && d === '*' && dialect !== 'mysql') {
        // SQL Server and Postgres nest block comments. MySQL ends one at the first closer.
        depth++; i += 2;
      } else {
        i++;
      }
    } else {
      if (c === '$' && sql.startsWith(tag, i)) { state = 'code'; i += tag.length; }
      else i++;
    }
  }

  if ((state !== 'code' && state !== 'line') || runnable) throw new Error(NEVER_CLOSED);
  return { text: out, code };
}

/** Returns `sql` with every string, comment and quoted name replaced by its placeholder, read by
 *  the rules of `dialect`. Throws a fixed sentence, holding none of the SQL, in these cases:
 *  - the text holds a NUL character anywhere (any dialect);
 *  - a string, block comment, quoted name or dollar-quoted string is never closed (any dialect);
 *  - a carriage return inside a line comment is followed by a character other than a line feed
 *    (mysql, mssql); a carriage return that ends the text does not throw;
 *  - a `--` comment holds a character other than a tab, a line feed, an allowed carriage return,
 *    or a code point at or above 0x20 that is not in 0x7F to 0x9F and is not U+2028 or U+2029
 *    (mssql);
 *  - a `/*!` comment is directly followed by a digit or by `!`, or a `/*M!` or `/*m!` comment
 *    opens (mysql);
 *  - a `/*!` comment is never closed, or opens inside another one (mysql);
 *  - a `'` follows an `E'...'` string with only white space and `--` comments between them,
 *    or none (postgres);
 *  - a digit sits directly before `E'` or before the opener of a dollar-quoted string
 *    (postgres). */
export function blankSql(sql: string, dialect: SqlDialect): string {
  return scan(sql, dialect).text;
}

/** Returns true when every match of `token` in `template` lies wholly in code, read by the rules of
 *  `dialect`, and true when there is no match. Returns false when any character of any match is in
 *  a string, a comment or a quoted name. It matches on a copy of `token` with the `g` flag and
 *  without the `y` flag, so the caller's pattern and its `lastIndex` are never changed. Throws in
 *  these cases:
 *  - every case in which `blankSql` throws, with the same sentence;
 *  - `token` matches empty text anywhere in `template`, which is a mistake in the caller. */
export function tokensInPlainSql(template: string, token: RegExp, dialect: SqlDialect): boolean {
  const { code } = scan(template, dialect);
  const flags = `${token.flags.replace(/[gy]/g, '')}g`;
  let allCode = true;
  for (const match of template.matchAll(new RegExp(token.source, flags))) {
    if (match[0].length === 0) throw new Error(EMPTY_TOKEN_MATCH);
    const start = match.index ?? 0;
    const end = start + match[0].length;
    for (let k = start; k < end && allCode; k++) if (code[k] !== 1) allCode = false;
  }
  return allCode;
}
