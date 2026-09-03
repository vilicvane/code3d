import ts from '@typescript/typescript6';
import {code3dAnnotations, type Code3dAnnotation} from './annotations';

export type DesignFunctionSignature = Readonly<{
  statement: ts.Statement;
  parameters: readonly ts.ParameterDeclaration[];
  typeParameters: readonly ts.TypeParameterDeclaration[];
}>;

export type DesignFunction = Readonly<{
  name: string;
  node: ts.Node;
  signatures: readonly DesignFunctionSignature[];
}>;

export type DesignArgumentAnnotationSite = Readonly<{
  annotation: Code3dAnnotation;
  designFunction: DesignFunction;
  signature: DesignFunctionSignature;
  index: number;
}>;

export function designArgumentAnnotationSites(
  source: string,
  sourceFile: ts.SourceFile,
): DesignArgumentAnnotationSite[] {
  return designFunctionsIn(sourceFile).flatMap(designFunction => {
    let index = 0;
    return designFunction.signatures.flatMap(signature =>
      code3dAnnotations(
        source,
        signature.statement.getFullStart(),
        signature.statement.getStart(sourceFile),
      )
        .filter(annotation => annotation.name === 'arguments')
        .map(annotation => ({
          annotation,
          designFunction,
          signature,
          index: index++,
        })),
    );
  });
}

function designFunctionsIn(sourceFile: ts.SourceFile): DesignFunction[] {
  const functions: DesignFunction[] = [];
  const statements = sourceFile.statements;
  for (let index = 0; index < statements.length; index += 1) {
    const statement = statements[index];
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      const declarations = [statement];
      let implementation = statement.body ? statement : undefined;
      while (!implementation && index + 1 < statements.length) {
        const candidate = statements[index + 1];
        if (
          !ts.isFunctionDeclaration(candidate) ||
          candidate.name?.text !== statement.name.text
        ) {
          break;
        }
        index += 1;
        declarations.push(candidate);
        if (candidate.body) implementation = candidate;
      }
      if (implementation) {
        functions.push({
          name: implementation.name!.text,
          node: implementation,
          signatures: declarations.map(declaration => ({
            statement: declaration,
            parameters: declaration.parameters,
            typeParameters: declaration.typeParameters ?? [],
          })),
        });
      }
      continue;
    }
    if (!ts.isVariableStatement(statement)) continue;
    const declarations = statement.declarationList.declarations;
    if (declarations.length !== 1) continue;
    const [declaration] = declarations;
    if (
      !ts.isIdentifier(declaration.name) ||
      !declaration.initializer ||
      (!ts.isArrowFunction(declaration.initializer) &&
        !ts.isFunctionExpression(declaration.initializer))
    ) {
      continue;
    }
    functions.push({
      name: declaration.name.text,
      node: statement,
      signatures: [
        {
          statement,
          parameters: declaration.initializer.parameters,
          typeParameters: declaration.initializer.typeParameters ?? [],
        },
      ],
    });
  }
  return functions;
}
