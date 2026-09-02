import ts from "@typescript/typescript6";
import {
  authoringApi,
  disposeModelObjects,
  isModelObject,
  type ModelSnapshotObject,
  type ModelObject,
} from "./runtime";

export type ModelModule = Readonly<{
  root: ModelSnapshotObject;
  exports: ReadonlyMap<string, string>;
}>;

export class CompileFailure extends Error {
  readonly start?: number;
  readonly length?: number;

  constructor(message: string, start?: number, length?: number) {
    super(message);
    this.name = "CompileFailure";
    this.start = start;
    this.length = length;
  }
}

type CommonJsModule = {
  exports: Record<string, unknown>;
};

const tracedObjects = new Set<ModelObject>();
const traceRuntime = Object.freeze({
  trace<T>(start: number, end: number, run: () => T): T {
    const result = run();
    if (isModelObject(result)) {
      result.attachSource({ start, end });
      tracedObjects.add(result);
    }
    return result;
  },
});

export function compileModel(source: string): ModelModule {
  tracedObjects.clear();
  const result = ts.transpileModule(source, {
    fileName: "model.ts",
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
      strict: true,
      isolatedModules: true,
    },
    reportDiagnostics: true,
    transformers: {
      before: [createTraceTransformer()],
    },
  });

  const errors = (result.diagnostics ?? []).filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
  );
  if (errors.length > 0) {
    throw diagnosticFailure(errors[0]);
  }

  const module: CommonJsModule = { exports: {} };
  const requireModule = (specifier: string): unknown => {
    if (specifier === "code3d") {
      return authoringApi;
    }
    throw new Error(`prototype 暂不支持导入模块：${specifier}`);
  };

  const execute = new Function(
    "require",
    "module",
    "exports",
    "__code3d",
    `"use strict";\n${result.outputText}\n//# sourceURL=code3d-model.js`,
  );

  try {
    execute(requireModule, module, module.exports, traceRuntime);

    const root = module.exports.default;
    if (!isModelObject(root)) {
      throw new Error("模型模块必须 default export 一个 ModelObject。");
    }

    const modelExports = new Map<string, ModelObject>();
    for (const [name, value] of Object.entries(module.exports)) {
      if (isModelObject(value)) {
        modelExports.set(name, value);
      }
    }

    return {
      root: root.toSnapshot(),
      exports: new Map(
        [...modelExports].map(([name, modelObject]) => [name, modelObject.nodeId]),
      ),
    };
  } finally {
    disposeModelObjects(tracedObjects);
    tracedObjects.clear();
  }
}

function createTraceTransformer(): ts.TransformerFactory<ts.SourceFile> {
  return (context) => {
    const { factory } = context;

    return (sourceFile) => {
      const visit: ts.Visitor = (node) => {
        const visited = ts.visitEachChild(node, visit, context);
        if (!ts.isCallExpression(visited) || !isTraceableCall(node, sourceFile)) {
          return visited;
        }

        return factory.createCallExpression(
          factory.createPropertyAccessExpression(
            factory.createIdentifier("__code3d"),
            "trace",
          ),
          undefined,
          [
            factory.createNumericLiteral(node.getStart(sourceFile)),
            factory.createNumericLiteral(node.getEnd()),
            factory.createArrowFunction(
              undefined,
              undefined,
              [],
              undefined,
              factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
              visited,
            ),
          ],
        );
      };

      return ts.visitNode(sourceFile, visit) as ts.SourceFile;
    };
  };
}

function isTraceableCall(node: ts.Node, sourceFile: ts.SourceFile): boolean {
  if (!ts.isCallExpression(node)) {
    return false;
  }
  if (node.expression.kind === ts.SyntaxKind.SuperKeyword) {
    return false;
  }

  let traceable = true;
  const inspect = (child: ts.Node): void => {
    if (
      child !== node &&
      (ts.isAwaitExpression(child) || child.kind === ts.SyntaxKind.YieldExpression)
    ) {
      traceable = false;
      return;
    }
    ts.forEachChild(child, inspect);
  };
  ts.forEachChild(node, inspect);

  return traceable && node.getStart(sourceFile) >= 0;
}

function diagnosticFailure(diagnostic: ts.Diagnostic): CompileFailure {
  return new CompileFailure(
    ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
    diagnostic.start,
    diagnostic.length,
  );
}
