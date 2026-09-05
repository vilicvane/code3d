import ts from '@typescript/typescript6';
import type * as CoreTooling from '@code3d/core/tooling';
import type {Sketch, SketchSnapshot, SourceRef} from '@code3d/core/tooling';

export type CompiledSketch = SketchSnapshot &
  Readonly<{
    definitionRef?: SourceRef;
    references: Readonly<Record<string, string>>;
  }>;

type SketchTrace = {
  id: string;
  definitionRef?: SourceRef;
  references: Record<string, string>;
};

/** Source identity is evaluation-local; authored entity IDs remain layer-local. */
export class SketchTraceRegistry {
  private readonly values = new Map<Sketch, SketchTrace>();
  private readonly bindings = new Map<string, Set<Sketch>>();
  private readonly calls = new Map<string, ts.CallExpression>();
  private readonly writtenSymbols = new Set<ts.Symbol>();
  private checker!: ts.TypeChecker;

  constructor(private readonly runtime: typeof CoreTooling) {}

  begin(program: ts.Program): void {
    this.clear();
    this.checker = program.getTypeChecker();
    for (const file of program.getSourceFiles()) {
      if (file.isDeclarationFile) continue;
      const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node)) this.calls.set(nodeKey(node), node);
        const written =
          ts.isBinaryExpression(node) &&
          node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
          node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
            ? node.left
            : (ts.isPrefixUnaryExpression(node) ||
                  ts.isPostfixUnaryExpression(node)) &&
                (node.operator === ts.SyntaxKind.PlusPlusToken ||
                  node.operator === ts.SyntaxKind.MinusMinusToken)
              ? node.operand
              : undefined;
        if (written) {
          const collect = (part: ts.Node): void => {
            if (ts.isIdentifier(part)) {
              const symbol = this.checker.getSymbolAtLocation(part);
              if (symbol) this.writtenSymbols.add(symbol);
            }
            ts.forEachChild(part, collect);
          };
          collect(written);
        }
        ts.forEachChild(node, visit);
      };
      visit(file);
    }
  }

  clear(): void {
    this.values.clear();
    this.bindings.clear();
    this.calls.clear();
    this.writtenSymbols.clear();
  }

  get size(): number {
    return this.values.size;
  }

  identity(value: Sketch): string {
    let trace = this.values.get(value);
    if (!trace) {
      trace = {id: `sketch:untraced:${this.values.size}`, references: {}};
      this.values.set(value, trace);
      const {base} = this.runtime.sketchDefinition(value);
      if (base) this.identity(base);
    }
    return trace.id;
  }

  bind(value: unknown, location: SourceRef): void {
    if (!this.runtime.isSketch(value)) return;
    const key = sourceKey(location);
    const values = this.bindings.get(key) ?? new Set();
    values.add(value);
    this.bindings.set(key, values);
    this.identity(value);
  }

  call(
    value: unknown,
    id: string,
    location: SourceRef,
    argument: unknown,
    receiver: unknown,
  ): void {
    if (!this.runtime.isSketch(value) || this.values.has(value)) return;
    const definition = this.runtime.sketchDefinition(value);
    const call = this.calls.get(sourceKey(location));
    const editable =
      call &&
      definition.input === argument &&
      call.arguments[0] &&
      ts.isArrayLiteralExpression(call.arguments[0]);
    const trace: SketchTrace = {
      id: `sketch:${id}`,
      definitionRef: editable ? nodeRef(call.arguments[0]) : undefined,
      references: {},
    };
    this.values.set(value, trace);
    const ancestors = new Set<Sketch>();
    for (
      let base = definition.base;
      base;
      base = this.runtime.sketchDefinition(base).base
    ) {
      ancestors.add(base);
      this.identity(base);
    }
    if (!call) return;
    // Only use stable lexical bindings whose observed value is unambiguous.
    for (const visible of this.checker.getSymbolsInScope(
      call,
      ts.SymbolFlags.Value,
    )) {
      const symbol =
        visible.flags & ts.SymbolFlags.Alias
          ? this.checker.getAliasedSymbol(visible)
          : visible;
      if (this.writtenSymbols.has(symbol)) continue;
      const declaration = symbol.valueDeclaration;
      if (
        !declaration ||
        !ts.isVariableDeclaration(declaration) ||
        !ts.isIdentifier(declaration.name) ||
        !declaration.initializer
      )
        continue;
      const values = this.bindings.get(
        sourceKey({
          file: declaration.getSourceFile().fileName,
          start: declaration.name.getStart(),
          end: declaration.initializer.end,
        }),
      );
      if (values?.size !== 1) continue;
      const upstream = [...values][0];
      if (ancestors.has(upstream))
        trace.references[this.identity(upstream)] = visible.name;
    }
    // The evaluated receiver proves a stable name denotes the actual base,
    // including function parameters and repeated factory executions. A written
    // binding is not safe: argument evaluation itself can reassign it.
    if (
      definition.base === receiver &&
      ts.isPropertyAccessExpression(call.expression) &&
      ts.isIdentifier(call.expression.expression)
    ) {
      const symbol = this.checker.getSymbolAtLocation(
        call.expression.expression,
      );
      if (symbol && !this.writtenSymbols.has(symbol)) {
        trace.references[this.identity(definition.base!)] =
          call.expression.expression.text;
      }
    }
  }

  snapshots(): ReadonlyMap<string, CompiledSketch> {
    return new Map(
      [...this.values].map(([value, trace]) => [
        trace.id,
        {
          ...this.runtime.snapshotSketch(value, sketch =>
            this.identity(sketch),
          ),
          definitionRef: trace.definitionRef,
          references: trace.references,
        },
      ]),
    );
  }
}

function sourceKey(ref: SourceRef): string {
  return `${ref.file}:${ref.start}:${ref.end}`;
}

function nodeRef(node: ts.Node): SourceRef {
  return {
    file: node.getSourceFile().fileName,
    start: node.getStart(),
    end: node.end,
  };
}

function nodeKey(node: ts.Node): string {
  return sourceKey(nodeRef(node));
}
