import {createTransformationInsertions} from '../tools/source-expression';
import type {TransformationInsertion} from '../tools/source-expression';
import {
  type RelationPreview,
  type RelationSpatialReference,
  type EdgeId,
  type ElementKind,
  type ElementSnapshot,
  type ModelOperationInputRole,
  type ModelOperationKind,
  type ModelOperationSnapshot,
  type ModelSnapshotObject,
  type ParameterKind,
  type ParameterUsage,
  type SourceRef,
  type TopologyId,
  type TopologyKind,
  type Transform,
} from '@code3d/core/tooling';
import ts from '@typescript/typescript6';
import {
  identifyCachedCall,
  type CachedDefinitions,
} from '../project/cached-definitions';
import {normalizeProjectPath, type ModelProject} from '../project/project';
import {ProjectBuilder, type ProjectBundle} from '../project/project-builder';
import {code3dAnnotations} from './annotations';
import {argumentExpression, unwrapArgument} from './argument-path';
import {
  designArgumentAnnotationSites,
  designFunctionsIn,
} from './design-functions';
import {
  createModelDiagnostic,
  ModelDiagnosticError,
  type ModelDiagnostic,
  type ModelDiagnosticKind,
} from './diagnostic';
import {executableModuleSource} from './executable-module';
import {type CompiledSketch} from './sketch-trace';
import {isToolSelectionParameter} from './tool-parameter-config';
import {
  resolveProjectTooling,
  sourceNodeKey,
  toolCallKey,
  type ParameterDefinitionMap,
  type SourceParameterTarget,
  type ToolArgumentSource,
  type ToolCallSchemaMap,
  type ToolSignatureSchema,
} from './tool-schema';

import {sketchSourceSites, type SketchSourceSites} from './sketch-source';
import {sameSourceRef, sourceRef} from './source-location';
export type TopologyValueReference = Readonly<{
  nodeId: string;
  name: string;
  geometryNodeId: string;
  transform: Transform;
}> &
  ({kind: 'solid'} | {kind: TopologyKind; id: TopologyId});

export type AnchorValueReference = Readonly<{
  bound?: ElementSnapshot['bound'];
  facing?: 1 | -1;
  direction?: 1 | -1;
  nodeId: string;
  name: string;
  kind: ElementKind;
  transform: Transform;
}>;

export type TopologySelectionScope = Readonly<{
  geometryNodeId: string;
  transform: Transform;
  availableIds: readonly TopologyId[];
}>;

export type SourceTargetEvaluation = Readonly<{
  sketchIds?: readonly string[];
  /** A container's members share relation placement, unlike a single value. */
  isCollection?: boolean;
  topologyReferences?: readonly TopologyValueReference[];
  anchorReferences?: readonly AnchorValueReference[];
  runtime: RuntimeReach;
  toolExecutionOrder?: number;
  nodeIds: readonly string[];
  /** Referenced values before relation participants expand the rendered context. */
  valueNodeIds?: readonly string[];
  /** Models to emphasize while their composition peers remain visible. */
  focusNodeIds?: readonly string[];
  parameters?: readonly ParameterUsage[];
  toolArguments?: Readonly<Record<number, number>>;
  operationId?: string;
  /** The consuming operation is independent of the operation being edited. */
  operationInput?: Readonly<{
    operationId: string;
    role: ModelOperationInputRole;
    nodeIds: readonly string[];
  }>;
  constraintId?: string;
  transformationId?: string;
  relationOwnerNodeId?: string;
  /** Completed relate call: only constraints and references added by this call. */
  relationContext?: Readonly<{
    constraintIds: readonly string[];
    referenceNodeIds: readonly string[];
  }>;
  /** Chain operations focus self; relation receiver/argument scopes identify a side. */
  constraintFocus?: 'self' | 'source' | 'target';
  relationSpatial?: RelationSpatialReference;
  relationPreview?: RelationPreview['object'];
  relationPreviewDiagnostic?: ModelDiagnostic;
  contextId: string;
  element?: AnchorValueReference;
  selection?:
    | Readonly<{
        kind: 'edges';
        inputNodeId: string;
        ids: readonly EdgeId[];
        scope?: TopologySelectionScope;
      }>
    | Readonly<{
        kind: TopologyKind;
        inputNodeId: string;
        ids: readonly TopologyId[];
        scope?: TopologySelectionScope;
      }>;
}>;

export type RuntimeReach = Readonly<{
  order: number;
  outcome: 'completed' | 'failed';
}>;

export type EdgeArgumentTarget = Readonly<
  | {
      kind: 'replace';
      sourceRef: SourceRef;
      removalSourceRef: SourceRef;
    }
  | {kind: 'append'; sourceRef: SourceRef; needsComma: boolean}
>;

export type SourceTarget = Readonly<{
  id: string;
  kind:
    | 'value'
    | 'constraint'
    | 'transformation'
    | 'element'
    | 'tool'
    | 'topology-selection'
    | 'operation-input'
    | 'operation-output'
    | 'operation-selection';
  sourceRef: SourceRef;
  receiverRef?: SourceRef;
  /** Interior of this call parameter list; excludes the method/selector name. */
  argumentListRef?: SourceRef;
  /** Complete authored call, including a fluent receiver. */
  callRef?: SourceRef;
  /** Authored reference chain, available even before its arguments/rotation complete. */
  rotationSelection?: Readonly<{
    sourceRef: SourceRef;
    selector:
      'pivot' | 'pivotVertex' | 'pivotPoint' | 'aroundEdge' | 'aroundLine';
    constructors?: SourceTarget['transformationInsertion'];
    reference: string;
    calls: readonly Pick<
      ToolCallSite,
      'siteId' | 'sourceRef' | 'argumentListRef' | 'signature' | 'arguments'
    >[];
  }>;
  /** Blank range in a directly returned relate array; its value is the callback self. */
  relationArray?: SourceRef;
  /** Completed rotation owning this selector's interaction. */
  rotationToolId?: string;
  /** Selector targets shown together with this rotation's numeric parameters. */
  rotationSelectorIds?: readonly string[];
  functionId?: string;
  evaluations: readonly SourceTargetEvaluation[];
  contextTargetIds: readonly string[];
  transformationInsertion?: Readonly<
    Partial<
      Record<
        import('../tools/source-expression').TransformationConstructor,
        TransformationInsertion
      >
    >
  >;
  tool?: Readonly<{
    callId: string;
    signature: ToolSignatureSchema;
    arguments: readonly ToolArgumentSource[];
  }>;
  operation?: Readonly<{
    kind: ModelOperationKind;
    role?: ModelOperationInputRole;
    edgeArgument?: EdgeArgumentTarget;
  }>;
}>;

export type EvaluationContext = Readonly<{
  id: string;
  kind: 'call' | 'design';
  label: string;
  sourceRef: SourceRef;
}>;

export type DesignArgumentContext = Readonly<{
  id: string;
  functionId: string;
  functionName: string;
  label: string;
  functionRef: SourceRef;
  annotationRef: SourceRef;
  argumentsRef: SourceRef;
  signature: Readonly<{
    typeParametersSource: string;
    parametersSource: string;
  }>;
}>;

export type DesignInvocation = Readonly<{
  file: string;
  offset: number;
  arguments?: string;
}>;
/** Every explicit design request identifies its source, including GUI presets. */
export type DesignContext =
  Readonly<{file: string; id: string}> | DesignInvocation;
type ActiveDesignContext = Pick<
  DesignArgumentContext,
  'id' | 'functionId' | 'label' | 'functionRef'
> &
  Readonly<{callRef: SourceRef; binding: string; argumentsSource: string}>;

export type ObjectCatalogOccurrence = Readonly<{
  id: string;
  nodeId: string;
  label: string;
  sourceRef: SourceRef;
  execution: number;
  output: number;
  order: number;
}>;

export type ObjectCatalogEntry = Readonly<{
  id: string;
  label: string;
  category: 'binding' | 'export' | 'expression';
  scope: 'module' | 'local';
  visibility: 'primary' | 'lineage';
  sourceRef: SourceRef;
  nodeIds: readonly string[];
  occurrences: readonly ObjectCatalogOccurrence[];
  executions: number;
  firstOrder: number;
  lastOrder: number;
  exportNames: readonly string[];
}>;

export type ModelModule = Readonly<{
  sketches: ReadonlyMap<string, CompiledSketch>;
  warnings: readonly ModelDiagnostic[];
  diagnostic?: ModelDiagnostic;
  fallback?: ModelSnapshotObject;
  objects: ReadonlyMap<string, ModelSnapshotObject>;
  operations: ReadonlyMap<string, ModelOperationSnapshot>;
  toolNodeIds: ReadonlySet<string>;
  exports: ReadonlyMap<string, string>;
  catalog: readonly ObjectCatalogEntry[];
  sourceTargets: readonly SourceTarget[];
  evaluationContexts: readonly EvaluationContext[];
  designArguments: readonly DesignArgumentContext[];
  activeDesignContextId?: string;
}>;

type ParsedDesignArgumentContext = DesignArgumentContext &
  Readonly<{
    binding: string;
    argumentsSource: string;
  }>;

type ParameterArgument = Readonly<{
  path: readonly number[];
  name: string;
  label: string;
  kind: ParameterKind;
}>;

type CallParameterTarget = SourceParameterTarget &
  Readonly<{kind: ParameterKind}>;

type ParameterSignature = Readonly<{
  operation: string;
  arguments: readonly ParameterArgument[];
}>;

export type EdgeSelectionSite = Readonly<{
  siteId: string;
  operation: 'fillet' | 'chamfer';
  sourceRef: SourceRef;
  edgeArgument: EdgeArgumentTarget;
}>;

export type ToolCallSite = Readonly<{
  argumentListRef: SourceRef;
  relationPredecessors?: readonly SourceRef[];
  rotationReceivers?: readonly (SourceRef & {selectorStart: number})[];
  rotationSelection?: SourceTarget['rotationSelection'];
  transformationInsertion?: SourceTarget['transformationInsertion'];
  siteId: string;
  sourceRef: SourceRef;
  signature: ToolSignatureSchema;
  arguments: readonly ToolArgumentSource[];
}>;

type RelationCallSite = Readonly<{
  receiverRef: SourceRef;
  targetRef: SourceRef;
  transformationInsertion?: SourceTarget['transformationInsertion'];
}>;

type RelationArraySite = Readonly<{
  parameterId: string;
  sourceRef: SourceRef;
  gaps: readonly SourceRef[];
  insertion: NonNullable<SourceTarget['transformationInsertion']>;
}>;

export type CompiledModelSource = Readonly<{
  source: string;
  rootPath: string;
  files: ReadonlyMap<string, string>;
  designArguments: readonly ParsedDesignArgumentContext[];
  activeDesignContext?: ActiveDesignContext;
  edgeSelectionSites: ReadonlyMap<string, EdgeSelectionSite>;
  toolCallSites: ReadonlyMap<string, ToolCallSite>;
  relationCallSites: ReadonlyMap<string, RelationCallSite>;
  relationArraySites: readonly RelationArraySite[];
  sketches: SketchSourceSites;
}>;

export function createModelCompiler() {
  const edgeSelectionSites = new Map<string, EdgeSelectionSite>();
  const toolCallSites = new Map<string, ToolCallSite>();
  const relationCallSites = new Map<string, RelationCallSite>();
  const relationArraySites: RelationArraySite[] = [];
  async function compileProject(
    project: ModelProject,
    rootModulePath: string,
    builder: ProjectBuilder,
    runtimeFormats: ReadonlyMap<string, 'esm' | 'cjs'>,
    program: ts.Program,
    sourceGraph: ProjectBundle,
    requestedDesignContext?: DesignContext,
    checkCancelled: () => void = () => {},
  ): Promise<CompiledModelSource> {
    edgeSelectionSites.clear();
    toolCallSites.clear();
    relationCallSites.clear();
    relationArraySites.length = 0;
    checkCancelled();
    const files = new Map(
      project.files.map(file => [normalizeProjectPath(file.path), file.source]),
    );
    const designArguments = [...files].flatMap(([path, source]) =>
      parseDesignArgumentContexts(path, source),
    );
    const tooling = resolveProjectTooling(project, program);
    const activeDesignContext = selectDesignContext(
      project,
      designArguments,
      requestedDesignContext,
    );
    const rootPath = normalizeProjectPath(rootModulePath);
    if (!files.has(rootPath)) {
      throw modelFailure(
        'project',
        `Project file not found: ${rootModulePath}`,
      );
    }
    const paths = [
      ...new Set([
        rootPath,
        ...(activeDesignContext ? [activeDesignContext.functionRef.file] : []),
      ]),
    ];
    const entrySource =
      paths
        .map(
          (path, index) =>
            `import * as source${index} from ${JSON.stringify(path)};`,
        )
        .join('\n') +
      `\nexport const modules = new Map([${paths
        .map((path, index) => `[${JSON.stringify(path)}, source${index}]`)
        .join(',')}]);`;
    const bundle = await builder.build(entrySource, {
      slot: 'model',
      runtimeFiles: new Map([
        ...[...sourceGraph.formats].filter(([path]) =>
          path.includes('/node_modules/'),
        ),
        ...runtimeFormats,
      ]),
      captureModules: sourceGraph.formats,
      lazyPackages: sourceGraph.sourcePackages,
      transform: (path, source, cached) =>
        transformSource(
          path,
          source,
          tooling.toolCalls.get(path),
          tooling.parameterDefinitions.get(path),
          cached,
          activeDesignContext?.functionRef.file === path
            ? activeDesignContext
            : undefined,
        ),
    });

    checkCancelled();
    return {
      source: executableModuleSource(
        'code3d-project:/model.js',
        bundle.source,
        [
          '__code3d',
          '__code3dAssetUrl',
          '__code3dCachedFunction',
          '__code3dModules',
          '__code3dImport',
          '__code3dImportDependencies',
          '__code3dRecordModule',
        ],
      ),
      rootPath,
      files,
      designArguments,
      activeDesignContext,
      edgeSelectionSites: new Map(edgeSelectionSites),
      toolCallSites: new Map(toolCallSites),
      relationCallSites: new Map(relationCallSites),
      relationArraySites: [...relationArraySites],
      sketches: sketchSourceSites(tooling.program, files),
    };
  }
  function parseDesignArgumentContexts(
    path: string,
    source: string,
  ): ParsedDesignArgumentContext[] {
    const normalizedPath = normalizeProjectPath(path);
    const sourceFile = ts.createSourceFile(
      normalizedPath,
      source,
      ts.ScriptTarget.Latest,
      true,
    );
    const contexts: ParsedDesignArgumentContext[] = [];
    const consumedAnnotations = new Set<number>();

    for (const {
      annotation,
      designFunction,
      signature,
      index,
    } of designArgumentAnnotationSites(source, sourceFile)) {
      const functionId = `${normalizedPath}:function:${designFunction.name}`;
      consumedAnnotations.add(annotation.start);
      const argumentsRef = sourceRef(
        normalizedPath,
        annotation.valueStart,
        annotation.valueEnd,
      );
      const argumentsExpression = parseDesignArgumentsExpression(
        annotation.value,
        argumentsRef,
      );
      validateDesignArgumentCount(
        argumentsExpression,
        signature.parameters,
        argumentsRef,
      );
      contexts.push({
        id: `${functionId}:arguments:${index}`,
        functionId,
        functionName: designFunction.name,
        label: designArgumentsLabel(annotation.value),
        functionRef: sourceRef(
          normalizedPath,
          designFunction.signatures[0].statement.getFullStart(),
          designFunction.node.getEnd(),
        ),
        annotationRef: sourceRef(
          normalizedPath,
          annotation.start,
          annotation.valueEnd,
        ),
        argumentsRef,
        signature: {
          typeParametersSource:
            signature.typeParameters.length === 0
              ? ''
              : `<${signature.typeParameters
                  .map(parameter => parameter.getText(sourceFile))
                  .join(', ')}>`,
          parametersSource: signature.parameters
            .map(parameter => parameter.getText(sourceFile))
            .join(', '),
        },
        binding: designFunction.name,
        argumentsSource: annotation.value,
      });
    }

    const misplaced = code3dAnnotations(source).find(
      annotation =>
        annotation.name === 'arguments' &&
        !consumedAnnotations.has(annotation.start),
    );
    if (misplaced) {
      throw modelFailure(
        'syntax',
        '@code3d.arguments must annotate a named module-level function.',
        sourceRef(normalizedPath, misplaced.start, misplaced.end),
      );
    }
    return contexts;
  }

  function parseDesignArgumentsExpression(
    source: string,
    sourceRef: SourceRef,
  ): ts.ArrayLiteralExpression {
    const prefix = 'const __code3dArguments = (';
    const parsed = ts.createSourceFile(
      sourceRef.file,
      `${prefix}${source});`,
      ts.ScriptTarget.Latest,
      true,
    );
    const parseDiagnostics = (
      parsed as ts.SourceFile & {parseDiagnostics: readonly ts.Diagnostic[]}
    ).parseDiagnostics;
    const error = parseDiagnostics.find(
      diagnostic => diagnostic.category === ts.DiagnosticCategory.Error,
    );
    if (error) {
      const relativeStart = Math.max(
        0,
        (error.start ?? prefix.length) - prefix.length,
      );
      throw modelFailure(
        'syntax',
        ts.flattenDiagnosticMessageText(error.messageText, '\n'),
        {
          file: sourceRef.file,
          start: sourceRef.start + relativeStart,
          end: sourceRef.start + relativeStart + (error.length ?? 1),
        },
      );
    }
    const statement = parsed.statements[0];
    const declaration =
      statement && ts.isVariableStatement(statement)
        ? statement.declarationList.declarations[0]
        : undefined;
    const expression = declaration?.initializer;
    const argumentsExpression =
      expression && ts.isParenthesizedExpression(expression)
        ? expression.expression
        : expression;
    if (
      !argumentsExpression ||
      !ts.isArrayLiteralExpression(argumentsExpression)
    ) {
      throw modelFailure(
        'syntax',
        '@code3d.arguments requires an array expression.',
        sourceRef,
      );
    }
    return argumentsExpression;
  }

  function selectDesignContext(
    project: ModelProject,
    contexts: readonly ParsedDesignArgumentContext[],
    requested?: DesignContext,
  ): ActiveDesignContext | undefined {
    if (!requested) return undefined;
    if ('id' in requested) {
      const context = contexts.find(
        context =>
          context.id === requested.id &&
          context.functionRef.file === requested.file,
      );
      return context && {...context, callRef: context.annotationRef};
    }
    const file = project.files.find(file => file.path === requested.file);
    if (!file)
      throw modelFailure('project', 'Design invocation file does not exist.');
    const parsed = ts.createSourceFile(
      file.path,
      file.source,
      ts.ScriptTarget.Latest,
      true,
    );
    const owner = designFunctionsIn(parsed).find(
      fn =>
        fn.node.getFullStart() <= requested.offset &&
        requested.offset <= fn.node.getEnd(),
    );
    if (!owner) {
      if (requested.arguments !== undefined)
        throw modelFailure(
          'syntax',
          'Temporary arguments require a named module-level function.',
          sourceRef(file.path, requested.offset, requested.offset),
        );
      return undefined;
    }
    const functionId = `${file.path}:function:${owner.name}`;
    if (requested.arguments === undefined) {
      const preset = contexts.find(
        context => context.functionId === functionId,
      );
      return preset && {...preset, callRef: preset.annotationRef};
    }
    const callRef = sourceRef(file.path, requested.offset, requested.offset);
    const expression = parseDesignArgumentsExpression(
      requested.arguments,
      callRef,
    );
    validateDesignArgumentCount(
      expression,
      owner.signatures.at(-1)!.parameters,
      callRef,
    );
    return {
      id: `${functionId}:temporary`,
      functionId,
      label: 'Temporary arguments',
      functionRef: sourceRef(
        file.path,
        owner.node.getFullStart(),
        owner.node.getEnd(),
      ),
      callRef,
      binding: owner.name,
      argumentsSource: requested.arguments,
    };
  }

  function validateDesignArgumentCount(
    argumentsExpression: ts.ArrayLiteralExpression,
    parameters: readonly ts.ParameterDeclaration[],
    sourceRef: SourceRef,
  ): void {
    if (
      argumentsExpression.elements.some(ts.isSpreadElement) ||
      parameters.some(parameter => parameter.dotDotDotToken)
    ) {
      return;
    }
    const required = parameters.filter(
      parameter => !parameter.questionToken && !parameter.initializer,
    ).length;
    const count = argumentsExpression.elements.length;
    if (required <= count && count <= parameters.length) return;
    const expected =
      required === parameters.length
        ? String(required)
        : `${required}–${parameters.length}`;
    throw modelFailure(
      'evaluation',
      `@code3d.arguments provides ${count} arguments; ${expected} expected.`,
      sourceRef,
    );
  }

  function designArgumentsLabel(source: string): string {
    const trimmed = source.trim();
    return trimmed.slice(1, -1).trim() || 'no arguments';
  }

  function transformSource(
    path: string,
    source: string,
    toolCalls: ToolCallSchemaMap | undefined,
    parameterDefinitions: ParameterDefinitionMap | undefined,
    cached: CachedDefinitions,
    designContext?: ActiveDesignContext,
  ): string {
    const executableSource = designContext
      ? `${source}\n${designEvaluationSource(designContext)}\n`
      : source;
    const parsed = ts.createSourceFile(
      path,
      executableSource,
      ts.ScriptTarget.Latest,
      true,
    );
    const result = ts.transform(parsed, [
      createTraceTransformer(
        source.length,
        toolCalls,
        parameterDefinitions ?? new Map(),
        cached,
      ),
    ]);
    try {
      return ts.createPrinter().printFile(result.transformed[0]);
    } finally {
      result.dispose();
    }
  }

  function designEvaluationSource(context: ActiveDesignContext): string {
    return `__code3d.design(${JSON.stringify(context.functionRef.file)}, ${context.functionRef.start}, ${context.functionRef.end}, ${context.callRef.start}, ${context.callRef.end}, ${JSON.stringify(context.id)}, ${JSON.stringify(context.functionId)}, ${JSON.stringify(context.label)}, () => ${context.binding}(...(${context.argumentsSource})));`;
  }

  function createTraceTransformer(
    authorSourceLength: number,
    toolCalls: ToolCallSchemaMap | undefined,
    parameterDefinitions: ParameterDefinitionMap,
    cached: CachedDefinitions,
  ): ts.TransformerFactory<ts.SourceFile> {
    return context => {
      const {factory} = context;

      return sourceFile => {
        const insertions = createTransformationInsertions(sourceFile);
        const rotationSelection = (
          node: ts.CallExpression,
        ): SourceTarget['rotationSelection'] => {
          const nameOf = (call: ts.CallExpression) =>
            toolCalls?.get(toolCallKey(call.getStart(sourceFile), call.end))
              ?.name;
          let first = node;
          while (
            ['rotate', 'pivotOffset', 'axisOffset'].includes(
              nameOf(first) ?? '',
            ) &&
            ts.isPropertyAccessExpression(first.expression)
          ) {
            const receiver = unwrapArgument(first.expression.expression);
            if (!ts.isCallExpression(receiver)) return undefined;
            first = receiver;
          }
          const selector = nameOf(first);
          if (
            selector !== 'pivot' &&
            selector !== 'pivotVertex' &&
            selector !== 'pivotPoint' &&
            selector !== 'aroundEdge' &&
            selector !== 'aroundLine'
          )
            return undefined;
          const calls = [first];
          let last: ts.Expression = first;
          while (true) {
            const parent = last.parent;
            if (
              ts.isParenthesizedExpression(parent) ||
              ts.isAsExpression(parent) ||
              ts.isSatisfiesExpression(parent)
            ) {
              last = parent;
            } else if (
              ts.isPropertyAccessExpression(parent) &&
              ts.isCallExpression(parent.parent) &&
              ['pivotOffset', 'axisOffset', 'rotate'].includes(
                nameOf(parent.parent) ?? '',
              )
            ) {
              last = parent.parent;
              calls.push(parent.parent);
              if (nameOf(parent.parent) === 'rotate') break;
            } else break;
          }
          return {
            selector,
            sourceRef: sourceRef(
              sourceFile.fileName,
              last.getStart(sourceFile),
              last.end,
            ),
            constructors: insertions(last),
            reference: first.arguments
              .map(argument => argument.getText(sourceFile))
              .join(', '),
            calls: calls.map(call =>
              toolCallSite(
                call,
                stableSourceId('expression', call, sourceFile),
                toolCalls!.get(
                  toolCallKey(call.getStart(sourceFile), call.end),
                )!,
                sourceFile,
              ),
            ),
          };
        };
        const visit: ts.Visitor = node => {
          if (
            !ts.isSourceFile(node) &&
            node.getStart(sourceFile) >= authorSourceLength
          ) {
            return node;
          }
          const visited = identifyCachedCall(
            node,
            ts.visitEachChild(node, visit, context),
            cached,
            factory,
          );
          // A standalone value expression is a concrete use site, including a
          // sketch reference. Calls already record their returned value. Keep
          // directive prologues and control-flow-sensitive expressions intact.
          if (
            ts.isExpressionStatement(node) &&
            ts.isExpressionStatement(visited) &&
            !ts.isCallExpression(node.expression) &&
            !ts.isStringLiteral(node.expression) &&
            isTraceableExpression(node.expression, sourceFile)
          ) {
            return factory.updateExpressionStatement(
              visited,
              bindExpression(
                visited.expression,
                node.expression.getStart(sourceFile),
                node.expression.getEnd(),
                sourceFile.fileName,
                stableSourceId('value', node.expression, sourceFile),
                node.expression.getText(sourceFile),
                'expression',
                ts.isSourceFile(node.parent) ? 'module' : 'local',
                factory,
              ),
            );
          }
          if (
            ts.isFunctionLike(node) &&
            ts.isFunctionLike(visited) &&
            'body' in node &&
            node.body &&
            'body' in visited &&
            visited.body
          ) {
            const parameters = parameterValueStatements(
              node.parameters,
              node.body,
              sourceFile,
              factory,
            );
            if (parameters.length > 0) {
              const body = visited.body;
              const statements = ts.isBlock(body)
                ? [...body.statements]
                : [factory.createReturnStatement(body)];
              // Directive prologues must remain at the beginning of the function.
              let insertion = 0;
              while (insertion < statements.length) {
                const statement = statements[insertion];
                if (
                  !ts.isExpressionStatement(statement) ||
                  !ts.isStringLiteral(statement.expression)
                )
                  break;
                insertion++;
              }
              statements.splice(insertion, 0, ...parameters);
              const tracedBody = factory.createBlock(statements, true);
              return ts.visitEachChild(
                visited,
                child => (child === body ? tracedBody : child),
                context,
              );
            }
          }
          if (
            ts.isVariableDeclaration(node) &&
            ts.isVariableDeclaration(visited) &&
            node.initializer &&
            visited.initializer &&
            isTraceableExpression(node.initializer, sourceFile)
          ) {
            const scope = isModuleVariableDeclaration(node)
              ? 'module'
              : 'local';
            const label = node.name.getText(sourceFile);
            const id =
              scope === 'module' && ts.isIdentifier(node.name)
                ? `${sourceFile.fileName}:binding:${node.name.text}`
                : `${stableSourceId('binding', node, sourceFile)}:${label}`;
            return factory.updateVariableDeclaration(
              visited,
              visited.name,
              visited.exclamationToken,
              visited.type,
              bindExpression(
                visited.initializer,
                node.name.getStart(sourceFile),
                node.initializer.getEnd(),
                sourceFile.fileName,
                id,
                label,
                'binding',
                scope,
                factory,
              ),
            );
          }

          if (
            ts.isExportAssignment(node) &&
            ts.isExportAssignment(visited) &&
            !node.isExportEquals &&
            isTraceableExpression(node.expression, sourceFile)
          ) {
            return factory.updateExportAssignment(
              visited,
              visited.modifiers,
              bindExpression(
                visited.expression,
                node.expression.getStart(sourceFile),
                node.expression.getEnd(),
                sourceFile.fileName,
                `${sourceFile.fileName}:export:default`,
                'default',
                'export',
                'module',
                factory,
              ),
            );
          }

          if (
            ts.isCallExpression(node) &&
            ts.isCallExpression(visited) &&
            isTraceableCall(node, sourceFile) &&
            !continuesOptionalChain(node)
          ) {
            const siteId = stableSourceId('expression', node, sourceFile);
            const transformationInsertion = insertions(node);
            const relationSite = relationCallSite(node, sourceFile);
            if (relationSite)
              relationCallSites.set(siteId, {
                ...relationSite,
                transformationInsertion,
              });
            const toolSignature = toolCalls?.get(
              toolCallKey(node.getStart(sourceFile), node.getEnd()),
            );
            if (toolSignature) {
              const rotationReceivers: (SourceRef & {selectorStart: number})[] =
                [];
              let receiver: ts.Expression = node.expression;
              while (
                toolSignature.name === 'rotate' &&
                ts.isPropertyAccessExpression(receiver)
              ) {
                const call = unwrapArgument(receiver.expression);
                if (!ts.isCallExpression(call)) break;
                rotationReceivers.push({
                  ...sourceRef(
                    sourceFile.fileName,
                    call.getStart(sourceFile),
                    call.end,
                  ),
                  selectorStart: callSourceStart(call, sourceFile),
                });
                receiver = call.expression;
              }
              toolCallSites.set(siteId, {
                ...toolCallSite(node, siteId, toolSignature, sourceFile),
                rotationSelection: rotationSelection(node),
                relationPredecessors: relationArrayPredecessors(
                  node,
                  sourceFile,
                ),
                transformationInsertion,
                rotationReceivers: rotationReceivers.length
                  ? rotationReceivers
                  : undefined,
              });
            }
            const edgeSelection = edgeSelectionSite(node, siteId, sourceFile);
            if (edgeSelection) {
              edgeSelectionSites.set(siteId, edgeSelection);
            }
            const parameterSignature = toolSignature
              ? parameterSignatureFor(toolSignature)
              : undefined;
            const parameterizedCall = parameterSignature
              ? instrumentCallParameters(
                  node,
                  visited,
                  parameterSignature,
                  parameterDefinitions,
                  sourceFile,
                  factory,
                )
              : visited;
            const callWithInputs = instrumentCallInputs(
              node,
              parameterizedCall,
              siteId,
              sourceFile,
              factory,
            );
            const call = instrumentCallArguments(
              callWithInputs,
              siteId,
              factory,
            );

            return traceExpression(
              call,
              node.getStart(sourceFile),
              node.getEnd(),
              callSourceStart(node, sourceFile),
              node.getEnd(),
              sourceFile.fileName,
              siteId,
              callLabel(node),
              factory,
            );
          }

          if (
            ts.isPropertyAccessExpression(node) &&
            ts.isPropertyAccessExpression(visited) &&
            !ts.isMetaProperty(node.expression) &&
            !continuesOptionalChain(node) &&
            isReadablePropertyAccess(node)
          ) {
            return traceElementExpression(node, visited, sourceFile, factory);
          }

          return visited;
        };

        return ts.visitNode(sourceFile, visit) as ts.SourceFile;
      };
    };
  }

  function parameterValueStatements(
    parameters: readonly ts.ParameterDeclaration[],
    body: ts.ConciseBody,
    sourceFile: ts.SourceFile,
    factory: ts.NodeFactory,
  ): ts.Statement[] {
    const statements: ts.Statement[] = [];
    const callback = body.parent;
    const call = callback.parent;
    const self = parameters[0]?.name;
    if (
      self &&
      ts.isIdentifier(self) &&
      ts.isCallExpression(call) &&
      ts.isPropertyAccessExpression(call.expression) &&
      call.expression.name.text === 'relate' &&
      call.arguments[0] === callback
    ) {
      const arrays: ts.ArrayLiteralExpression[] = [];
      const returned = (expression: ts.Expression) => {
        const value = unwrapArgument(expression);
        if (ts.isArrayLiteralExpression(value)) arrays.push(value);
      };
      const visitReturn = (node: ts.Node) => {
        if (ts.isFunctionLike(node)) return;
        if (ts.isReturnStatement(node) && node.expression)
          returned(node.expression);
        else ts.forEachChild(node, visitReturn);
      };
      if (ts.isBlock(body)) visitReturn(body);
      else returned(body);
      const insertions = createTransformationInsertions(sourceFile);
      for (const array of arrays) {
        let start = array.getStart(sourceFile) + 1;
        const gaps: SourceRef[] = [];
        for (const element of array.elements) {
          gaps.push(
            sourceRef(sourceFile.fileName, start, element.getStart(sourceFile)),
          );
          start = element.end;
        }
        gaps.push(sourceRef(sourceFile.fileName, start, array.end - 1));
        relationArraySites.push({
          parameterId: stableSourceId('parameter', self, sourceFile),
          sourceRef: sourceRef(
            sourceFile.fileName,
            array.getStart(sourceFile),
            array.end,
          ),
          gaps,
          insertion: insertions(array)!,
        });
      }
    }
    const capture = (name: ts.BindingName): void => {
      if (!ts.isIdentifier(name)) {
        name.elements.forEach(element => {
          if (ts.isBindingElement(element)) capture(element.name);
        });
        return;
      }
      if (name.text === 'this') return;
      statements.push(
        factory.createExpressionStatement(
          factory.createCallExpression(
            factory.createPropertyAccessExpression(
              factory.createIdentifier('__code3d'),
              'parameterValue',
            ),
            undefined,
            [
              factory.createStringLiteral(sourceFile.fileName),
              factory.createNumericLiteral(name.getStart(sourceFile)),
              factory.createNumericLiteral(name.getEnd()),
              factory.createNumericLiteral(body.getStart(sourceFile)),
              factory.createNumericLiteral(body.getEnd()),
              factory.createStringLiteral(
                stableSourceId('parameter', name, sourceFile),
              ),
              factory.createIdentifier(name.text),
            ],
          ),
        ),
      );
    };
    parameters.forEach(parameter => capture(parameter.name));
    return statements;
  }

  function edgeSelectionSite(
    node: ts.CallExpression,
    siteId: string,
    sourceFile: ts.SourceFile,
  ): EdgeSelectionSite | undefined {
    if (!ts.isPropertyAccessExpression(node.expression)) return undefined;
    const operation = node.expression.name.text;
    if (operation !== 'fillet' && operation !== 'chamfer') return undefined;
    const firstArgument = node.arguments[0];
    if (!firstArgument) return undefined;
    const edgeArgument = node.arguments[1];
    const closeParen = node.getEnd() - 1;
    return {
      siteId,
      operation,
      sourceRef: sourceRef(
        sourceFile.fileName,
        node.expression.name.getStart(sourceFile),
        node.getEnd(),
      ),
      edgeArgument: edgeArgument
        ? {
            kind: 'replace',
            sourceRef: sourceRef(
              sourceFile.fileName,
              edgeArgument.getStart(sourceFile),
              edgeArgument.getEnd(),
            ),
            removalSourceRef: sourceRef(
              sourceFile.fileName,
              firstArgument.getEnd(),
              closeParen,
            ),
          }
        : {
            kind: 'append',
            sourceRef: sourceRef(sourceFile.fileName, closeParen, closeParen),
            needsComma: !node.arguments.hasTrailingComma,
          },
    };
  }

  function instrumentCallArguments(
    call: ts.CallExpression,
    siteId: string,
    factory: ts.NodeFactory,
  ): ts.CallExpression {
    const argumentsWithTracing = call.arguments.map((argument, index) => {
      const value = ts.isSpreadElement(argument)
        ? argument.expression
        : argument;
      const traced = factory.createCallExpression(
        factory.createPropertyAccessExpression(
          factory.createIdentifier('__code3d'),
          'argument',
        ),
        undefined,
        [
          factory.createStringLiteral(siteId),
          factory.createNumericLiteral(index),
          value,
        ],
      );
      return ts.isSpreadElement(argument)
        ? factory.updateSpreadElement(argument, traced)
        : traced;
    });
    return updateCall(call, call.expression, argumentsWithTracing, factory);
  }

  function traceElementExpression(
    original: ts.PropertyAccessExpression,
    visited: ts.PropertyAccessExpression,
    sourceFile: ts.SourceFile,
    factory: ts.NodeFactory,
  ): ts.CallExpression {
    const id = stableSourceId('element', original.name, sourceFile);
    return factory.createCallExpression(
      factory.createPropertyAccessExpression(
        factory.createIdentifier('__code3d'),
        'element',
      ),
      undefined,
      [
        factory.createStringLiteral(sourceFile.fileName),
        factory.createNumericLiteral(original.name.getStart(sourceFile)),
        factory.createNumericLiteral(original.name.getEnd()),
        factory.createNumericLiteral(original.expression.getStart(sourceFile)),
        factory.createNumericLiteral(original.expression.getEnd()),
        factory.createStringLiteral(id),
        visited,
      ],
    );
  }

  function isReadablePropertyAccess(
    node: ts.PropertyAccessExpression,
  ): boolean {
    const {parent} = node;
    if (
      (ts.isCallExpression(parent) || ts.isNewExpression(parent)) &&
      parent.expression === node
    ) {
      return false;
    }
    if (ts.isTaggedTemplateExpression(parent) && parent.tag === node) {
      return false;
    }
    if (
      ts.isBinaryExpression(parent) &&
      parent.left === node &&
      parent.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      parent.operatorToken.kind <= ts.SyntaxKind.LastAssignment
    ) {
      return false;
    }
    if (
      (ts.isPrefixUnaryExpression(parent) ||
        ts.isPostfixUnaryExpression(parent)) &&
      (parent.operator === ts.SyntaxKind.PlusPlusToken ||
        parent.operator === ts.SyntaxKind.MinusMinusToken)
    ) {
      return false;
    }
    return !(ts.isDeleteExpression(parent) && parent.expression === node);
  }

  function continuesOptionalChain(node: ts.Node): boolean {
    const parent = node.parent;
    return (
      ts.isOptionalChain(node) &&
      ts.isOptionalChain(parent) &&
      (ts.isPropertyAccessExpression(parent) ||
        ts.isElementAccessExpression(parent) ||
        ts.isCallExpression(parent)) &&
      parent.expression === node
    );
  }

  function traceExpression(
    expression: ts.Expression,
    start: number,
    end: number,
    callStart: number,
    callEnd: number,
    file: string,
    id: string,
    label: string,
    factory: ts.NodeFactory,
  ): ts.CallExpression {
    return factory.createCallExpression(
      factory.createPropertyAccessExpression(
        factory.createIdentifier('__code3d'),
        'trace',
      ),
      undefined,
      [
        factory.createStringLiteral(file),
        factory.createNumericLiteral(start),
        factory.createNumericLiteral(end),
        factory.createNumericLiteral(callStart),
        factory.createNumericLiteral(callEnd),
        factory.createStringLiteral(id),
        factory.createStringLiteral(label),
        factory.createArrowFunction(
          undefined,
          undefined,
          [],
          undefined,
          factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
          expression,
        ),
      ],
    );
  }

  function relationCallSite(
    call: ts.CallExpression,
    sourceFile: ts.SourceFile,
  ) {
    const expression = call.expression;
    if (
      !ts.isPropertyAccessExpression(expression) &&
      !ts.isElementAccessExpression(expression)
    )
      return undefined;
    const name = ts.isPropertyAccessExpression(expression)
      ? expression.name.text
      : ts.isStringLiteral(expression.argumentExpression)
        ? expression.argumentExpression.text
        : undefined;
    if (name !== 'on' && name !== 'align') return undefined;
    return {
      receiverRef: sourceRef(
        sourceFile.fileName,
        expression.expression.getStart(sourceFile),
        expression.expression.getEnd(),
      ),
      targetRef: sourceRef(
        sourceFile.fileName,
        call.arguments.pos,
        call.getEnd() - 1,
      ),
    };
  }

  function callSourceStart(
    call: ts.CallExpression,
    sourceFile: ts.SourceFile,
  ): number {
    return ts.isPropertyAccessExpression(call.expression)
      ? call.expression.name.getStart(sourceFile)
      : ts.isElementAccessExpression(call.expression)
        ? call.expression.argumentExpression.getStart(sourceFile)
        : call.getStart(sourceFile);
  }

  function bindExpression(
    expression: ts.Expression,
    start: number,
    end: number,
    file: string,
    id: string,
    label: string,
    category: ObjectCatalogEntry['category'],
    scope: ObjectCatalogEntry['scope'],
    factory: ts.NodeFactory,
  ): ts.CallExpression {
    return factory.createCallExpression(
      factory.createPropertyAccessExpression(
        factory.createIdentifier('__code3d'),
        'bind',
      ),
      undefined,
      [
        factory.createStringLiteral(file),
        factory.createNumericLiteral(start),
        factory.createNumericLiteral(end),
        factory.createStringLiteral(id),
        factory.createStringLiteral(label),
        factory.createStringLiteral(category),
        factory.createStringLiteral(scope),
        factory.createArrowFunction(
          undefined,
          undefined,
          [],
          undefined,
          factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
          expression,
        ),
      ],
    );
  }

  function isModuleVariableDeclaration(node: ts.VariableDeclaration): boolean {
    const statement = node.parent.parent;
    return (
      ts.isVariableStatement(statement) && ts.isSourceFile(statement.parent)
    );
  }

  function stableSourceId(
    category: string,
    node: ts.Node,
    sourceFile: ts.SourceFile,
  ): string {
    const statement = topLevelStatement(node);
    const path: string[] = [];
    let current = node;
    while (current !== statement && current.parent) {
      const siblings: ts.Node[] = [];
      ts.forEachChild(current.parent, child => {
        siblings.push(child);
      });
      path.unshift(`${current.kind}-${siblings.indexOf(current)}`);
      current = current.parent;
    }
    return `${sourceFile.fileName}:${category}:${statementIdentity(statement, sourceFile)}:${path.join('/') || 'root'}`;
  }

  function topLevelStatement(node: ts.Node): ts.Node {
    let current = node;
    while (current.parent && !ts.isSourceFile(current.parent)) {
      current = current.parent;
    }
    return current;
  }

  function statementIdentity(
    statement: ts.Node,
    sourceFile: ts.SourceFile,
  ): string {
    if (ts.isVariableStatement(statement)) {
      const names = statement.declarationList.declarations.map(declaration =>
        declaration.name.getText(sourceFile).replace(/\s+/g, ''),
      );
      return `binding:${names.join(',')}`;
    }
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      return `function:${statement.name.text}`;
    }
    if (ts.isClassDeclaration(statement) && statement.name) {
      return `class:${statement.name.text}`;
    }
    if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
      return 'export:default';
    }
    const index = sourceFile.statements.indexOf(statement as ts.Statement);
    return `statement:${statement.kind}:${Math.max(index, 0)}`;
  }

  function callLabel(node: ts.CallExpression): string {
    if (ts.isIdentifier(node.expression)) {
      return node.expression.text;
    }
    if (ts.isPropertyAccessExpression(node.expression)) {
      return node.expression.name.text;
    }
    if (
      ts.isElementAccessExpression(node.expression) &&
      ts.isStringLiteralLike(node.expression.argumentExpression)
    ) {
      return node.expression.argumentExpression.text;
    }
    return 'call';
  }

  function instrumentCallInputs(
    original: ts.CallExpression,
    visited: ts.CallExpression,
    siteId: string,
    sourceFile: ts.SourceFile,
    factory: ts.NodeFactory,
  ): ts.CallExpression {
    let expression = visited.expression;
    const originalAccess = original.expression;
    if (
      (ts.isPropertyAccessExpression(originalAccess) ||
        ts.isElementAccessExpression(originalAccess)) &&
      (ts.isPropertyAccessExpression(expression) ||
        ts.isElementAccessExpression(expression)) &&
      originalAccess.expression.kind !== ts.SyntaxKind.SuperKeyword &&
      // Do not terminate the short-circuit boundary of an intermediate chain.
      !ts.isOptionalChain(originalAccess.expression)
    ) {
      const receiver = callInputExpression(
        expression.expression,
        originalAccess.expression,
        siteId,
        sourceFile,
        factory,
        'receiver',
      );
      expression = ts.isPropertyAccessExpression(expression)
        ? ts.isPropertyAccessChain(expression)
          ? factory.updatePropertyAccessChain(
              expression,
              receiver,
              expression.questionDotToken,
              expression.name,
            )
          : factory.updatePropertyAccessExpression(
              expression,
              receiver,
              expression.name,
            )
        : ts.isElementAccessChain(expression)
          ? factory.updateElementAccessChain(
              expression,
              receiver,
              expression.questionDotToken,
              expression.argumentExpression,
            )
          : factory.updateElementAccessExpression(
              expression,
              receiver,
              expression.argumentExpression,
            );
    }
    const args = visited.arguments.map((argument, index) =>
      instrumentInputValue(
        original.arguments[index],
        argument,
        siteId,
        sourceFile,
        factory,
      ),
    );
    return updateCall(visited, expression, args, factory);
  }

  function instrumentInputValue(
    original: ts.Expression,
    visited: ts.Expression,
    siteId: string,
    sourceFile: ts.SourceFile,
    factory: ts.NodeFactory,
  ): ts.Expression {
    const instrument = (
      before: ts.Expression,
      after: ts.Expression,
    ): ts.Expression =>
      instrumentInputValue(before, after, siteId, sourceFile, factory);
    if (ts.isOmittedExpression(visited)) return visited;
    if (ts.isSpreadElement(original) && ts.isSpreadElement(visited)) {
      return factory.updateSpreadElement(
        visited,
        instrument(original.expression, visited.expression),
      );
    }
    if (
      ts.isArrayLiteralExpression(original) &&
      ts.isArrayLiteralExpression(visited)
    ) {
      visited = factory.updateArrayLiteralExpression(
        visited,
        visited.elements.map((element, index) =>
          instrument(original.elements[index], element),
        ),
      );
    } else if (
      ts.isObjectLiteralExpression(original) &&
      ts.isObjectLiteralExpression(visited)
    ) {
      visited = factory.updateObjectLiteralExpression(
        visited,
        visited.properties.map((property, index) => {
          const before = original.properties[index];
          if (
            ts.isPropertyAssignment(before) &&
            ts.isPropertyAssignment(property)
          ) {
            return factory.updatePropertyAssignment(
              property,
              property.name,
              instrument(before.initializer, property.initializer),
            );
          }
          if (
            ts.isShorthandPropertyAssignment(before) &&
            ts.isShorthandPropertyAssignment(property)
          ) {
            return factory.createPropertyAssignment(
              property.name,
              instrument(before.name, property.name),
            );
          }
          if (
            ts.isSpreadAssignment(before) &&
            ts.isSpreadAssignment(property)
          ) {
            return factory.updateSpreadAssignment(
              property,
              instrument(before.expression, property.expression),
            );
          }
          return property;
        }),
      );
    }
    return callInputExpression(visited, original, siteId, sourceFile, factory);
  }

  function callInputExpression(
    expression: ts.Expression,
    original: ts.Expression,
    siteId: string,
    sourceFile: ts.SourceFile,
    factory: ts.NodeFactory,
    kind: 'input' | 'receiver' = 'input',
  ): ts.CallExpression {
    return factory.createCallExpression(
      factory.createPropertyAccessExpression(
        factory.createIdentifier('__code3d'),
        kind,
      ),
      undefined,
      [
        factory.createStringLiteral(sourceFile.fileName),
        factory.createNumericLiteral(original.getStart(sourceFile)),
        factory.createNumericLiteral(original.getEnd()),
        factory.createStringLiteral(siteId),
        factory.createStringLiteral(
          stableSourceId('input', original, sourceFile),
        ),
        expression,
      ],
    );
  }

  function updateCall(
    call: ts.CallExpression,
    expression: ts.Expression,
    args: readonly ts.Expression[],
    factory: ts.NodeFactory,
  ): ts.CallExpression {
    return ts.isCallChain(call)
      ? factory.updateCallChain(
          call,
          expression,
          call.questionDotToken,
          call.typeArguments,
          args,
        )
      : factory.updateCallExpression(
          call,
          expression,
          call.typeArguments,
          args,
        );
  }

  function instrumentCallParameters(
    original: ts.CallExpression,
    visited: ts.CallExpression,
    signature: ParameterSignature,
    parameterDefinitions: ParameterDefinitionMap,
    sourceFile: ts.SourceFile,
    factory: ts.NodeFactory,
  ): ts.CallExpression {
    const argumentsWithTracing = [...visited.arguments];
    for (const argumentDefinition of signature.arguments) {
      const originalArgument = argumentExpression(
        original.arguments,
        argumentDefinition.path,
      );
      const argument = argumentExpression(
        argumentsWithTracing,
        argumentDefinition.path,
      );
      if (!originalArgument || !argument) continue;

      const targets = collectExpressionTargets(
        originalArgument,
        argumentDefinition,
        parameterDefinitions,
        sourceFile,
      )
        .map(target => {
          const derivative = derivativeOf(
            originalArgument,
            target,
            parameterDefinitions,
            sourceFile,
            factory,
          );
          if (!derivative || !isSafeSensitivityExpression(derivative)) {
            return undefined;
          }
          return createRuntimeTarget(target, derivative, factory);
        })
        .filter(
          (target): target is ts.ObjectLiteralExpression =>
            target !== undefined,
        );

      if (targets.length === 0) {
        continue;
      }

      const traced = factory.createCallExpression(
        factory.createPropertyAccessExpression(
          factory.createIdentifier('__code3d'),
          'parameter',
        ),
        undefined,
        [
          factory.createStringLiteral(sourceFile.fileName),
          factory.createStringLiteral(signature.operation),
          factory.createStringLiteral(argumentDefinition.name),
          argument,
          factory.createNumericLiteral(original.getStart(sourceFile)),
          factory.createNumericLiteral(original.getEnd()),
          factory.createNumericLiteral(originalArgument.getStart(sourceFile)),
          factory.createNumericLiteral(originalArgument.getEnd()),
          factory.createArrayLiteralExpression(targets),
        ],
      );
      const root = argumentDefinition.path[0];
      const transformed = ts.transform(argumentsWithTracing[root], [
        context => node => {
          const replace: ts.Visitor = child =>
            child === argument
              ? traced
              : ts.visitEachChild(child, replace, context);
          return ts.visitNode(node, replace, ts.isExpression)!;
        },
      ]);
      argumentsWithTracing[root] = transformed.transformed[0];
      transformed.dispose();
    }

    return updateCall(
      visited,
      visited.expression,
      argumentsWithTracing,
      factory,
    );
  }

  function collectExpressionTargets(
    expression: ts.Expression,
    argument: ParameterArgument,
    parameterDefinitions: ParameterDefinitionMap,
    sourceFile: ts.SourceFile,
  ): readonly CallParameterTarget[] {
    const targets = new Map<string, CallParameterTarget>();
    const add = (target: SourceParameterTarget): void => {
      const id = `${target.sourceRef.file}:${target.sourceRef.start}:${target.sourceRef.end}`;
      targets.set(id, {
        ...target,
        kind: argument.kind,
      });
    };

    const visit = (node: ts.Node): void => {
      const definition = parameterDefinitions.get(
        sourceNodeKey(node.getStart(sourceFile), node.getEnd()),
      );
      if (definition) {
        add(definition);
        return;
      }
      const numeric = numericExpressionValue(node);
      if (numeric !== undefined && isStandaloneNumericExpression(node)) {
        add({
          sourceRef: {
            file: sourceFile.fileName,
            start: node.getStart(sourceFile),
            end: node.getEnd(),
          },
          value: numeric,
          label: argument.label,
        });
        return;
      }
      ts.forEachChild(node, visit);
    };
    visit(expression);
    return [...targets.values()];
  }

  function derivativeOf(
    expression: ts.Expression,
    target: SourceParameterTarget,
    parameterDefinitions: ParameterDefinitionMap,
    sourceFile: ts.SourceFile,
    factory: ts.NodeFactory,
  ): ts.Expression | undefined {
    if (matchesTarget(expression, target, parameterDefinitions, sourceFile)) {
      return factory.createNumericLiteral(1);
    }
    if (!containsTarget(expression, target, parameterDefinitions, sourceFile)) {
      return factory.createNumericLiteral(0);
    }
    if (ts.isParenthesizedExpression(expression)) {
      return derivativeOf(
        expression.expression,
        target,
        parameterDefinitions,
        sourceFile,
        factory,
      );
    }
    if (
      ts.isAsExpression(expression) ||
      ts.isTypeAssertionExpression(expression) ||
      ts.isSatisfiesExpression(expression) ||
      ts.isNonNullExpression(expression)
    ) {
      return derivativeOf(
        expression.expression,
        target,
        parameterDefinitions,
        sourceFile,
        factory,
      );
    }
    if (ts.isPrefixUnaryExpression(expression)) {
      const operand = derivativeOf(
        expression.operand,
        target,
        parameterDefinitions,
        sourceFile,
        factory,
      );
      if (!operand) {
        return undefined;
      }
      if (expression.operator === ts.SyntaxKind.PlusToken) {
        return operand;
      }
      if (expression.operator === ts.SyntaxKind.MinusToken) {
        return negateNumericExpression(operand, factory);
      }
      return undefined;
    }
    if (!ts.isBinaryExpression(expression)) {
      return undefined;
    }

    const leftDerivative = derivativeOf(
      expression.left,
      target,
      parameterDefinitions,
      sourceFile,
      factory,
    );
    const rightDerivative = derivativeOf(
      expression.right,
      target,
      parameterDefinitions,
      sourceFile,
      factory,
    );
    if (!leftDerivative || !rightDerivative) {
      return undefined;
    }
    const left = expression.left;
    const right = expression.right;
    switch (expression.operatorToken.kind) {
      case ts.SyntaxKind.PlusToken:
        return combineNumericExpressions(
          leftDerivative,
          rightDerivative,
          'add',
          factory,
        );
      case ts.SyntaxKind.MinusToken:
        return combineNumericExpressions(
          leftDerivative,
          rightDerivative,
          'subtract',
          factory,
        );
      case ts.SyntaxKind.AsteriskToken:
        return combineNumericExpressions(
          combineNumericExpressions(leftDerivative, right, 'multiply', factory),
          combineNumericExpressions(left, rightDerivative, 'multiply', factory),
          'add',
          factory,
        );
      case ts.SyntaxKind.SlashToken:
        return combineNumericExpressions(
          combineNumericExpressions(
            combineNumericExpressions(
              leftDerivative,
              right,
              'multiply',
              factory,
            ),
            combineNumericExpressions(
              left,
              rightDerivative,
              'multiply',
              factory,
            ),
            'subtract',
            factory,
          ),
          combineNumericExpressions(right, right, 'multiply', factory),
          'divide',
          factory,
        );
      default:
        return undefined;
    }
  }

  type NumericExpressionOperation = 'add' | 'subtract' | 'multiply' | 'divide';

  function combineNumericExpressions(
    left: ts.Expression,
    right: ts.Expression,
    operation: NumericExpressionOperation,
    factory: ts.NodeFactory,
  ): ts.Expression {
    const leftValue = generatedNumericValue(left);
    const rightValue = generatedNumericValue(right);
    if (leftValue !== undefined && rightValue !== undefined) {
      const value =
        operation === 'add'
          ? leftValue + rightValue
          : operation === 'subtract'
            ? leftValue - rightValue
            : operation === 'multiply'
              ? leftValue * rightValue
              : leftValue / rightValue;
      if (Number.isFinite(value)) return createNumberExpression(value, factory);
    }
    if (operation === 'add') {
      if (leftValue === 0) return right;
      if (rightValue === 0) return left;
    } else if (operation === 'subtract') {
      if (rightValue === 0) return left;
      if (leftValue === 0) return negateNumericExpression(right, factory);
    } else if (operation === 'multiply') {
      if (leftValue === 0 || rightValue === 0) {
        return factory.createNumericLiteral(0);
      }
      if (leftValue === 1) return right;
      if (rightValue === 1) return left;
    } else if (leftValue === 0) {
      return factory.createNumericLiteral(0);
    } else if (rightValue === 1) {
      return left;
    }
    const token =
      operation === 'add'
        ? ts.SyntaxKind.PlusToken
        : operation === 'subtract'
          ? ts.SyntaxKind.MinusToken
          : operation === 'multiply'
            ? ts.SyntaxKind.AsteriskToken
            : ts.SyntaxKind.SlashToken;
    return factory.createBinaryExpression(left, token, right);
  }

  function negateNumericExpression(
    expression: ts.Expression,
    factory: ts.NodeFactory,
  ): ts.Expression {
    const value = generatedNumericValue(expression);
    return value === undefined
      ? factory.createPrefixUnaryExpression(
          ts.SyntaxKind.MinusToken,
          expression,
        )
      : createNumberExpression(-value, factory);
  }

  function generatedNumericValue(
    expression: ts.Expression,
  ): number | undefined {
    if (ts.isNumericLiteral(expression)) return Number(expression.text);
    if (
      ts.isPrefixUnaryExpression(expression) &&
      expression.operator === ts.SyntaxKind.MinusToken &&
      ts.isNumericLiteral(expression.operand)
    ) {
      return -Number(expression.operand.text);
    }
    return undefined;
  }

  function containsTarget(
    node: ts.Node,
    target: SourceParameterTarget,
    parameterDefinitions: ParameterDefinitionMap,
    sourceFile: ts.SourceFile,
  ): boolean {
    if (matchesTarget(node, target, parameterDefinitions, sourceFile)) {
      return true;
    }
    let contains = false;
    ts.forEachChild(node, child => {
      if (
        !contains &&
        containsTarget(child, target, parameterDefinitions, sourceFile)
      ) {
        contains = true;
      }
    });
    return contains;
  }

  function matchesTarget(
    node: ts.Node,
    target: SourceParameterTarget,
    parameterDefinitions: ParameterDefinitionMap,
    sourceFile: ts.SourceFile,
  ): boolean {
    const definition = parameterDefinitions.get(
      sourceNodeKey(node.getStart(sourceFile), node.getEnd()),
    );
    if (definition)
      return sameSourceRef(definition.sourceRef, target.sourceRef);
    return (
      node.getStart(sourceFile) === target.sourceRef.start &&
      node.getEnd() === target.sourceRef.end &&
      normalizeProjectPath(sourceFile.fileName) === target.sourceRef.file
    );
  }

  function createRuntimeTarget(
    target: CallParameterTarget,
    sensitivity: ts.Expression,
    factory: ts.NodeFactory,
  ): ts.ObjectLiteralExpression {
    const targetProperties: ts.ObjectLiteralElementLike[] = [
      property(
        'id',
        factory.createStringLiteral(
          `${target.sourceRef.file}:${target.sourceRef.start}:${target.sourceRef.end}`,
        ),
        factory,
      ),
      property('label', factory.createStringLiteral(target.label), factory),
      property('kind', factory.createStringLiteral(target.kind), factory),
      property('value', createNumberExpression(target.value, factory), factory),
      property(
        'sourceRef',
        factory.createObjectLiteralExpression([
          property(
            'file',
            factory.createStringLiteral(target.sourceRef.file),
            factory,
          ),
          property(
            'start',
            factory.createNumericLiteral(target.sourceRef.start),
            factory,
          ),
          property(
            'end',
            factory.createNumericLiteral(target.sourceRef.end),
            factory,
          ),
        ]),
        factory,
      ),
    ];

    return factory.createObjectLiteralExpression([
      property(
        'target',
        factory.createObjectLiteralExpression(targetProperties),
        factory,
      ),
      property('sensitivity', sensitivity, factory),
    ]);
  }

  function property(
    name: string,
    initializer: ts.Expression,
    factory: ts.NodeFactory,
  ): ts.PropertyAssignment {
    return factory.createPropertyAssignment(name, initializer);
  }

  function createNumberExpression(
    value: number,
    factory: ts.NodeFactory,
  ): ts.Expression {
    if (value < 0) {
      return factory.createPrefixUnaryExpression(
        ts.SyntaxKind.MinusToken,
        factory.createNumericLiteral(Math.abs(value)),
      );
    }
    return factory.createNumericLiteral(Object.is(value, -0) ? 0 : value);
  }

  function toolCallSite(
    node: ts.CallExpression,
    siteId: string,
    signature: ToolSignatureSchema,
    sourceFile: ts.SourceFile,
  ): ToolCallSite {
    const sourceStart = callSourceStart(node, sourceFile);
    return {
      siteId,
      argumentListRef: sourceRef(
        sourceFile.fileName,
        node.arguments.pos,
        node.end - 1,
      ),
      sourceRef: sourceRef(sourceFile.fileName, sourceStart, node.getEnd()),
      signature,
      arguments: signature.parameters.map(parameter => {
        const path = parameter.path ?? [parameter.index];
        return {
          name: parameter.name,
          index: parameter.index,
          ...toolArgumentLocation(node, path, signature, sourceFile),
        };
      }),
    };
  }

  function toolArgumentLocation(
    call: ts.CallExpression,
    path: readonly number[],
    signature: ToolSignatureSchema,
    sourceFile: ts.SourceFile,
  ): Pick<ToolArgumentSource, 'presence' | 'target'> {
    let container: ts.CallExpression | ts.ArrayLiteralExpression = call;
    let arguments_: ts.NodeArray<ts.Expression> = call.arguments;
    for (const [depth, index] of path.entries()) {
      if (arguments_.slice(0, index + 1).some(ts.isSpreadElement))
        return {presence: 'unknown'};
      const argument = arguments_[index];
      if (!argument || ts.isOmittedExpression(argument)) {
        const prefixes: number[][] = [];
        for (let level = depth; level < path.length; level++) {
          const values: number[] = [];
          const start = level === depth ? arguments_.length : 0;
          for (let sibling = start; sibling < path[level]; sibling++) {
            const siblingPath = [...path.slice(0, level), sibling];
            const parameter = signature.parameters.find(parameter => {
              const candidate = parameter.path ?? [parameter.index];
              return (
                candidate.length === siblingPath.length &&
                candidate.every((value, index) => value === siblingPath[index])
              );
            });
            if (
              !parameter ||
              isToolSelectionParameter(parameter) ||
              parameter.default === undefined
            )
              return {presence: 'omitted'};
            values.push(parameter.default);
          }
          prefixes.push(values);
        }
        const position =
          argument?.getStart(sourceFile) ?? container.getEnd() - 1;
        return {
          presence: 'omitted',
          target: {
            kind: 'omitted',
            sourceRef: sourceRef(sourceFile.fileName, position, position),
            needsComma:
              !argument &&
              arguments_.length > 0 &&
              !arguments_.hasTrailingComma,
            ...(prefixes.length > 1 || prefixes[0].length ? {prefixes} : {}),
          },
        };
      }
      if (depth < path.length - 1) {
        const expression = unwrapArgument(argument);
        if (!ts.isArrayLiteralExpression(expression))
          return {presence: 'unknown'};
        container = expression;
        arguments_ = expression.elements;
        continue;
      }
      const previous = arguments_[index - 1];
      const next = arguments_[index + 1];
      const removalStart = previous
        ? previous.getEnd()
        : argument.getStart(sourceFile);
      const removalEnd = previous
        ? argument.getEnd()
        : next
          ? next.getStart(sourceFile)
          : argument.getEnd();
      const location = sourceRef(
        sourceFile.fileName,
        argument.getStart(sourceFile),
        argument.getEnd(),
      );
      return {
        presence: 'present',
        target: {
          kind: 'present',
          sourceRef: location,
          removalSourceRef:
            depth > 0
              ? location
              : sourceRef(sourceFile.fileName, removalStart, removalEnd),
        },
      };
    }
    return {presence: 'unknown'};
  }

  function parameterSignatureFor(
    schema: ToolSignatureSchema,
  ): ParameterSignature | undefined {
    const numericParameters = schema.parameters.filter(
      (
        parameter,
      ): parameter is typeof parameter & Readonly<{kind: ParameterKind}> =>
        !isToolSelectionParameter(parameter),
    );
    if (numericParameters.length === 0) return undefined;
    return {
      operation: schema.name,
      arguments: numericParameters.map(parameter => ({
        name: parameter.name,
        label: parameter.label,
        kind: parameter.kind,
        path: parameter.path ?? [parameter.index],
      })),
    };
  }

  function numericExpressionValue(node: ts.Node): number | undefined {
    if (ts.isNumericLiteral(node)) {
      const value = Number(node.text);
      return Number.isFinite(value) ? value : undefined;
    }
    if (
      ts.isPrefixUnaryExpression(node) &&
      (node.operator === ts.SyntaxKind.PlusToken ||
        node.operator === ts.SyntaxKind.MinusToken) &&
      ts.isNumericLiteral(node.operand)
    ) {
      const value = Number(node.getText());
      return Number.isFinite(value) ? value : undefined;
    }
    if (ts.isParenthesizedExpression(node)) {
      return numericExpressionValue(node.expression);
    }
    return undefined;
  }

  function isStandaloneNumericExpression(node: ts.Node): node is ts.Expression {
    if (ts.isNumericLiteral(node)) {
      return !(
        ts.isPrefixUnaryExpression(node.parent) &&
        (node.parent.operator === ts.SyntaxKind.PlusToken ||
          node.parent.operator === ts.SyntaxKind.MinusToken)
      );
    }
    return (
      ts.isPrefixUnaryExpression(node) &&
      (node.operator === ts.SyntaxKind.PlusToken ||
        node.operator === ts.SyntaxKind.MinusToken) &&
      ts.isNumericLiteral(node.operand)
    );
  }

  function isSafeSensitivityExpression(expression: ts.Expression): boolean {
    if (ts.isIdentifier(expression) || ts.isNumericLiteral(expression)) {
      return true;
    }
    if (ts.isParenthesizedExpression(expression)) {
      return isSafeSensitivityExpression(expression.expression);
    }
    if (ts.isPrefixUnaryExpression(expression)) {
      return isSafeSensitivityExpression(expression.operand);
    }
    if (ts.isBinaryExpression(expression)) {
      return (
        isSafeSensitivityExpression(expression.left) &&
        isSafeSensitivityExpression(expression.right)
      );
    }
    return false;
  }

  function isTraceableCall(node: ts.Node, sourceFile: ts.SourceFile): boolean {
    return (
      ts.isCallExpression(node) &&
      node.expression.kind !== ts.SyntaxKind.SuperKeyword &&
      node.expression.kind !== ts.SyntaxKind.ImportKeyword &&
      isTraceableExpression(node, sourceFile)
    );
  }

  function isTraceableExpression(
    node: ts.Expression,
    sourceFile: ts.SourceFile,
  ): boolean {
    if (
      ts.isAwaitExpression(node) ||
      node.kind === ts.SyntaxKind.YieldExpression
    ) {
      return false;
    }
    let traceable = true;
    const inspect = (child: ts.Node): void => {
      if (
        ts.isAwaitExpression(child) ||
        child.kind === ts.SyntaxKind.YieldExpression
      ) {
        traceable = false;
        return;
      }
      ts.forEachChild(child, inspect);
    };
    ts.forEachChild(node, inspect);

    return traceable && node.getStart(sourceFile) >= 0;
  }

  function diagnosticFailure(
    diagnostic: ts.Diagnostic,
    file?: string,
  ): ModelDiagnosticError {
    return modelFailure(
      'syntax',
      ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
      file && diagnostic.start !== undefined
        ? sourceRef(
            file,
            diagnostic.start,
            diagnostic.start + (diagnostic.length ?? 1),
          )
        : undefined,
    );
  }

  function modelFailure(
    kind: ModelDiagnosticKind,
    message: string,
    sourceRef?: SourceRef,
  ): ModelDiagnosticError {
    return new ModelDiagnosticError(
      createModelDiagnostic(kind, message, sourceRef),
    );
  }

  return {compileProject};
}

function relationArrayPredecessors(
  node: ts.CallExpression,
  sourceFile: ts.SourceFile,
): readonly SourceRef[] | undefined {
  let item: ts.Node = node;
  while (
    (ts.isPropertyAccessExpression(item.parent) &&
      item.parent.expression === item) ||
    (ts.isCallExpression(item.parent) && item.parent.expression === item) ||
    ts.isParenthesizedExpression(item.parent) ||
    ts.isAsExpression(item.parent) ||
    ts.isSatisfiesExpression(item.parent)
  )
    item = item.parent;
  const parent = item.parent;
  return ts.isArrayLiteralExpression(parent)
    ? parent.elements
        .slice(0, parent.elements.indexOf(item as ts.Expression))
        .map(value =>
          sourceRef(sourceFile.fileName, value.getStart(sourceFile), value.end),
        )
    : undefined;
}
