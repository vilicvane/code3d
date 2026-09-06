import ts from '@typescript/typescript6';
import type {
  SketchPointAddress,
  SketchPosition,
  SketchConstraint,
  SketchLineSnapshot,
  SourceRef,
} from '@code3d/core/tooling';
import {formatSourceNumber} from './source-expression';
import {sameSketchPoint} from './sketch-snap';
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
      constraints: readonly number[];
    }>
  | Readonly<{
      kind: 'trim';
      line: SketchLineSnapshot;
      ids: readonly number[];
      constraints: readonly number[];
      entries: readonly SketchDraftEntry[];
      lineConstraints: readonly Readonly<{
        index: number;
        lines: readonly number[];
      }>[];
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
    const removed = new Set<ts.Node>();
    const followingComma = (node: ts.Node) => {
      const scanner = ts.createScanner(
        ts.ScriptTarget.Latest,
        true,
        ts.LanguageVariant.Standard,
        source.slice(node.end - prefix.length),
      );
      return scanner.scan() === ts.SyntaxKind.CommaToken
        ? scanner.getTextPos()
        : 0;
    };
    const remove = (node: ts.Node) => {
      removed.add(node);
      changes.push({
        start: node.pos - prefix.length,
        end: node.end - prefix.length + followingComma(node),
        text: '',
      });
    };
    const append = (array: ts.ArrayLiteralExpression, text: string) => {
      if (!text) return;
      const last = array.elements.filter(node => !removed.has(node)).at(-1);
      if (last && !followingComma(last)) {
        const end = last.end - prefix.length;
        changes.push({start: end, end, text: ','});
      }
      const end = array.end - prefix.length - 1;
      const closingIndent = source.slice(0, end).match(/[ \t]*$/)![0];
      const start = end - closingIndent.length;
      const separator = source[start - 1] === '\n' ? '' : '\n';
      changes.push({start, end, text: `${separator}${text}\n${closingIndent}`});
    };
    const point = (ref: SketchPointAddress): string => {
      if (ref.layer === intent.layer) return String(ref.id);
      const name = intent.references[ref.layer];
      if (!name)
        throw new Error(
          'This upstream point has no accessible sketch binding.',
        );
      return `${name}.point(${ref.id})`;
    };
    const entryText = ([kind, id, data]: SketchDraftEntry) => {
      const content =
        kind === 'point' ? data.map(formatSourceNumber) : data.map(point);
      return `  ['${kind}', ${id}, [${content.join(', ')}]],`;
    };
    const {change} = intent;
    if (change.kind === 'delete' || change.kind === 'trim') {
      for (const id of change.ids) {
        if (change.kind === 'trim' && id === change.line.id) continue;
        const entry = parsed.entries.get(id);
        if (!entry)
          return {
            status: 'conflict',
            reason: `Sketch entity ${id} no longer exists.`,
          };
        remove(entry.node);
      }
      for (const index of change.constraints) {
        const node = parsed.constraints?.elements[index];
        if (!node)
          return {
            status: 'conflict',
            reason: 'The sketch constraints changed.',
          };
        remove(node);
      }
    }
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
    } else if (change.kind === 'trim') {
      const original = parsed.entries.get(change.line.id);
      if (original?.kind !== 'line')
        return {
          status: 'conflict',
          reason: 'The trimmed line no longer exists.',
        };
      const retained = change.entries.find(
        entry => entry[1] === change.line.id,
      );
      try {
        if (retained?.[0] === 'line') {
          retained[2].forEach((ref, i) => {
            if (!sameSketchPoint(ref, change.line.points[i]))
              replace(original.data.elements[i], point(ref));
          });
        } else remove(original.node);
        const added = change.entries.filter(
          entry => entry[1] !== change.line.id,
        );
        for (const [, id] of added) {
          if (parsed.entries.has(id))
            throw new Error(`Sketch entity ${id} already exists.`);
        }
        append(parsed.array, added.map(entryText).join('\n'));
        const copies: string[] = [];
        for (const {index, lines} of change.lineConstraints) {
          const node = parsed.constraints?.elements[index];
          if (!node || !ts.isArrayLiteralExpression(node))
            throw new Error('The sketch constraints changed.');
          if (!lines.length) {
            remove(node);
            continue;
          }
          if (lines.length === 1 && lines[0] === change.line.id) continue;
          const kind = node.elements[0];
          const data = node.elements[1];
          if (
            !ts.isStringLiteral(kind) ||
            !['horizontal', 'vertical', 'angle'].includes(kind.text)
          )
            throw new Error(
              'Splitting requires explicit direction constraint targets.',
            );
          const target =
            kind.text === 'angle'
              ? ts.isArrayLiteralExpression(data)
                ? data.elements[0]
                : undefined
              : data;
          if (!target)
            throw new Error(
              'Splitting requires explicit direction constraint targets.',
            );
          replace(target, String(lines[0]));
          const start = node.getStart() - prefix.length;
          const raw = source.slice(start, node.end - prefix.length);
          for (const id of lines.slice(1))
            copies.push(
              `  ${raw.slice(0, target.getStart() - prefix.length - start)}${id}${raw.slice(target.end - prefix.length - start)},`,
            );
        }
        if (copies.length) append(parsed.constraints!, copies.join('\n'));
      } catch (error) {
        return {status: 'conflict', reason: (error as Error).message};
      }
    } else if (change.kind === 'append') {
      const ids = new Set(parsed.entries.keys());
      let text: string;
      let constraints: string;
      try {
        text = change.entries
          .map(entry => {
            const id = entry[1];
            if (ids.has(id))
              throw new Error(`Sketch entity ${id} already exists.`);
            ids.add(id);
            return entryText(entry);
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
              case 'midpoint':
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
      append(parsed.array, text);
      if (change.constraints?.length) {
        if (parsed.constraints) {
          append(parsed.constraints, `  ${constraints},`);
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
        summary: `${change.kind === 'move' ? 'Move point' : change.kind === 'delete' ? 'Delete entities' : change.kind === 'trim' ? 'Delete segment' : 'Add entities'} in sketch`,
        intent,
        edits,
        preview: {kind: 'source-edits', edits},
      },
    };
  }
}
