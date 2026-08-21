import ts from 'typescript';

/** One bindable path on a FHIR resource. */
export interface FhirPathRow {
  /** Resource-prefixed dotted path, for example `Location.address.district`. */
  path: string;
  /**
   * TypeScript type name of the leaf: `string`, `number`, `boolean`, `code` for a union of
   * string literals, or a FHIR datatype name such as `CodeableConcept`.
   */
  leafType: string;
  /**
   * True when ANY segment along the path is an array, not only the leaf.
   * `Location.identifier.value` is true because `Location.identifier` is `Identifier[]`.
   * The cardinality lint rule depends on this exact meaning.
   */
  isArray: boolean;
  /** First line of the member's JSDoc, which in `@types/fhir` is the element's short label. */
  label: string;
}

export interface BuildTableOptions {
  /** Resource interface names to walk from. */
  roots: readonly string[];
  /** Segments after the root. `Location.address.district` is depth 2. Defaults to 3. */
  maxDepth?: number;
  /** Type names to emit but never recurse into. */
  stopTypes?: readonly string[];
}

interface Leaf {
  type: string;
  isArray: boolean;
  isEnum: boolean;
}

/**
 * Reduce a member's type node to its leaf.
 *
 * `@types/fhir` writes every optional member as `X | undefined`, arrays as `X[]`, and coded
 * elements as a parenthesised union of string literals. Returns null for anything else, which
 * is skipped rather than guessed at.
 */
function unwrap(node: ts.TypeNode): Leaf | null {
  if (ts.isUnionTypeNode(node)) {
    const parts = node.types.filter((p) => p.kind !== ts.SyntaxKind.UndefinedKeyword);
    if (parts.length === 1) return unwrap(parts[0]!);
    if (parts.length > 1 && parts.every((p) => ts.isLiteralTypeNode(p))) {
      return { type: 'code', isArray: false, isEnum: true };
    }
    return null;
  }
  if (ts.isParenthesizedTypeNode(node)) return unwrap(node.type);
  if (ts.isArrayTypeNode(node)) {
    const inner = unwrap(node.elementType);
    return inner ? { ...inner, isArray: true } : null;
  }
  if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
    return { type: node.typeName.text, isArray: false, isEnum: false };
  }
  switch (node.kind) {
    case ts.SyntaxKind.StringKeyword: return { type: 'string', isArray: false, isEnum: false };
    case ts.SyntaxKind.NumberKeyword: return { type: 'number', isArray: false, isEnum: false };
    case ts.SyntaxKind.BooleanKeyword: return { type: 'boolean', isArray: false, isEnum: false };
    default: return null;
  }
}

/** First line of a member's JSDoc. Empty string when it has none. */
function firstDocLine(node: ts.Node): string {
  const docs = (node as unknown as { jsDoc?: ts.JSDoc[] }).jsDoc;
  const comment = docs?.[0]?.comment;
  if (typeof comment !== 'string') return '';
  for (const line of comment.split('\n')) {
    const trimmed = line.trim();
    if (trimmed) return trimmed;
  }
  return '';
}

export function buildPathTable(sourceText: string, options: BuildTableOptions): FhirPathRow[] {
  const maxDepth = options.maxDepth ?? 3;
  const stopTypes = new Set(options.stopTypes ?? []);

  // `setParentNodes: true` is what attaches the `jsDoc` array the label reader above needs.
  const source = ts.createSourceFile('r4.d.ts', sourceText, ts.ScriptTarget.Latest, true);

  const interfaces = new Map<string, ts.InterfaceDeclaration>();
  source.forEachChild((node) => {
    if (ts.isInterfaceDeclaration(node)) interfaces.set(node.name.text, node);
  });

  /** Every property signature of an interface, inherited members first. */
  function membersOf(name: string, seen = new Set<string>()): ts.PropertySignature[] {
    if (seen.has(name)) return [];
    seen.add(name);
    const iface = interfaces.get(name);
    if (!iface) return [];
    const inherited: ts.PropertySignature[] = [];
    for (const clause of iface.heritageClauses ?? []) {
      for (const type of clause.types) {
        if (ts.isIdentifier(type.expression)) inherited.push(...membersOf(type.expression.text, seen));
      }
    }
    return [...inherited, ...iface.members.filter(ts.isPropertySignature)];
  }

  const rows: FhirPathRow[] = [];

  function walk(typeName: string, prefix: string, depth: number, arraySeen: boolean, branch: Set<string>): void {
    if (depth > maxDepth) return;
    for (const member of membersOf(typeName)) {
      if (!ts.isIdentifier(member.name) || !member.type) continue;
      const key = member.name.text;
      // `_use`, `_name` and friends carry primitive extensions, never a bindable value.
      if (key.startsWith('_')) continue;
      if (key === 'resourceType') continue;

      const leaf = unwrap(member.type);
      if (!leaf) continue;

      const path = `${prefix}.${key}`;
      const isArray = arraySeen || leaf.isArray;
      rows.push({ path, leafType: leaf.type, isArray, label: firstDocLine(member) });

      if (leaf.isEnum) continue;
      if (stopTypes.has(leaf.type)) continue;
      if (!interfaces.has(leaf.type)) continue;   // a primitive, nothing to recurse into
      if (branch.has(leaf.type)) continue;        // self-referential datatype, stop the cycle
      walk(leaf.type, path, depth + 1, isArray, new Set([...branch, leaf.type]));
    }
  }

  for (const root of options.roots) {
    if (!interfaces.has(root)) throw new Error(`buildPathTable: unknown root interface "${root}"`);
    walk(root, root, 1, false, new Set([root]));
  }

  rows.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return rows;
}
