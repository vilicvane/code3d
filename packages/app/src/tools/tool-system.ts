import {topologyIdExpression} from './topology-expression';
import {
  rotateVector,
  type EdgeId,
  type ParameterTarget,
  type Quaternion,
  type SourceRef,
  type Vec3,
} from '@code3d/core/tooling';
import type {ViewportDecoration} from '../viewport-decoration';
import type {ToolArgumentEditTarget} from '../model/tool-schema';
import {
  SpatialTransformResolver,
  type SpatialSourceChange,
  type SpatialPreview,
} from './spatial-edit';
import {formatSourceNumber, offsetCallSource} from './source-expression';

export type ExpressionDraft =
  | Readonly<{kind: 'number'; value: number}>
  | Readonly<{kind: 'string'; value: string}>
  | Readonly<{kind: 'boolean'; value: boolean}>
  | Readonly<{kind: 'identifier'; name: string}>
  | Readonly<{
      kind: 'array';
      elements: readonly ExpressionDraft[];
    }>
  | Readonly<{
      kind: 'binary';
      operator: '+' | '-' | '*' | '/';
      left: ExpressionDraft;
      right: ExpressionDraft;
    }>
  | Readonly<{
      kind: 'call';
      callee: ExpressionDraft;
      arguments: readonly ExpressionDraft[];
    }>
  | Readonly<{
      kind: 'member';
      object: ExpressionDraft;
      property: string;
    }>;

export type SourceAnchor = Readonly<{
  sourceRef: SourceRef;
}>;

export type ToolIntent =
  | Readonly<{
      kind: 'model.spatial';
      operation: string;
      change: SpatialSourceChange;
      preview: SpatialPreview;
    }>
  | Readonly<{
      kind: 'parameter.set';
      target: ParameterTarget;
      value: number;
    }>
  | Readonly<{
      kind: 'expression.replace';
      target: SourceAnchor;
      expression: ExpressionDraft;
    }>
  | Readonly<{
      kind: 'argument.remove';
      parameter: string;
      target: Extract<ToolArgumentEditTarget, Readonly<{kind: 'present'}>>;
    }>
  | Readonly<{
      kind: 'argument.set';
      parameter: string;
      target: ToolArgumentEditTarget;
      expression: ExpressionDraft;
    }>
  | Readonly<{
      kind: 'edge-operation.set';
      operation: 'fillet' | 'chamfer';
      parameter?: Readonly<{target: ParameterTarget; value: number}>;
      edges?: Readonly<
        | {
            kind: 'explicit';
            argument: EdgeArgumentTarget;
            ids: readonly EdgeId[];
          }
        | {kind: 'all'; argument: EdgeArgumentTarget}
      >;
    }>
  | Readonly<{
      kind: 'relation.offset';
      receiver: SourceAnchor;
      occurrenceKeys: readonly string[];
      delta: Vec3;
      frameQuaternion: Quaternion;
    }>;

export type SourceTextEdit = Readonly<{
  sourceRef: SourceRef;
  expectedText: string;
  text: string;
}>;

type EdgeArgumentTarget = Readonly<
  | {
      kind: 'replace';
      sourceRef: SourceRef;
      removalSourceRef: SourceRef;
    }
  | {kind: 'append'; sourceRef: SourceRef; needsComma: boolean}
>;

export type ToolPreview =
  | SpatialPreview
  | Readonly<{
      kind: 'parameter';
      targetId: string;
      value: number;
    }>
  | Readonly<{
      kind: 'source-edits';
      edits: readonly SourceTextEdit[];
    }>
  | Readonly<{
      kind: 'occurrence-translation';
      occurrenceKeys: readonly string[];
      delta: Vec3;
    }>
  | Readonly<{
      kind: 'viewport-decorations';
      owner: string;
      decorations: readonly ViewportDecoration[];
    }>;

export type ToolEditPlan = Readonly<{
  toolId: string;
  baseVersion: number;
  summary: string;
  intent: ToolIntent;
  edits: readonly SourceTextEdit[];
  preview: ToolPreview;
}>;

export type ToolResolution =
  | Readonly<{status: 'ready'; plan: ToolEditPlan}>
  | Readonly<{
      status: 'choice';
      reason: string;
      plans: readonly ToolEditPlan[];
    }>
  | Readonly<{status: 'conflict' | 'unsupported'; reason: string}>;

export type ToolCommitResult =
  | Readonly<{status: 'committed'; plan: ToolEditPlan}>
  | Exclude<ToolResolution, Readonly<{status: 'ready'; plan: ToolEditPlan}>>;

export type ToolCommitOptions = Readonly<{
  undoGroup?: string;
}>;

export interface ToolHost {
  sourceVersion(): number;
  resolveSourceRef(sourceRef: SourceRef): SourceRef | undefined;
  readSource(sourceRef: SourceRef): string;
  applySourceEdits(
    baseVersion: number,
    edits: readonly SourceTextEdit[],
    options: ToolCommitOptions,
  ): boolean;
  applyPreview(preview: ToolPreview): void;
  commitPreview(preview: ToolPreview): void;
  clearPreview(preview: ToolPreview, reason: 'replace' | 'end'): void;
}

export type ResolveContext = Readonly<{
  toolId: string;
  baseVersion: number;
  resolveSourceRef(sourceRef: SourceRef): SourceRef | undefined;
  readSource(sourceRef: SourceRef): string;
}>;

export interface ToolIntentResolver {
  readonly kind: ToolIntent['kind'];
  resolve(intent: ToolIntent, context: ResolveContext): ToolResolution;
}

export class ToolEngine {
  private readonly resolvers = new Map<
    ToolIntent['kind'],
    ToolIntentResolver
  >();

  constructor(readonly host: ToolHost) {
    this.register(new SetParameterResolver());
    this.register(new ReplaceExpressionResolver());
    this.register(new RemoveArgumentResolver());
    this.register(new SetArgumentResolver());
    this.register(new SetEdgeOperationResolver());
    this.register(new OffsetRelationResolver());
    this.register(new SpatialTransformResolver());
  }

  begin(toolId: string): ToolSession {
    return new ToolSession(this, toolId);
  }

  resolve(toolId: string, intent: ToolIntent): ToolResolution {
    const resolver = this.resolvers.get(intent.kind);
    if (!resolver) {
      return {
        status: 'unsupported',
        reason: `No resolver is registered for ${intent.kind}.`,
      };
    }
    return resolver.resolve(intent, {
      toolId,
      baseVersion: this.host.sourceVersion(),
      resolveSourceRef: sourceRef => this.host.resolveSourceRef(sourceRef),
      readSource: sourceRef => this.host.readSource(sourceRef),
    });
  }

  private register(resolver: ToolIntentResolver): void {
    this.resolvers.set(resolver.kind, resolver);
  }
}

export class ToolSession {
  private activePreview?: ToolPreview;
  private lastIntent?: ToolIntent;
  private closed = false;

  constructor(
    private readonly engine: ToolEngine,
    readonly toolId: string,
  ) {}

  preview(intent: ToolIntent): ToolResolution {
    if (this.closed) {
      return {status: 'conflict', reason: 'The tool session has ended.'};
    }
    const resolution = this.engine.resolve(this.toolId, intent);
    if (resolution.status !== 'ready') {
      this.clearActivePreview('end');
      return resolution;
    }
    if (this.activePreview) {
      this.engine.host.clearPreview(this.activePreview, 'replace');
    }
    this.activePreview = resolution.plan.preview;
    this.lastIntent = intent;
    this.engine.host.applyPreview(this.activePreview);
    return resolution;
  }

  commit(
    intent = this.lastIntent,
    options: ToolCommitOptions = {},
  ): ToolCommitResult {
    if (this.closed || !intent) {
      return {
        status: 'conflict',
        reason: 'The tool session has no edit to commit.',
      };
    }
    const resolution = this.engine.resolve(this.toolId, intent);
    if (resolution.status !== 'ready') {
      this.clearActivePreview('end');
      this.closed = true;
      return resolution;
    }
    if (
      !this.engine.host.applySourceEdits(
        resolution.plan.baseVersion,
        resolution.plan.edits,
        options,
      )
    ) {
      this.clearActivePreview('end');
      this.closed = true;
      return {
        status: 'conflict',
        reason:
          'The source edit could not be applied atomically. Retry with the latest model.',
      };
    }
    if (this.activePreview) {
      this.engine.host.clearPreview(this.activePreview, 'replace');
    }
    this.engine.host.applyPreview(resolution.plan.preview);
    this.engine.host.commitPreview(resolution.plan.preview);
    this.activePreview = undefined;
    this.closed = true;
    return {status: 'committed', plan: resolution.plan};
  }

  cancel(): void {
    this.clearActivePreview('end');
    this.closed = true;
  }

  private clearActivePreview(reason: 'replace' | 'end'): void {
    if (this.activePreview) {
      this.engine.host.clearPreview(this.activePreview, reason);
      this.activePreview = undefined;
    }
  }
}

class SetParameterResolver implements ToolIntentResolver {
  readonly kind = 'parameter.set' as const;

  resolve(intent: ToolIntent, context: ResolveContext): ToolResolution {
    if (intent.kind !== this.kind) {
      return {
        status: 'unsupported',
        reason: 'The parameter resolver received the wrong edit intent.',
      };
    }
    if (!Number.isFinite(intent.value)) {
      return {
        status: 'unsupported',
        reason: 'A parameter must be a finite number.',
      };
    }
    const sourceRef = context.resolveSourceRef(intent.target.sourceRef);
    if (!sourceRef) {
      return {
        status: 'conflict',
        reason: 'The parameter no longer maps to the current source.',
      };
    }
    const currentText = context.readSource(sourceRef);
    if (parseSourceNumber(currentText) === undefined) {
      return {
        status: 'conflict',
        reason: 'The parameter is no longer a numeric source expression.',
      };
    }
    const edits: readonly SourceTextEdit[] = [
      {
        sourceRef,
        expectedText: currentText,
        text: formatSourceNumber(intent.value),
      },
    ];
    return {
      status: 'ready',
      plan: {
        toolId: context.toolId,
        baseVersion: context.baseVersion,
        summary: `Set ${intent.target.label} to ${intent.value}`,
        intent,
        edits,
        preview: {
          kind: 'parameter',
          targetId: intent.target.id,
          value: intent.value,
        },
      },
    };
  }
}

class ReplaceExpressionResolver implements ToolIntentResolver {
  readonly kind = 'expression.replace' as const;

  resolve(intent: ToolIntent, context: ResolveContext): ToolResolution {
    if (intent.kind !== this.kind) {
      return {
        status: 'unsupported',
        reason: 'The expression resolver received the wrong edit intent.',
      };
    }
    try {
      return expressionPlan(
        intent,
        intent.target,
        renderExpression(intent.expression),
        'Replace model expression',
        context,
      );
    } catch (error) {
      return {
        status: 'unsupported',
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

class RemoveArgumentResolver implements ToolIntentResolver {
  readonly kind = 'argument.remove' as const;

  resolve(intent: ToolIntent, context: ResolveContext): ToolResolution {
    if (intent.kind !== this.kind) {
      return {
        status: 'unsupported',
        reason: 'The argument resolver received the wrong edit intent.',
      };
    }
    const sourceRef = context.resolveSourceRef(intent.target.removalSourceRef);
    if (!sourceRef) {
      return {
        status: 'conflict',
        reason: 'The argument no longer maps to the current source.',
      };
    }
    const expectedText = context.readSource(sourceRef);
    if (expectedText.length === 0) {
      return {
        status: 'conflict',
        reason: 'The argument has already been removed.',
      };
    }
    const edits: readonly SourceTextEdit[] = [
      {sourceRef, expectedText, text: ''},
    ];
    return {
      status: 'ready',
      plan: {
        toolId: context.toolId,
        baseVersion: context.baseVersion,
        summary: `Remove ${intent.parameter}`,
        intent,
        edits,
        preview: {kind: 'source-edits', edits},
      },
    };
  }
}

class SetArgumentResolver implements ToolIntentResolver {
  readonly kind = 'argument.set' as const;

  resolve(intent: ToolIntent, context: ResolveContext): ToolResolution {
    if (intent.kind !== this.kind) {
      return {
        status: 'unsupported',
        reason: 'The argument resolver received the wrong edit intent.',
      };
    }
    const sourceRef = context.resolveSourceRef(intent.target.sourceRef);
    if (!sourceRef) {
      return {
        status: 'conflict',
        reason: 'The argument no longer maps to the current source.',
      };
    }
    let expression: string;
    try {
      expression = renderExpression(intent.expression);
    } catch (error) {
      return {
        status: 'unsupported',
        reason: error instanceof Error ? error.message : String(error),
      };
    }
    const expectedText = context.readSource(sourceRef);
    const text =
      intent.target.kind === 'omitted' && intent.target.needsComma
        ? `, ${expression}`
        : expression;
    const edits: readonly SourceTextEdit[] = [{sourceRef, expectedText, text}];
    return {
      status: 'ready',
      plan: {
        toolId: context.toolId,
        baseVersion: context.baseVersion,
        summary: `Set ${intent.parameter}`,
        intent,
        edits,
        preview: {kind: 'source-edits', edits},
      },
    };
  }
}

class SetEdgeOperationResolver implements ToolIntentResolver {
  readonly kind = 'edge-operation.set' as const;
  private readonly parameterResolver = new SetParameterResolver();

  resolve(intent: ToolIntent, context: ResolveContext): ToolResolution {
    if (intent.kind !== this.kind) {
      return {
        status: 'unsupported',
        reason: 'The edge-operation resolver received the wrong edit intent.',
      };
    }
    const edits: SourceTextEdit[] = [];
    if (intent.parameter) {
      const resolution = this.parameterResolver.resolve(
        {kind: 'parameter.set', ...intent.parameter},
        context,
      );
      if (resolution.status !== 'ready') return resolution;
      edits.push(...resolution.plan.edits);
    }
    if (intent.edges) {
      const argument = intent.edges.argument;
      const edgeArray =
        intent.edges.kind === 'explicit'
          ? renderExpression({
              kind: 'array',
              elements: intent.edges.ids.map(topologyIdExpression),
            })
          : undefined;
      const replaceExistingArgument =
        intent.edges.kind === 'explicit' && argument.kind === 'replace'
          ? context.resolveSourceRef(argument.sourceRef)
          : undefined;
      const sourceRef = replaceExistingArgument
        ? replaceExistingArgument
        : context.resolveSourceRef(
            argument.kind === 'replace'
              ? argument.removalSourceRef
              : argument.sourceRef,
          );
      if (!sourceRef) {
        return {
          status: 'conflict',
          reason: 'The edge argument no longer maps to the current source.',
        };
      }
      const expectedText = context.readSource(sourceRef);
      edits.push({
        sourceRef,
        expectedText,
        text:
          edgeArray === undefined || replaceExistingArgument
            ? (edgeArray ?? '')
            : `${argument.kind === 'append' && !argument.needsComma ? '' : ','} ${edgeArray}`,
      });
    }
    if (edits.length === 0) {
      return {
        status: 'conflict',
        reason: 'The edge operation has no changes to apply.',
      };
    }
    const ordered = [...edits].sort(
      (left, right) =>
        left.sourceRef.file.localeCompare(right.sourceRef.file) ||
        left.sourceRef.start - right.sourceRef.start,
    );
    if (
      ordered.some(
        (edit, index) =>
          index > 0 &&
          ordered[index - 1].sourceRef.file === edit.sourceRef.file &&
          ordered[index - 1].sourceRef.end > edit.sourceRef.start,
      )
    ) {
      return {
        status: 'conflict',
        reason: 'The edge-operation edits overlap in source.',
      };
    }
    return {
      status: 'ready',
      plan: {
        toolId: context.toolId,
        baseVersion: context.baseVersion,
        summary: `Update ${intent.operation}`,
        intent,
        edits,
        preview: {kind: 'source-edits', edits},
      },
    };
  }
}

class OffsetRelationResolver implements ToolIntentResolver {
  readonly kind = 'relation.offset' as const;

  resolve(intent: ToolIntent, context: ResolveContext): ToolResolution {
    if (intent.kind !== this.kind) {
      return {
        status: 'unsupported',
        reason: 'The relation-offset resolver received the wrong edit intent.',
      };
    }
    if (
      intent.occurrenceKeys.length === 0 ||
      intent.delta.some(value => !Number.isFinite(value))
    ) {
      return {
        status: 'unsupported',
        reason: 'A relation offset requires an object and finite values.',
      };
    }
    const resolution = expressionPlan(
      intent,
      intent.receiver,
      receiver => offsetCallSource(receiver, 'offset', intent.delta),
      'Adjust relation offset',
      context,
    );
    if (resolution.status !== 'ready') {
      return resolution;
    }
    return {
      status: 'ready',
      plan: {
        ...resolution.plan,
        preview: {
          kind: 'occurrence-translation',
          occurrenceKeys: intent.occurrenceKeys,
          delta: rotateVector(intent.delta, intent.frameQuaternion),
        },
      },
    };
  }
}

function expressionPlan(
  intent: ToolIntent,
  anchor: SourceAnchor,
  replacement: string | ((source: string) => string),
  summary: string,
  context: ResolveContext,
): ToolResolution {
  const sourceRef = context.resolveSourceRef(anchor.sourceRef);
  if (!sourceRef) {
    return {
      status: 'conflict',
      reason: 'The expression no longer maps to the current source.',
    };
  }
  const currentText = context.readSource(sourceRef);
  const edits: readonly SourceTextEdit[] = [
    {
      sourceRef,
      expectedText: currentText,
      text:
        typeof replacement === 'string'
          ? replacement
          : replacement(currentText),
    },
  ];
  return {
    status: 'ready',
    plan: {
      toolId: context.toolId,
      baseVersion: context.baseVersion,
      summary,
      intent,
      edits,
      preview: {kind: 'source-edits', edits},
    },
  };
}

function renderExpression(expression: ExpressionDraft): string {
  switch (expression.kind) {
    case 'number':
      return formatSourceNumber(expression.value);
    case 'string':
      return JSON.stringify(expression.value);
    case 'boolean':
      return String(expression.value);
    case 'identifier':
      if (!isIdentifier(expression.name)) {
        throw new Error(`Invalid identifier: ${expression.name}`);
      }
      return expression.name;
    case 'array':
      return `[${expression.elements.map(renderExpression).join(', ')}]`;
    case 'binary':
      return `(${renderExpression(expression.left)} ${expression.operator} ${renderExpression(expression.right)})`;
    case 'call':
      return `${renderExpression(expression.callee)}(${expression.arguments.map(renderExpression).join(', ')})`;
    case 'member':
      if (!isIdentifier(expression.property)) {
        throw new Error(`Invalid property name: ${expression.property}`);
      }
      return `${renderExpression(expression.object)}.${expression.property}`;
  }
}

function parseSourceNumber(source: string): number | undefined {
  const normalized = source.replace(/[()_\s]/g, '');
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(normalized)) {
    return undefined;
  }
  const value = Number(normalized);
  return Number.isFinite(value) ? value : undefined;
}

function isIdentifier(value: string): boolean {
  return /^[$A-Z_a-z][$\w]*$/.test(value);
}
