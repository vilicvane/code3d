import ts from '@typescript/typescript6';
import type {
  ModelSpatialOperation,
  ParameterTarget,
  RigidTransform,
  SourceRef,
  Vec3,
} from '@code3d/core/tooling';
import type {
  ToolIntent,
  ToolResolution,
  ResolveContext,
  ToolIntentResolver,
} from './tool-system';

export type SpatialSourceChange =
  | Readonly<{kind: 'parameter'; target: ParameterTarget; value: number}>
  | Readonly<{kind: 'argument'; sourceRef: SourceRef; delta: number}>
  | Readonly<{kind: 'origin-offset'; sourceRef: SourceRef; delta: Vec3}>;

export type SpatialObjectPreview = Readonly<{
  key: string;
  nodeId: string;
  transform: RigidTransform;
  spatial: ModelSpatialOperation;
}>;

export type SpatialPreview = Readonly<{
  kind: 'model-spatial';
  objects: readonly SpatialObjectPreview[];
  parameter?: Readonly<{id: string; value: number}>;
}>;

export class SpatialTransformResolver implements ToolIntentResolver {
  readonly kind = 'model.spatial' as const;

  resolve(intent: ToolIntent, context: ResolveContext): ToolResolution {
    if (intent.kind !== this.kind) throw new Error('Expected a spatial edit.');
    const change = intent.change;
    const sourceRef = context.resolveSourceRef(
      change.kind === 'parameter' ? change.target.sourceRef : change.sourceRef,
    );
    if (!sourceRef)
      return {
        status: 'conflict',
        reason: 'The spatial argument no longer maps to the source.',
      };
    const expectedText = context.readSource(sourceRef);
    const text =
      change.kind === 'parameter'
        ? numberSource(change.value)
        : change.kind === 'argument'
          ? offsetExpression(expectedText, change.delta)
          : offsetOriginCall(expectedText, change.delta);
    return {
      status: 'ready',
      plan: {
        toolId: context.toolId,
        baseVersion: context.baseVersion,
        summary:
          intent.operation === 'rotate' ? 'Rotate model' : 'Move model origin',
        intent,
        edits: [{sourceRef, expectedText, text}],
        preview: intent.preview,
      },
    };
  }
}

/** Keep authored expressions, folding only their trailing numeric adjustment. */
export function offsetExpression(source: string, delta: number): string {
  if (Math.abs(delta) < 1e-9) return source;
  const {file, expression} = parseExpression(source);
  const value = numericValue(expression);
  if (value !== undefined) return numberSource(value + delta);
  if (
    ts.isBinaryExpression(expression) &&
    (expression.operatorToken.kind === ts.SyntaxKind.PlusToken ||
      expression.operatorToken.kind === ts.SyntaxKind.MinusToken)
  ) {
    const right = numericValue(expression.right);
    if (right !== undefined) {
      const increment =
        (expression.operatorToken.kind === ts.SyntaxKind.MinusToken
          ? -right
          : right) + delta;
      return adjusted(expression.left.getText(file), increment);
    }
  }
  return adjusted(source, delta);
}

function offsetOriginCall(source: string, delta: Vec3): string {
  const {file, expression} = parseExpression(source);
  if (
    ts.isCallExpression(expression) &&
    ts.isPropertyAccessExpression(expression.expression) &&
    expression.expression.name.text === 'originOffset' &&
    expression.arguments.length === 3
  ) {
    const args = expression.arguments.map((argument, index) =>
      offsetExpression(argument.getText(file), delta[index]),
    );
    return `${expression.expression.getText(file)}(${args.join(', ')})`;
  }
  return `${source}.originOffset(${delta.map(numberSource).join(', ')})`;
}

function adjusted(source: string, delta: number): string {
  if (Math.abs(delta) < 1e-9) return source;
  const {file, expression} = parseExpression(source);
  return `(${expression.getText(file)}) ${delta < 0 ? '-' : '+'} ${numberSource(Math.abs(delta))}`;
}

function parseExpression(source: string) {
  const file = ts.createSourceFile(
    'expression.ts',
    `(${source})`,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const statement = file.statements[0];
  if (!ts.isExpressionStatement(statement))
    throw new Error('Expected a spatial argument expression.');
  let expression = statement.expression;
  while (ts.isParenthesizedExpression(expression))
    expression = expression.expression;
  return {file, expression};
}

function numericValue(expression: ts.Expression): number | undefined {
  if (ts.isParenthesizedExpression(expression))
    return numericValue(expression.expression);
  if (ts.isNumericLiteral(expression)) return Number(expression.text);
  if (ts.isPrefixUnaryExpression(expression)) {
    const value = numericValue(expression.operand);
    if (value !== undefined && expression.operator === ts.SyntaxKind.MinusToken)
      return -value;
    if (value !== undefined && expression.operator === ts.SyntaxKind.PlusToken)
      return value;
  }
  return undefined;
}

function numberSource(value: number): string {
  if (!Number.isFinite(value))
    throw new Error('Spatial values must be finite.');
  return String(Number(value.toFixed(6)));
}
