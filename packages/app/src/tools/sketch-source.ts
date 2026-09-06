import ts from '@typescript/typescript6';
import type {
  SketchPointAddress,
  SketchPosition,
  SketchConstraint,
  SourceRef,
} from '@code3d/core/tooling';
import {formatSourceNumber} from './source-expression';
import type {SketchEditableCoordinates} from '../model/sketch-drag';
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
  | Readonly<{
      kind: 'append';
      entries: readonly SketchDraftEntry[];
      constraints?: readonly SketchConstraint<SketchPointAddress>[];
    }>
  | Readonly<{
      kind: 'move';
      positions: readonly Readonly<{id: number; position: SketchPosition}>[];
    }>
  | Readonly<{
      kind: 'delete';
      ids: readonly number[];
      constraints?: readonly number[];
    }>;

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
const prefix = 'sketch(';

/** Analyze only the authored tuple structure; never evaluate coordinate code. */
export function analyzeSketchSource(source: string): {
  entries: ReadonlyMap<number, Entry>;
  editable: SketchEditableCoordinates;
  array?: ts.ArrayLiteralExpression;
  options?: ts.ObjectLiteralExpression;
  constraints?: ts.ArrayLiteralExpression;
  reason?: string;
} {
  const file = ts.createSourceFile(
    'sketch.ts',
    `${prefix}${source})`,
    ts.ScriptTarget.Latest,
    true,
  );
  const statement = file.statements[0];
  const call =
    statement &&
    ts.isExpressionStatement(statement) &&
    ts.isCallExpression(statement.expression)
      ? statement.expression
      : undefined;
  const array = call?.arguments[0];
  const options = call?.arguments[1];
  const entries = new Map<number, Entry>();
  const editable = new Map<number, readonly [boolean, boolean]>();
  const unsupported = () => ({
    entries,
    editable,
    reason: 'Visual editing requires explicit [kind, ID, data] tuples.',
  });
  if (!array || !ts.isArrayLiteralExpression(array)) return unsupported();
  let constraints: ts.ArrayLiteralExpression | undefined;
  if (options) {
    if (!ts.isObjectLiteralExpression(options))
      return {
        ...unsupported(),
        reason: 'Visual editing requires inline sketch options.',
      };
    for (const property of options.properties) {
      if (
        !ts.isPropertyAssignment(property) ||
        (!ts.isIdentifier(property.name) && !ts.isStringLiteral(property.name))
      )
        return {
          ...unsupported(),
          reason: 'Visual editing requires explicit sketch options.',
        };
      if (property.name.text === 'constraints') {
        if (
          constraints ||
          !ts.isArrayLiteralExpression(property.initializer) ||
          !property.initializer.elements.every(ts.isArrayLiteralExpression)
        )
          return {
            ...unsupported(),
            reason: 'Visual editing requires an explicit constraints array.',
          };
        constraints = property.initializer;
      }
    }
  }
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
    if (kind.text === 'point')
      editable.set(id, [
        numeric(data.elements[0]) !== undefined,
        numeric(data.elements[1]) !== undefined,
      ]);
  }
  return {
    entries,
    editable,
    array,
    options: options as ts.ObjectLiteralExpression | undefined,
    constraints,
  };
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
      for (const {id, position} of change.positions) {
        const entry = parsed.entries.get(id);
        const editable = parsed.editable.get(id);
        if (!entry || !editable?.some(Boolean))
          return {
            status: 'unsupported',
            reason: 'Expression-driven points must be edited in code.',
          };
        entry.data.elements.forEach((node, i) => {
          if (editable[i] && numeric(node) !== position[i])
            replace(node, formatSourceNumber(position[i]));
        });
      }
    } else if (change.kind === 'delete') {
      const remove = (node: ts.Node) => {
        const end = node.end - prefix.length;
        const scanner = ts.createScanner(
          ts.ScriptTarget.Latest,
          true,
          ts.LanguageVariant.Standard,
          source.slice(end),
        );
        const comma = scanner.scan() === ts.SyntaxKind.CommaToken;
        changes.push({
          start: node.pos - prefix.length,
          end: end + (comma ? scanner.getTextPos() : 0),
          text: '',
        });
      };
      for (const id of change.ids) {
        const entry = parsed.entries.get(id);
        if (!entry)
          return {
            status: 'conflict',
            reason: `Sketch entity ${id} no longer exists.`,
          };
        remove(entry.node);
      }
      for (const index of change.constraints ?? []) {
        const node = parsed.constraints?.elements[index];
        if (!node)
          return {
            status: 'conflict',
            reason: 'The sketch constraints changed.',
          };
        remove(node);
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
      let constraints: string;
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
        constraints = (change.constraints ?? [])
          .map(([kind, data]) => {
            let content: string;
            switch (kind) {
              case 'fixed':
                content = point(data);
                break;
              case 'horizontal':
              case 'vertical':
                content = String(data);
                break;
              case 'coincident':
                content = `[${data.map(point).join(', ')}]`;
                break;
              case 'x':
              case 'y':
                content = `[${point(data[0])}, ${formatSourceNumber(data[1])}]`;
                break;
              case 'length':
              case 'angle':
                content = `[${data.map(formatSourceNumber).join(', ')}]`;
                break;
            }
            return `['${kind}', ${content}]`;
          })
          .join(',\n  ');
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
      if (change.constraints?.length) {
        if (parsed.constraints) {
          const array = parsed.constraints;
          if (array.elements.length && !array.elements.hasTrailingComma) {
            const end = array.elements.at(-1)!.end - prefix.length;
            changes.push({start: end, end, text: ','});
          }
          const end = array.end - prefix.length - 1;
          changes.push({start: end, end, text: `\n  ${constraints},\n`});
        } else if (parsed.options) {
          const options = parsed.options;
          if (
            options.properties.length &&
            !options.properties.hasTrailingComma
          ) {
            const end = options.properties.at(-1)!.end - prefix.length;
            changes.push({start: end, end, text: ','});
          }
          const end = options.end - prefix.length - 1;
          changes.push({
            start: end,
            end,
            text: `\nconstraints: [${constraints}],\n`,
          });
        } else {
          changes.push({
            start: source.length,
            end: source.length,
            text: `, {constraints: [\n  ${constraints},\n]}`,
          });
        }
      }
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
