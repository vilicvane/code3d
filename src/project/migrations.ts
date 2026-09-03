import type ts from '@typescript/typescript6';
import {withDefaultLibraries} from './default-project';
import type {ModelProject, ProjectSourceFile} from './project';

export const currentProjectMigrationVersion = 3;

const collectionOperations = new Set(['union', 'cut', 'intersect']);

export async function migrateProject(
  project: ModelProject,
): Promise<ModelProject> {
  const completeProject = withDefaultLibraries(project);
  const typescript = (await import('@typescript/typescript6')).default;
  const sourceFiles = new Map(
    completeProject.files.map(file => [
      file.path,
      typescript.createSourceFile(
        file.path,
        file.source,
        typescript.ScriptTarget.Latest,
        true,
        scriptKind(file.path, typescript),
      ),
    ]),
  );
  const options = {
    allowJs: true,
    module: typescript.ModuleKind.ESNext,
    noLib: true,
    target: typescript.ScriptTarget.Latest,
  } satisfies ts.CompilerOptions;
  const host: ts.CompilerHost = {
    fileExists: fileName => sourceFiles.has(fileName),
    getCanonicalFileName: fileName => fileName,
    getCurrentDirectory: () => '/',
    getDefaultLibFileName: () => '',
    getDirectories: () => [],
    getNewLine: () => '\n',
    getSourceFile: fileName => sourceFiles.get(fileName),
    readFile: fileName => sourceFiles.get(fileName)?.text,
    useCaseSensitiveFileNames: () => true,
    writeFile: () => undefined,
  };
  const program = typescript.createProgram(
    [...sourceFiles.keys()],
    options,
    host,
  );
  const checker = program.getTypeChecker();
  return {
    ...completeProject,
    files: completeProject.files.map(file =>
      migrateCollectionOperationCalls(
        file,
        program.getSourceFile(file.path)!,
        checker,
        typescript,
      ),
    ),
  };
}

function scriptKind(file: string, typescript: typeof ts): ts.ScriptKind {
  if (/\.tsx$/i.test(file)) return typescript.ScriptKind.TSX;
  if (/\.jsx$/i.test(file)) return typescript.ScriptKind.JSX;
  if (/\.[cm]?js$/i.test(file)) return typescript.ScriptKind.JS;
  return typescript.ScriptKind.TS;
}

function migrateCollectionOperationCalls(
  file: ProjectSourceFile,
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
  typescript: typeof ts,
): ProjectSourceFile {
  const edits: Array<{
    start: number;
    end: number;
    text: string;
    priority: number;
  }> = [];
  const visit = (node: ts.Node): void => {
    if (
      typescript.isCallExpression(node) &&
      isImportedCollectionOperation(node.expression, checker, typescript)
    ) {
      const reconstructed = reconstructedCollection(
        node,
        sourceFile,
        typescript,
      );
      if (reconstructed) {
        edits.push({
          start: node.arguments.pos,
          end: node.arguments.end,
          text: reconstructed,
          priority: 0,
        });
      } else if (!hasCollectionArgument(node, typescript)) {
        edits.push(
          {
            start: node.arguments.pos,
            end: node.arguments.pos,
            text: '[',
            priority: 0,
          },
          {
            start: node.arguments.end,
            end: node.arguments.end,
            text: ']',
            priority: 1,
          },
        );
      }
    }
    typescript.forEachChild(node, visit);
  };
  visit(sourceFile);

  let source = file.source;
  edits
    .sort(
      (left, right) =>
        right.start - left.start || right.priority - left.priority,
    )
    .forEach(({start, end, text}) => {
      source = `${source.slice(0, start)}${text}${source.slice(end)}`;
    });
  return source === file.source ? file : {...file, source};
}

function reconstructedCollection(
  call: ts.CallExpression,
  sourceFile: ts.SourceFile,
  typescript: typeof ts,
): string | undefined {
  if (
    /\/\*|\/\//.test(
      sourceFile.text.slice(call.arguments.pos, call.arguments.end),
    )
  ) {
    return undefined;
  }
  const elements =
    call.arguments.length === 1 &&
    typescript.isArrayLiteralExpression(call.arguments[0])
      ? call.arguments[0].elements
      : call.arguments;
  if (elements.length !== 2) return undefined;
  const [first, second] = elements;
  if (
    !typescript.isElementAccessExpression(first) ||
    !typescript.isIdentifier(first.expression) ||
    !first.argumentExpression ||
    !typescript.isNumericLiteral(first.argumentExpression) ||
    first.argumentExpression.text !== '0' ||
    !typescript.isSpreadElement(second) ||
    !typescript.isCallExpression(second.expression) ||
    !typescript.isPropertyAccessExpression(second.expression.expression) ||
    second.expression.expression.name.text !== 'slice' ||
    !typescript.isIdentifier(second.expression.expression.expression) ||
    second.expression.expression.expression.text !== first.expression.text ||
    second.expression.arguments.length !== 1 ||
    !typescript.isNumericLiteral(second.expression.arguments[0]) ||
    second.expression.arguments[0].text !== '1'
  ) {
    return undefined;
  }
  return first.expression.text;
}

function hasCollectionArgument(
  call: ts.CallExpression,
  typescript: typeof ts,
): boolean {
  return (
    call.arguments.length === 1 &&
    !typescript.isSpreadElement(call.arguments[0])
  );
}

function isImportedCollectionOperation(
  expression: ts.LeftHandSideExpression,
  checker: ts.TypeChecker,
  typescript: typeof ts,
): boolean {
  if (typescript.isIdentifier(expression)) {
    const declaration = checker
      .getSymbolAtLocation(expression)
      ?.declarations?.find(typescript.isImportSpecifier);
    return (
      declaration !== undefined &&
      collectionOperations.has(
        (declaration.propertyName ?? declaration.name).text,
      ) &&
      isCode3dImport(declaration, typescript)
    );
  }
  if (
    !typescript.isPropertyAccessExpression(expression) ||
    !typescript.isIdentifier(expression.expression) ||
    !collectionOperations.has(expression.name.text)
  ) {
    return false;
  }
  const declaration = checker
    .getSymbolAtLocation(expression.expression)
    ?.declarations?.find(typescript.isNamespaceImport);
  return declaration !== undefined && isCode3dImport(declaration, typescript);
}

function isCode3dImport(node: ts.Node, typescript: typeof ts): boolean {
  let current: ts.Node | undefined = node;
  while (current && !typescript.isImportDeclaration(current)) {
    current = current.parent;
  }
  return (
    current !== undefined &&
    typescript.isStringLiteral(current.moduleSpecifier) &&
    current.moduleSpecifier.text === 'code3d'
  );
}
