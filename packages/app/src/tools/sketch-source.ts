import ts from '@typescript/typescript6';
import type {
  SketchPointAddress,
  SketchPosition,
  SourceRef,
} from '@code3d/core/tooling';
import {formatSourceNumber} from './source-expression';
import type {
  ResolveContext,
  ToolIntent,
  ToolIntentResolver,
  ToolResolution,
} from './tool-system';

export type SketchDraftEntry =
  | readonly ['point', number, SketchPosition]
  | readonly [
      'line',
      number,
      readonly [SketchPointAddress, SketchPointAddress],
    ];

export type SketchChange =
  | Readonly<{kind: 'append'; entries: readonly SketchDraftEntry[]}>
  | Readonly<{kind: 'move'; id: number; position: SketchPosition}>
  | Readonly<{kind: 'delete'; ids: readonly number[]}>;

export type SketchEditIntent = Readonly<{
  kind: 'sketch.edit';
  sourceRef: SourceRef;
  expectedText: string;
  layer: string;
  references: Readonly<Record<string, string>>;
  change: SketchChange;
}>;

type Entry = {
  id: number;
  kind: 'point' | 'line';
  node: ts.ArrayLiteralExpression;
  data: ts.ArrayLiteralExpression;
};
const prefix = 'const entries = ';

/** Analyze only the authored tuple structure; never evaluate coordinate code. */
export function analyzeSketchSource(source: string): {
  entries: ReadonlyMap<number, Entry>;
  movable: ReadonlySet<number>;
  array?: ts.ArrayLiteralExpression;
  reason?: string;
} {
  const file = ts.createSourceFile(
    'sketch.ts',
    `${prefix}${source}`,
    ts.ScriptTarget.Latest,
    true,
  );
  const statement = file.statements[0];
  const array =
    statement && ts.isVariableStatement(statement)
      ? statement.declarationList.declarations[0]?.initializer
      : undefined;
  const entries = new Map<number, Entry>();
  const movable = new Set<number>();
  const unsupported = () => ({
    entries,
    movable,
    reason: 'Visual editing requires explicit [kind, ID, data] tuples.',
  });
  if (!array || !ts.isArrayLiteralExpression(array)) return unsupported();
  for (const node of array.elements) {
    if (!ts.isArrayLiteralExpression(node) || node.elements.length !== 3)
      return unsupported();
    const [kind, idNode, data] = node.elements;
    if (
      !ts.isStringLiteral(kind) ||
      (kind.text !== 'point' && kind.text !== 'line') ||
      !ts.isNumericLiteral(idNode) ||
      !ts.isArrayLiteralExpression(data) ||
      data.elements.length !== 2
    )
      return unsupported();
    const id = Number(idNode.text);
    if (!Number.isSafeInteger(id) || id < 1 || entries.has(id))
      return unsupported();
    entries.set(id, {id, kind: kind.text, node, data});
    if (
      kind.text === 'point' &&
      data.elements.every(n => numeric(n) !== undefined)
    )
      movable.add(id);
  }
  return {entries, movable, array};
}

function numeric(node: ts.Expression): number | undefined {
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (ts.isPrefixUnaryExpression(node) && ts.isNumericLiteral(node.operand)) {
    if (node.operator === ts.SyntaxKind.MinusToken)
      return -Number(node.operand.text);
    if (node.operator === ts.SyntaxKind.PlusToken)
      return Number(node.operand.text);
  }
  return undefined;
}

export class SketchEditResolver implements ToolIntentResolver {
  readonly kind = 'sketch.edit' as const;

  resolve(intent: ToolIntent, context: ResolveContext): ToolResolution {
    if (intent.kind !== this.kind)
      return {status: 'unsupported', reason: 'Expected a sketch edit.'};
    const sourceRef = context.resolveSourceRef(intent.sourceRef);
    if (!sourceRef)
      return {
        status: 'conflict',
        reason: 'The sketch definition is no longer available.',
      };
    const source = context.readSource(sourceRef);
    if (source !== intent.expectedText)
      return {
        status: 'conflict',
        reason: 'The sketch source changed during this gesture.',
      };
    const parsed = analyzeSketchSource(source);
    if (!parsed.array) return {status: 'unsupported', reason: parsed.reason!};
    const changes: {start: number; end: number; text: string}[] = [];
    const replace = (node: ts.Node, text: string) =>
      changes.push({
        start: node.getStart() - prefix.length,
        end: node.end - prefix.length,
        text,
      });
    const {change} = intent;
    if (change.kind === 'move') {
      const entry = parsed.entries.get(change.id);
      if (!entry || !parsed.movable.has(change.id))
        return {
          status: 'unsupported',
          reason: 'Expression-driven points must be edited in code.',
        };
      entry.data.elements.forEach((node, i) =>
        replace(node, formatSourceNumber(change.position[i])),
      );
    } else if (change.kind === 'delete') {
      for (const id of change.ids) {
        const entry = parsed.entries.get(id);
        if (!entry)
          return {
            status: 'conflict',
            reason: `Sketch entity ${id} no longer exists.`,
          };
        const end = entry.node.end - prefix.length;
        // A remaining preceding comma is a valid trailing comma. Trivia attached
        // to surviving entries is not regenerated or discarded.
        const scanner = ts.createScanner(
          ts.ScriptTarget.Latest,
          true,
          ts.LanguageVariant.Standard,
          source.slice(end),
        );
        const comma = scanner.scan() === ts.SyntaxKind.CommaToken;
        changes.push({
          start: entry.node.pos - prefix.length,
          end: end + (comma ? scanner.getTextPos() : 0),
          text: '',
        });
      }
    } else {
      const ids = new Set(parsed.entries.keys());
      const point = (ref: SketchPointAddress): string => {
        if (ref.layer === intent.layer) return String(ref.id);
        const name = intent.references[ref.layer];
        if (!name)
          throw new Error(
            'This upstream point has no accessible sketch binding.',
          );
        return `${name}.point(${ref.id})`;
      };
      let text: string;
      try {
        text = change.entries
          .map(([kind, id, data]) => {
            if (ids.has(id))
              throw new Error(`Sketch entity ${id} already exists.`);
            ids.add(id);
            const content =
              kind === 'point' ? data.map(formatSourceNumber) : data.map(point);
            return `  ['${kind}', ${id}, [${content.join(', ')}]],`;
          })
          .join('\n');
      } catch (error) {
        return {status: 'conflict', reason: (error as Error).message};
      }
      const elements = parsed.array.elements;
      if (elements.length && !elements.hasTrailingComma) {
        const end = elements[elements.length - 1].end - prefix.length;
        changes.push({start: end, end, text: ','});
      }
      const end = parsed.array.end - prefix.length - 1;
      const closingIndent = source.slice(0, end).match(/[ \t]*$/)![0];
      const start = end - closingIndent.length;
      const separator = source[start - 1] === '\n' ? '' : '\n';
      changes.push({start, end, text: `${separator}${text}\n${closingIndent}`});
    }
    let text = source;
    for (const edit of changes.reverse().sort((a, b) => b.start - a.start))
      text = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
    const edits = [{sourceRef, expectedText: source, text}];
    return {
      status: 'ready',
      plan: {
        toolId: context.toolId,
        baseVersion: context.baseVersion,
        summary: `${change.kind === 'move' ? 'Move point' : change.kind === 'delete' ? 'Delete entities' : 'Add entities'} in sketch`,
        intent,
        edits,
        preview: {kind: 'source-edits', edits},
      },
    };
  }
}
