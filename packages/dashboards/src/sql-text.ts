/** One reader of SQL text. It walks the text once, left to right, and sorts each character into
 *  code, string, comment or quoted name. It returns the text with the last three replaced by fixed
 *  placeholders, so a check that reads the result sees only the code.
 *
 *  Engines disagree on what is a string, a comment or a name, so the reader takes the dialect of the
 *  engine that will run the text. With no dialect it follows its own strict rules. Where engines
 *  differ, it keeps the text as code, so the check reads it.
 *
 *  Placeholders: a string becomes `''`, a comment one space, `[name]` becomes `[]`, `"name"` becomes
 *  `""`, a backtick name two backticks, and a dollar-quoted string `''`.
 *
 *  Every throw is a fixed sentence. It never holds any part of the SQL. */

export type SqlDialect = 'postgres' | 'mssql' | 'mysql';

const NEVER_CLOSED = 'the SQL has a string, comment or quoted name that is never closed';
const NESTED_COMMENT = 'the SQL opens a comment inside another comment';
const RUNNABLE_COMMENT = 'the SQL has a /*! or /*M! comment, which MySQL and MariaDB run as code';
const BACKSLASH_QUOTE = 'the SQL has a backslash before a quote inside a string, which MySQL can read two ways';

type State = 'code' | 'quoted' | 'line' | 'block' | 'dollar';

/** How a backslash reads inside a quoted run.
 *  plain: an ordinary character.
 *  escape: it makes the next character ordinary (a Postgres E'...' string).
 *  mysql: two in a row are one pair; one before the opening quote throws; any other is ordinary. */
type Backslash = 'plain' | 'escape' | 'mysql';

function isAsciiLetter(c: string): boolean {
  const n = c.charCodeAt(0);
  return (n >= 65 && n <= 90) || (n >= 97 && n <= 122);
}

function isDigit(c: string): boolean {
  const n = c.charCodeAt(0);
  return n >= 48 && n <= 57;
}

/** A character that can continue a Postgres name: a letter, a digit, `_`, `$`, or any non-ASCII one. */
function isPostgresNameChar(c: string | undefined): boolean {
  if (c === undefined || c === '') return false;
  return isAsciiLetter(c) || isDigit(c) || c === '_' || c === '$' || c.charCodeAt(0) >= 0x80;
}

/** The `$tag$` that opens a dollar-quoted string at `i`, or '' when there is none. The tag is empty
 *  or ASCII letters, digits and `_`, not starting with a digit. */
function dollarTagAt(sql: string, i: number): string {
  let j = i + 1;
  if (j < sql.length && (isAsciiLetter(sql[j]) || sql[j] === '_')) {
    j++;
    while (j < sql.length && (isAsciiLetter(sql[j]) || isDigit(sql[j]) || sql[j] === '_')) j++;
  }
  return sql[j] === '$' ? sql.slice(i, j + 1) : '';
}

/** Whether `--` at `i` starts a line comment. MySQL needs a space, a tab, a line break or the end
 *  of the text after it; every other engine does not. */
function opensLineComment(sql: string, i: number, dialect: SqlDialect | undefined): boolean {
  if (dialect !== 'mysql') return true;
  const after = sql[i + 2];
  return after === undefined || after === ' ' || after === '\t' || after === '\n' || after === '\r';
}

export function blankSql(sql: string, dialect?: SqlDialect): string {
  let out = '';
  let state: State = 'code';
  let close = '';
  let backslash: Backslash = 'plain';
  let depth = 0;
  let tag = '';
  let i = 0;

  while (i < sql.length) {
    const c = sql[i];
    const d = sql[i + 1];

    if (state === 'code') {
      if (c === "'") {
        const prev = sql[i - 1];
        const eString = dialect === 'postgres' && (prev === 'E' || prev === 'e') && !isPostgresNameChar(sql[i - 2]);
        state = 'quoted'; close = "'";
        backslash = dialect === 'mysql' ? 'mysql' : eString ? 'escape' : 'plain';
        out += "''"; i++;
      } else if (c === '"') {
        state = 'quoted'; close = '"'; backslash = dialect === 'mysql' ? 'mysql' : 'plain';
        out += '""'; i++;
      } else if (c === '`' && (dialect === 'mysql' || dialect === undefined)) {
        state = 'quoted'; close = '`'; backslash = 'plain';
        out += '``'; i++;
      } else if (c === '[' && dialect === 'mssql') {
        state = 'quoted'; close = ']'; backslash = 'plain';
        out += '[]'; i++;
      } else if (c === '-' && d === '-' && opensLineComment(sql, i, dialect)) {
        state = 'line'; out += ' '; i += 2;
      } else if (c === '#' && dialect === 'mysql') {
        state = 'line'; out += ' '; i++;
      } else if (c === '/' && d === '*') {
        const runnable = sql[i + 2] === '!' || (sql[i + 2] === 'M' && sql[i + 3] === '!');
        if (runnable && dialect !== 'mssql' && dialect !== 'postgres') throw new Error(RUNNABLE_COMMENT);
        state = 'block'; depth = 1; out += ' '; i += 2;
      } else if (c === '$' && dialect === 'postgres' && !isPostgresNameChar(sql[i - 1]) && dollarTagAt(sql, i) !== '') {
        tag = dollarTagAt(sql, i);
        state = 'dollar'; out += "''"; i += tag.length;
      } else {
        out += c; i++;
      }
    } else if (state === 'quoted') {
      if (c === close) {
        if (d === close) { i += 2; } else { state = 'code'; i++; }
      } else if (c === '\\' && backslash === 'escape') {
        i += 2;
      } else if (c === '\\' && backslash === 'mysql') {
        if (d === '\\') i += 2;
        else if (d === close) throw new Error(BACKSLASH_QUOTE);
        else i++;
      } else {
        i++;
      }
    } else if (state === 'line') {
      // The line break ends the comment and stays in the text as code.
      if (c === '\n' || c === '\r') state = 'code';
      else i++;
    } else if (state === 'block') {
      if (c === '*' && d === '/') {
        depth--; i += 2;
        if (depth === 0) state = 'code';
      } else if (c === '/' && d === '*') {
        if (dialect === 'mssql' || dialect === 'postgres') { depth++; i += 2; }
        else if (dialect === 'mysql') i++;
        else throw new Error(NESTED_COMMENT);
      } else {
        i++;
      }
    } else {
      if (c === '$' && sql.startsWith(tag, i)) { state = 'code'; i += tag.length; }
      else i++;
    }
  }

  if (state !== 'code' && state !== 'line') throw new Error(NEVER_CLOSED);
  return out;
}

/** True when every match of `token` in `template` sits in code, not in a string, a comment or a
 *  quoted name. It counts the matches in the template and in the blanked template. A throw from
 *  `blankSql` goes through to the caller. */
export function tokensInPlainSql(template: string, token: RegExp, dialect?: SqlDialect): boolean {
  const blanked = blankSql(template, dialect);
  return countMatches(template, token) === countMatches(blanked, token);
}

/** Counts on a fresh copy of the pattern, so a global pattern's `lastIndex` never carries over. */
function countMatches(text: string, token: RegExp): number {
  const flags = token.flags.includes('g') ? token.flags : `${token.flags}g`;
  return Array.from(text.matchAll(new RegExp(token.source, flags))).length;
}
