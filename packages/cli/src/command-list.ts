import type { Command } from 'commander';
import { COMMAND_META, type CommandKind } from './command-meta';

// The list `openldr commands` prints: every command with how it runs. It reads only the command
// tree and COMMAND_META, so it needs no server and no database settings.

/** The command's words below the root, joined by one space: 'user key create'. */
export function commandPath(cmd: Command): string {
  const words: string[] = [];
  for (let c: Command | null = cmd; c?.parent; c = c.parent) words.unshift(c.name());
  return words.join(' ');
}

/** Every command that runs something: the leaves of the tree, not the groups. */
export function leafCommands(program: Command): Command[] {
  const out: Command[] = [];
  const walk = (c: Command): void => {
    for (const sub of c.commands) {
      if (sub.commands.length === 0) out.push(sub);
      else walk(sub);
    }
  };
  walk(program);
  return out;
}

export interface CommandEntry {
  path: string; description: string;
  arguments: { name: string; required: boolean; variadic: boolean }[];
  options: { flags: string; description: string }[];
  kind: CommandKind; capability: string | null;
  /** Keys needed besides capability; empty for most rows. */
  alsoRequires: string[];
  destructive: boolean;
}

/** One row per command, sorted by path. Throws for a command with no COMMAND_META entry. */
export function listCommands(program: Command): CommandEntry[] {
  return leafCommands(program)
    .map((cmd): CommandEntry => {
      const path = commandPath(cmd);
      const meta = COMMAND_META[path];
      if (!meta) throw new Error(`no COMMAND_META entry for '${path}'`);
      return {
        path,
        description: cmd.description(),
        arguments: cmd.registeredArguments.map((a) => ({ name: a.name(), required: a.required, variadic: a.variadic })),
        // A hidden option is plumbing (login --session-out, for the Docker wrapper), not for callers.
        options: cmd.options.filter((o) => !o.hidden).map((o) => ({ flags: o.flags, description: o.description })),
        kind: meta.kind,
        capability: meta.capability ?? null,
        alsoRequires: [...(meta.alsoRequires ?? [])],
        destructive: meta.destructive ?? false,
      };
    })
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** `openldr commands [--json]`. */
export function runCommandsList(program: Command, opts: { json: boolean }): number {
  const rows = listCommands(program);
  if (opts.json) {
    process.stdout.write(JSON.stringify(rows, null, 2) + '\n');
    return 0;
  }
  const width = Math.max(...rows.map((r) => r.path.length));
  const lines = rows.map((r) =>
    `${r.path.padEnd(width)}  ${r.kind.padEnd(8)}  ${(r.destructive ? 'destructive' : '').padEnd(11)}  ${r.description}`.trimEnd());
  process.stdout.write(lines.join('\n') + '\n');
  return 0;
}
