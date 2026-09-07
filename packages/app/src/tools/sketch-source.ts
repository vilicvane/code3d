import ts from '@typescript/typescript6';
import type {
  SketchPointAddress,
  SketchPosition,
  SketchConstraint,
  SketchArcDirection,
  SketchEntitySnapshot,
  SourceRef,
} from '@code3d/core/tooling';
import {formatSourceNumber} from './source-expression';
import {sameSketchPoint} from './sketch-snap';
import type {
  SketchEditableParameters,
  SketchGeometryData,
  SketchPointMerge,
} from '../model/sketch-drag';
import type {
  ResolveContext,
  ToolIntent,
  ToolIntentResolver,
  ToolResolution,
} from './tool-system';

export type SketchDraftEntry =
  | readonly ['point', number, SketchPosition]
  | readonly ['line', number, readonly [SketchPointAddress, SketchPointAddress]]
  | readonly ['circle', number, readonly [SketchPointAddress, number]]
  | readonly [
      'arc',
      number,
      readonly [
        SketchPointAddress,
        number,
        SketchPointAddress,
        SketchPointAddress,
        SketchArcDirection,
      ],
    ];

export function sketchDraftEntity([
  kind,
  id,
  data,
]: SketchDraftEntry): SketchEntitySnapshot {
  switch (kind) {
    case 'point':
      return {kind, id, position: data};
    case 'line':
      return {kind, id, points: data};
    case 'circle':
      return {kind, id, center: data[0], radius: data[1]};
    case 'arc':
      return {
        kind,
        id,
        center: data[0],
        radius: data[1],
        points: [data[2], data[3]],
        direction: data[4],
      };
  }
}

export type SketchChange =
  | Readonly<{
      kind: 'append';
      entries: readonly SketchDraftEntry[];
      constraints?: readonly SketchConstraint<SketchPointAddress>[];
    }>
  | Readonly<{
      kind: 'move';
      data: readonly SketchGeometryData[];
      merge?: SketchPointMerge;
    }>
  | Readonly<{
      kind: 'delete';
      ids: readonly number[];
      constraints: readonly number[];
    }>
  | Readonly<{
      kind: 'trim';
      replacements: readonly Readonly<{
        original: Exclude<SketchEntitySnapshot, {kind: 'point'}>;
        ids: readonly number[];
      }>[];
      ids: readonly number[];
      constraints: readonly number[];
      entries: readonly SketchDraftEntry[];
      constraintReplacements: readonly Readonly<{
        index: number;
        ids: readonly number[];
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
  node: ts.ArrayLiteralExpression;
  parameters: readonly ts.Expression[];
} & (
  | {kind: 'point'; data: ts.Expression}
  | {kind: 'line' | 'circle' | 'arc'; data: ts.ArrayLiteralExpression}
);
const prefix = 'sketch(';

/** Analyze only the authored tuple structure; never evaluate coordinate code. */
export function analyzeSketchSource(source: string): {
  entries: ReadonlyMap<number, Entry>;
  editable: SketchEditableParameters;
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
  const editable = new Map<number, readonly boolean[]>();
  const unsupported = () => ({
    entries,
    editable,
    reason: 'Visual editing requires explicit [kind, ID, data] tuples.',
  });
  if (!call) return unsupported();
  if (!call.arguments.length) return {entries, editable};
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
      (kind.text !== 'point' &&
        kind.text !== 'line' &&
        kind.text !== 'circle' &&
        kind.text !== 'arc') ||
      !ts.isNumericLiteral(idNode)
    )
      return unsupported();
    const id = Number(idNode.text);
    if (!Number.isSafeInteger(id) || id < 1 || entries.has(id))
      return unsupported();
    if (kind.text === 'point' && !ts.isArrayLiteralExpression(data)) {
      entries.set(id, {id, kind: 'point', node, data, parameters: []});
      continue;
    }
    if (
      !ts.isArrayLiteralExpression(data) ||
      data.elements.length !== (kind.text === 'arc' ? 5 : 2)
    )
      return unsupported();
    const parameters =
      kind.text === 'point'
        ? [...data.elements]
        : kind.text === 'circle' || kind.text === 'arc'
          ? [data.elements[1]]
          : [];
    entries.set(id, {id, kind: kind.text, node, data, parameters});
    if (parameters.length)
      editable.set(
        id,
        parameters.map(node => numeric(node) !== undefined),
      );
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
    if (parsed.reason) return {status: 'unsupported', reason: parsed.reason};
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
    const appendEntries = (text: string, required = false) => {
      if (parsed.array) append(parsed.array, text);
      else if (text || required)
        changes.push({
          start: source.length,
          end: source.length,
          text: `${source ? '\n' : ''}[${text ? '\n' + text + '\n' : ''}]`,
        });
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
        kind === 'point'
          ? data.map(formatSourceNumber)
          : kind === 'circle'
            ? [point(data[0]), formatSourceNumber(data[1])]
            : kind === 'arc'
              ? [
                  point(data[0]),
                  formatSourceNumber(data[1]),
                  point(data[2]),
                  point(data[3]),
                  `'${data[4]}'`,
                ]
              : data.map(point);
      return `  ['${kind}', ${id}, [${content.join(', ')}]],`;
    };
    const {change} = intent;
    if (change.kind === 'delete' || change.kind === 'trim') {
      for (const id of change.ids) {
        if (
          change.kind === 'trim' &&
          change.replacements.some(r => r.original.id === id)
        )
          continue;
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
      if (change.merge) {
        const {id, target} = change.merge;
        const entry = parsed.entries.get(id);
        if (entry?.kind !== 'point' || !parsed.editable.get(id)?.every(Boolean))
          return {
            status: 'unsupported',
            reason:
              'Merging a point requires two editable coordinate literals.',
          };
        try {
          replace(entry.data, point(target));
        } catch (error) {
          return {status: 'unsupported', reason: (error as Error).message};
        }
      }
      for (const {id, parameters} of change.data) {
        if (id === change.merge?.id) continue;
        const entry = parsed.entries.get(id);
        const editable = parsed.editable.get(id);
        if (!entry || !editable?.some(Boolean))
          return {
            status: 'unsupported',
            reason: 'Expression-driven geometry must be edited in code.',
          };
        entry.parameters.forEach((node, i) => {
          if (editable[i] && numeric(node) !== parameters[i])
            // Solver cleanup already checked the geometry. Do not round again
            // here: the source must replay the exact parameters from preview.
            replace(node, String(parameters[i]));
        });
      }
    } else if (change.kind === 'trim') {
      try {
        const copiesOf = new Map<
          number,
          {
            entry: Extract<Entry, {kind: 'line' | 'circle' | 'arc'}>;
            entity: Exclude<SketchEntitySnapshot, {kind: 'point'}>;
          }
        >();
        const raw = (node: ts.Node) =>
          source.slice(
            node.getStart() - prefix.length,
            node.end - prefix.length,
          );
        const replacementText = (entry: SketchDraftEntry) => {
          const original = copiesOf.get(entry[1]);
          if (!original || entry[0] === 'point' || entry[0] === 'circle')
            return entryText(entry);
          const parsedEntry = original.entry;
          const entity = original.entity;
          const start = parsedEntry.node.getStart();
          const edits: {start: number; end: number; text: string}[] = [];
          const patch = (node: ts.Node, text: string) =>
            edits.push({
              start: node.getStart() - start,
              end: node.end - start,
              text,
            });
          if (entry[1] !== entity.id)
            patch(parsedEntry.node.elements[1], String(entry[1]));
          if (entity.kind === 'circle' && entry[0] === 'arc') {
            patch(parsedEntry.node.elements[0], "'arc'");
            const data = raw(parsedEntry.data).slice(0, -1);
            patch(
              parsedEntry.data,
              `${data}${parsedEntry.data.elements.hasTrailingComma ? '' : ','} ${point(entry[2][2])}, ${point(entry[2][3])}, 'cw']`,
            );
          } else if (entity.kind === 'line' || entity.kind === 'arc') {
            const refs =
              entry[0] === 'line' ? entry[2] : [entry[2][2], entry[2][3]];
            refs.forEach((ref, i) => {
              if (!sameSketchPoint(ref, entity.points[i]))
                patch(
                  parsedEntry.data.elements[
                    i + (entity.kind === 'arc' ? 2 : 0)
                  ],
                  point(ref),
                );
            });
          }
          let text = raw(parsedEntry.node);
          for (const edit of edits.sort((a, b) => b.start - a.start))
            text = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
          return `  ${text},`;
        };
        for (const {original: entity, ids} of change.replacements) {
          const original = parsed.entries.get(entity.id);
          if (original?.kind !== entity.kind)
            throw new Error('The trimmed curve no longer exists.');
          for (const id of ids) copiesOf.set(id, {entry: original, entity});
          const retained = change.entries.find(entry => entry[1] === entity.id);
          if (!retained) remove(original.node);
          else {
            replace(
              original.node,
              replacementText(retained).trim().slice(0, -1),
            );
          }
        }
        const added = change.entries.filter(
          entry => !change.replacements.some(r => r.original.id === entry[1]),
        );
        for (const [, id] of added) {
          if (parsed.entries.has(id))
            throw new Error(`Sketch entity ${id} already exists.`);
        }
        appendEntries(added.map(replacementText).join('\n'));
        const copies: string[] = [];
        for (const {index, ids} of change.constraintReplacements) {
          const node = parsed.constraints?.elements[index];
          if (!node || !ts.isArrayLiteralExpression(node))
            throw new Error('The sketch constraints changed.');
          if (!ids.length) {
            remove(node);
            continue;
          }
          if (
            ids.length === 1 &&
            change.replacements.some(r => r.original.id === ids[0])
          )
            continue;
          const kind = node.elements[0];
          const data = node.elements[1];
          if (
            !ts.isStringLiteral(kind) ||
            !['horizontal', 'vertical', 'angle', 'radius'].includes(kind.text)
          )
            throw new Error('Splitting requires explicit constraint targets.');
          const target =
            kind.text === 'angle' || kind.text === 'radius'
              ? ts.isArrayLiteralExpression(data)
                ? data.elements[0]
                : undefined
              : data;
          if (!target)
            throw new Error('Splitting requires explicit constraint targets.');
          replace(target, String(ids[0]));
          const start = node.getStart() - prefix.length;
          const raw = source.slice(start, node.end - prefix.length);
          for (const id of ids.slice(1))
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
              case 'radius':
              case 'sweep':
                content = `[${data.map(formatSourceNumber).join(', ')}]`;
                break;
            }
            return `['${kind}', ${content}]`;
          })
          .join(',\n  ');
      } catch (error) {
        return {status: 'conflict', reason: (error as Error).message};
      }
      appendEntries(text, !!change.constraints?.length);
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
        summary: `${change.kind === 'move' ? 'Edit geometry' : change.kind === 'delete' ? 'Delete entities' : change.kind === 'trim' ? 'Delete segment' : 'Add entities'} in sketch`,
        intent,
        edits,
        preview: {kind: 'source-edits', edits},
      },
    };
  }
}
