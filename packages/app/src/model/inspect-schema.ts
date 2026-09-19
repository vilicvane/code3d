import type {SourceRef} from '@code3d/core/tooling';
import ts from '@typescript/typescript6';
import {normalizeProjectPath, type ModelProject} from '../project/project';
import {
  annotationReference,
  declarationAnnotations,
  signatureAnnotationDeclaration,
  type Code3dAnnotation,
} from './annotations';
import {sourceNodeKey} from './parameter-definitions';

export type InspectParameter = Readonly<{
  name: string;
  path: readonly (string | number)[];
  rest?: boolean;
}>;

export type InspectBinding = Readonly<{
  path: readonly string[];
  sourceRef: SourceRef;
}> &
  (
    | Readonly<{kind: 'callee'}>
    | Readonly<{kind: 'local'; definition: string}>
    | Readonly<{kind: 'module'; module: string}>
  );

export type InspectAnnotation = Readonly<{
  kind: 'call' | 'parameter' | 'closure' | 'context';
  parameter?: InspectParameter;
  binding: InspectBinding;
}>;

export type InspectSignature = Readonly<{
  id: string;
  annotations: readonly InspectAnnotation[];
  parameters: readonly InspectParameter[];
  diagnostic?: Readonly<{summary: string; sourceRef: SourceRef}>;
}>;

export type InspectCallSite = Readonly<{
  siteId: string;
  sourceRef: SourceRef;
  callRef: SourceRef;
  receiverRef?: SourceRef;
  arguments: readonly Readonly<{
    sourceRef: SourceRef;
    spread: boolean;
    members: readonly Readonly<{
      sourceRef: SourceRef;
      path: readonly (string | number)[];
    }>[];
  }>[];
  signature: InspectSignature;
}>;

export type InspectDefinition = Readonly<{
  id: string;
  node: ts.Node;
  implementation: ts.Node;
  scope: ts.Node;
  bindings: readonly InspectBinding[];
}>;

export type ProjectInspectionIndex = Readonly<{
  calls: ReadonlyMap<string, ReadonlyMap<string, InspectSignature>>;
  definitions: ReadonlyMap<string, readonly InspectDefinition[]>;
}>;

const inspectNames = ['inspect', 'inspect.closure', 'inspect.context'] as const;

/** Resolve metadata against the same declarations and overloads as ordinary TS calls. */
export function resolveProjectInspection(
  project: ModelProject,
  program: ts.Program,
): ProjectInspectionIndex {
  const checker = program.getTypeChecker();
  const projectPaths = new Set(
    project.files.map(file => normalizeProjectPath(file.path)),
  );
  const calls = new Map<string, Map<string, InspectSignature>>();
  const definitions = new Map<string, InspectDefinition[]>();
  const registered = new Set<string>();

  for (const path of projectPaths) {
    const file = program.getSourceFile(path);
    if (!file) continue;
    const fileCalls = new Map<string, InspectSignature>();
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const signature = checker.getResolvedSignature(node);
        const owner =
          signature &&
          signatureAnnotationDeclaration(
            signature,
            node.expression,
            checker,
            inspectNames,
          );
        const declaration = owner ?? signature?.getDeclaration();
        if (signature && declaration) {
          fileCalls.set(
            sourceNodeKey(node.getStart(file), node.end),
            readSignature(signature, declaration, node),
          );
        }
      }
      if (
        ts.isPropertyAccessExpression(node) ||
        ts.isElementAccessExpression(node)
      ) {
        const selector = ts.isPropertyAccessExpression(node)
          ? node.name
          : node.argumentExpression;
        const keyType = ts.isElementAccessExpression(node)
          ? checker.getTypeAtLocation(selector)
          : undefined;
        const symbol = ts.isPropertyAccessExpression(node)
          ? checker.getSymbolAtLocation(selector)
          : keyType && (keyType.isStringLiteral() || keyType.isNumberLiteral())
            ? checker
                .getTypeAtLocation(node.expression)
                .getNonNullableType()
                .getProperty(String(keyType.value))
            : undefined;
        const owner = symbol?.declarations?.find(
          declaration =>
            (ts.isGetAccessorDeclaration(declaration) ||
              ts.isPropertySignature(declaration) ||
              ts.isPropertyDeclaration(declaration)) &&
            declarationAnnotations(declaration).some(annotation =>
              inspectNames.some(name => name === annotation.name),
            ),
        );
        if (owner)
          fileCalls.set(
            sourceNodeKey(node.getStart(file), node.end),
            readSignature(undefined, owner, node),
          );
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
    calls.set(path, fileCalls);
  }
  return {calls, definitions};

  function readSignature(
    signature: ts.Signature | undefined,
    owner: ts.Node,
    call:
      | ts.CallExpression
      | ts.PropertyAccessExpression
      | ts.ElementAccessExpression,
  ): InspectSignature {
    const file = owner.getSourceFile();
    const id = `${file.fileName}:${owner.getStart(file)}:${owner.end}`;
    const parameters = signature ? inspectParameters(signature, checker) : [];
    const annotations: InspectAnnotation[] = [];
    const seen = new Set<string>();
    const implementation = implementationOf(owner, checker);
    const local = projectPaths.has(file.fileName) && !!implementation;
    let diagnostic: InspectSignature['diagnostic'];
    for (const annotation of declarationAnnotations(owner)) {
      if (!inspectNames.some(name => name === annotation.name)) continue;
      const sourceRef = annotationLocation(file, annotation);
      const fail = (summary: string): void => {
        diagnostic ??= {summary, sourceRef};
      };
      const parts = annotation.value.split(/\s+/);
      const kind =
        annotation.name === 'inspect'
          ? parts.length === 1
            ? 'call'
            : 'parameter'
          : annotation.name === 'inspect.closure'
            ? 'closure'
            : 'context';
      if (parts.length !== (kind === 'call' ? 1 : 2)) {
        fail(
          `@code3d.${annotation.name} requires ${kind === 'call' ? 'a callback path' : 'a parameter name and callback path'}.`,
        );
        continue;
      }
      const name = kind === 'call' ? undefined : parts[0];
      const parameter =
        name === 'this' && kind === 'parameter'
          ? {name, path: []}
          : parameters.find(parameter => parameter.name === name);
      if (name && !parameter) {
        fail(`Unknown inspect parameter: ${name}.`);
        continue;
      }
      const key = `${kind}:${name ?? ''}`;
      if (seen.has(key)) {
        fail(
          `Duplicate @code3d.${annotation.name} scope${name ? `: ${name}` : ''}.`,
        );
        continue;
      }
      seen.add(key);
      const reference = annotationReference(parts.at(-1)!, owner, checker);
      if (!reference) {
        fail(
          'An inspector reference must be a symbolic path, such as cut.inspectTools.',
        );
        continue;
      }
      let binding: InspectBinding;
      const ownerName =
        'name' in owner
          ? (owner.name as ts.DeclarationName | undefined)
          : undefined;
      const ownerSymbol = ownerName && checker.getSymbolAtLocation(ownerName);
      if (
        signature &&
        reference.root &&
        reference.root === ownerSymbol &&
        reference.path.length > 1
      ) {
        binding = {kind: 'callee', path: reference.path.slice(1), sourceRef};
      } else if (local) {
        if (!reference.root) {
          fail(
            `Inspector binding not found in the declaration's scope: ${reference.path[0]}.`,
          );
          continue;
        }
        binding = {
          kind: 'local',
          definition: id,
          path: reference.path,
          sourceRef,
        };
      } else {
        const module = publishedModule(owner, call, checker);
        if (!module) {
          fail(
            'A published inspector must be exported from the callable’s public module.',
          );
          continue;
        }
        binding = {kind: 'module', module, path: reference.path, sourceRef};
      }
      annotations.push({kind, parameter, binding});
    }
    if (
      local &&
      !registered.has(id) &&
      annotations.some(annotation => annotation.binding.kind === 'local')
    ) {
      registered.add(id);
      let scope = owner.parent;
      while (
        scope &&
        !ts.isSourceFile(scope) &&
        !ts.isBlock(scope) &&
        !ts.isModuleBlock(scope)
      )
        scope = scope.parent;
      const entries = definitions.get(file.fileName) ?? [];
      entries.push({
        id,
        node: owner,
        implementation,
        scope,
        bindings: annotations.map(annotation => annotation.binding),
      });
      definitions.set(file.fileName, entries);
    }
    return {id, annotations, parameters, diagnostic};
  }
}

function annotationLocation(
  file: ts.SourceFile,
  annotation: Code3dAnnotation,
): SourceRef {
  return {
    file: file.fileName,
    start: annotation.valueStart,
    end: annotation.valueEnd,
  };
}

function implementationOf(
  owner: ts.Node,
  checker: ts.TypeChecker,
): ts.Node | undefined {
  if (ts.isVariableDeclaration(owner)) return owner.initializer && owner;
  if (ts.isFunctionLike(owner) && 'body' in owner && owner.body) return owner;
  if ('name' in owner && owner.name) {
    const symbol = checker.getSymbolAtLocation(owner.name as ts.Node);
    return symbol?.declarations?.find(
      node => ts.isFunctionLike(node) && 'body' in node && !!node.body,
    );
  }
  return undefined;
}

function inspectParameters(
  signature: ts.Signature,
  checker: ts.TypeChecker,
): InspectParameter[] {
  const result: InspectParameter[] = [];
  const visit = (
    name: ts.BindingName,
    path: readonly (string | number)[],
    rest = false,
  ): void => {
    if (ts.isIdentifier(name)) {
      result.push({name: name.text, path, ...(rest ? {rest} : {})});
      return;
    }
    name.elements.forEach((element, index) => {
      if (!ts.isBindingElement(element)) return;
      const property = element.propertyName ?? element.name;
      const key = ts.isArrayBindingPattern(name)
        ? index
        : ts.isIdentifier(property) || ts.isStringLiteral(property)
          ? property.text
          : ts.isNumericLiteral(property)
            ? Number(property.text)
            : undefined;
      if (key !== undefined)
        visit(element.name, [...path, key], !!element.dotDotDotToken);
    });
  };
  signature.getParameters().forEach((parameter, index) => {
    const declaration = parameter.valueDeclaration;
    if (declaration && ts.isParameter(declaration)) {
      const type = checker.getTypeOfSymbolAtLocation(parameter, declaration);
      if (declaration.dotDotDotToken && checker.isTupleType(type)) {
        const tuple = (type as ts.TypeReference).target as ts.TupleType;
        tuple.labeledElementDeclarations?.forEach((label, position) => {
          if (label && ts.isIdentifier(label.name))
            result.push({name: label.name.text, path: [index + position]});
        });
      } else visit(declaration.name, [index], !!declaration.dotDotDotToken);
    } else result.push({name: parameter.getName(), path: [index]});
  });
  return result;
}

/** Prefer the public entry actually used by the caller, including a barrel re-export. */
function publishedModule(
  owner: ts.Node,
  call:
    | ts.CallExpression
    | ts.PropertyAccessExpression
    | ts.ElementAccessExpression,
  checker: ts.TypeChecker,
): string | undefined {
  const visited = new Set<ts.Symbol>();
  const imported = (expression: ts.Expression): string | undefined => {
    let symbol = checker.getSymbolAtLocation(expression);
    while (symbol && !visited.has(symbol)) {
      visited.add(symbol);
      for (const declaration of symbol.declarations ?? []) {
        if (
          ts.isImportSpecifier(declaration) ||
          ts.isImportClause(declaration) ||
          ts.isNamespaceImport(declaration)
        ) {
          let parent: ts.Node = declaration;
          while (!ts.isImportDeclaration(parent)) parent = parent.parent;
          return ts.isStringLiteral(parent.moduleSpecifier)
            ? parent.moduleSpecifier.text
            : undefined;
        }
      }
      const value = symbol.valueDeclaration;
      if (value && ts.isVariableDeclaration(value) && value.initializer) {
        symbol = checker.getSymbolAtLocation(value.initializer);
      } else break;
    }
    return ts.isPropertyAccessExpression(expression) ||
      ts.isElementAccessExpression(expression)
      ? imported(expression.expression)
      : undefined;
  };
  const specifier = imported(call.expression);
  if (specifier && !specifier.startsWith('.')) return specifier;
  // Instance methods may be reached through a local value rather than an import binding.
  const fileName = owner.getSourceFile().fileName;
  const packagePath = fileName.slice(fileName.lastIndexOf('/node_modules/'));
  return /^\/node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(packagePath)?.[1];
}
