import type {
  ParameterTarget,
  Quaternion,
  SourceRef,
  Vec3,
} from '../model/runtime';
import type {ViewportDecoration} from '../viewport-decoration';
import {rotateVector} from '../model/spatial';

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
  expectedText?: string;
}>;

export type ToolIntent =
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
      kind: 'operation.insert';
      receiver: SourceAnchor;
      operation: string;
      arguments: readonly ExpressionDraft[];
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

export type ToolPreview =
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

export interface ToolHost {
  sourceVersion(): number;
  readSource(sourceRef: SourceRef): string;
  applySourceEdits(
    baseVersion: number,
    edits: readonly SourceTextEdit[],
  ): boolean;
  applyPreview(preview: ToolPreview): void;
  clearPreview(preview: ToolPreview, reason: 'replace' | 'end'): void;
}

type ResolveContext = Readonly<{
  toolId: string;
  baseVersion: number;
  readSource(sourceRef: SourceRef): string;
}>;

interface ToolIntentResolver {
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
    this.register(new InsertOperationResolver());
    this.register(new OffsetRelationResolver());
  }

  begin(toolId: string): ToolSession {
    return new ToolSession(this, toolId, this.host.sourceVersion());
  }

  resolve(
    toolId: string,
    baseVersion: number,
    intent: ToolIntent,
  ): ToolResolution {
    if (this.host.sourceVersion() !== baseVersion) {
      return {
        status: 'conflict',
        reason:
          'The source changed after the tool started. Retry with the latest model.',
      };
    }
    const resolver = this.resolvers.get(intent.kind);
    if (!resolver) {
      return {
        status: 'unsupported',
        reason: `No resolver is registered for ${intent.kind}.`,
      };
    }
    return resolver.resolve(intent, {
      toolId,
      baseVersion,
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
    readonly baseVersion: number,
  ) {}

  preview(intent: ToolIntent): ToolResolution {
    if (this.closed) {
      return {status: 'conflict', reason: 'The tool session has ended.'};
    }
    const resolution = this.engine.resolve(
      this.toolId,
      this.baseVersion,
      intent,
    );
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

  commit(intent = this.lastIntent): ToolCommitResult {
    if (this.closed || !intent) {
      return {
        status: 'conflict',
        reason: 'The tool session has no edit to commit.',
      };
    }
    const resolution = this.engine.resolve(
      this.toolId,
      this.baseVersion,
      intent,
    );
    if (resolution.status !== 'ready') {
      this.clearActivePreview('end');
      this.closed = true;
      return resolution;
    }
    if (
      !this.engine.host.applySourceEdits(
        resolution.plan.baseVersion,
        resolution.plan.edits,
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
    const currentText = context.readSource(intent.target.sourceRef);
    if (parseSourceNumber(currentText) !== intent.target.value) {
      return {
        status: 'conflict',
        reason:
          'The parameter source changed. Wait for the model update and retry.',
      };
    }
    const edits: readonly SourceTextEdit[] = [
      {
        sourceRef: intent.target.sourceRef,
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

class InsertOperationResolver implements ToolIntentResolver {
  readonly kind = 'operation.insert' as const;

  resolve(intent: ToolIntent, context: ResolveContext): ToolResolution {
    if (intent.kind !== this.kind) {
      return {
        status: 'unsupported',
        reason: 'The operation resolver received the wrong edit intent.',
      };
    }
    if (!isIdentifier(intent.operation)) {
      return {
        status: 'unsupported',
        reason: 'The operation name is not a valid identifier.',
      };
    }
    try {
      const receiver = context.readSource(intent.receiver.sourceRef);
      const argumentsText = intent.arguments.map(renderExpression).join(', ');
      return expressionPlan(
        intent,
        intent.receiver,
        `(${receiver}).${intent.operation}(${argumentsText})`,
        `Add .${intent.operation}() operation`,
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
    const receiver = context.readSource(intent.receiver.sourceRef);
    const delta = intent.delta.map(formatSourceNumber).join(', ');
    const resolution = expressionPlan(
      intent,
      intent.receiver,
      `(${receiver}).offset(${delta})`,
      'Add relation offset',
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
  replacement: string,
  summary: string,
  context: ResolveContext,
): ToolResolution {
  const currentText = context.readSource(anchor.sourceRef);
  if (
    anchor.expectedText !== undefined &&
    anchor.expectedText !== currentText
  ) {
    return {status: 'conflict', reason: 'The expression source changed.'};
  }
  const edits: readonly SourceTextEdit[] = [
    {
      sourceRef: anchor.sourceRef,
      expectedText: currentText,
      text: replacement,
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

function formatSourceNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error('An expression value must be a finite number.');
  }
  const normalized = Object.is(value, -0) ? 0 : value;
  return String(Number(normalized.toPrecision(12)));
}

function isIdentifier(value: string): boolean {
  return /^[$A-Z_a-z][$\w]*$/.test(value);
}
