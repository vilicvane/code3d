import ts from '@typescript/typescript6';
import configTypes from '../model/tool-parameter-config.ts?raw';
import coreToolingTypes from '../../../core/bld/tooling/index.d.ts?raw';
import {
  parameterAnnotationSites,
  parameterAnnotationDiagnostics,
} from '../model/tool-parameter-annotations';

const schemaFile = 'file:///workspace/.__code3d-param-schema.ts';
const valueFile = 'file:///workspace/.__code3d-param-value.ts';
const toolingFile = 'file:///node_modules/@code3d/core/bld/tooling/index.d.ts';
const valuePrefix =
  "import type {ToolParameterConfig} from './.__code3d-param-schema.js';\nconst config: ToolParameterConfig = (";

/**
 * Analyze callable signatures with the same TS version as model tooling.
 * Config values use a private projection of their actual types, never a
 * Monaco model or a synthetic export in the author's language service.
 */
export class ParameterAnnotationLanguageService {
  private source = '';
  private version = 0;
  private readonly service: ts.LanguageService;

  constructor(host: ts.LanguageServiceHost) {
    const readFile = (name: string): string | undefined =>
      name === schemaFile
        ? configTypes
        : name === toolingFile
          ? coreToolingTypes
          : name === valueFile
            ? this.source
            : host.readFile?.(name);
    this.service = ts.createLanguageService({
      getCompilationSettings: () => ({
        ...host.getCompilationSettings(),
        noUnusedLocals: false,
        noUnusedParameters: false,
      }),
      getScriptFileNames: () => [
        ...host.getScriptFileNames(),
        schemaFile,
        valueFile,
      ],
      getScriptVersion: name =>
        name === valueFile
          ? String(this.version)
          : name === schemaFile
            ? '1'
            : host.getScriptVersion(name),
      getScriptSnapshot: name => {
        const source = readFile(name);
        return source === undefined
          ? host.getScriptSnapshot(name)
          : ts.ScriptSnapshot.fromString(source);
      },
      getCurrentDirectory: () => host.getCurrentDirectory(),
      getDefaultLibFileName: options => host.getDefaultLibFileName(options),
      fileExists: name =>
        readFile(name) !== undefined || (host.fileExists?.(name) ?? false),
      readFile,
    });
  }

  sourceFile(fileName: string): ts.SourceFile | undefined {
    return this.service.getProgram()?.getSourceFile(fileName);
  }

  diagnostics(fileName: string): ts.Diagnostic[] {
    const program = this.service.getProgram();
    const sourceFile = program?.getSourceFile(fileName);
    return sourceFile
      ? parameterAnnotationDiagnostics(sourceFile, program!.getTypeChecker())
      : [];
  }

  completions(
    sourceFile: ts.SourceFile,
    position: number,
    preferences: ts.UserPreferences,
  ): ts.CompletionInfo | undefined {
    const projection = this.project(sourceFile, position);
    if (!projection) return undefined;
    if (projection.kind === 'parameter') {
      return {
        isGlobalCompletion: false,
        isMemberCompletion: false,
        isNewIdentifierLocation: false,
        entries: projection.parameters.map(name => ({
          name,
          kind: ts.ScriptElementKind.parameterElement,
          kindModifiers: '',
          sortText: '11',
          replacementSpan: projection.span,
        })),
      };
    }
    const info = this.service.getCompletionsAtPosition(
      valueFile,
      projection.offset,
      {
        ...preferences,
        includeCompletionsForModuleExports: false,
      },
    );
    return {
      ...info,
      isGlobalCompletion: false,
      isMemberCompletion: info?.isMemberCompletion ?? false,
      isNewIdentifierLocation: info?.isNewIdentifierLocation ?? false,
      entries: (info?.isGlobalCompletion ? [] : (info?.entries ?? [])).map(
        entry => ({
          ...entry,
          replacementSpan: entry.replacementSpan && {
            start:
              projection.start +
              entry.replacementSpan.start -
              valuePrefix.length,
            length: entry.replacementSpan.length,
          },
        }),
      ),
    };
  }

  details(
    sourceFile: ts.SourceFile,
    position: number,
    name: string,
    format: ts.FormatCodeSettings,
    preferences: ts.UserPreferences,
  ): ts.CompletionEntryDetails | undefined {
    const projection = this.project(sourceFile, position);
    if (!projection) return undefined;
    if (projection.kind === 'parameter') {
      return {
        name,
        kind: ts.ScriptElementKind.parameterElement,
        kindModifiers: '',
        displayParts: [{kind: 'text', text: `Parameter ${name}`}],
      };
    }
    return this.service.getCompletionEntryDetails(
      valueFile,
      projection.offset,
      name,
      format,
      undefined,
      preferences,
      undefined,
    );
  }

  private project(sourceFile: ts.SourceFile, position: number) {
    const checker = this.service.getProgram()!.getTypeChecker();
    const site = parameterAnnotationSites(sourceFile, checker).find(
      ({annotation}) =>
        annotation.end < position && position <= annotation.contentEnd,
    );
    if (!site) return undefined;
    const {annotation, parameters} = site;
    const match = /^([A-Za-z_$][\w$]*)/.exec(annotation.value);
    const name = match?.[0] ?? '';
    const nameEnd = annotation.valueStart + name.length;
    if (!name || position <= nameEnd) {
      return {
        kind: 'parameter' as const,
        parameters: parameters?.map(parameter => parameter.name) ?? [],
        span: {
          start: Math.min(annotation.valueStart, position),
          length: name.length,
        },
      };
    }
    const remainder = annotation.value.slice(name.length);
    const leadingWhitespace = remainder.length - remainder.trimStart().length;
    const start = nameEnd + leadingWhitespace;
    const expression = annotation.value.slice(start - annotation.valueStart);
    const source = `${valuePrefix}${expression});`;
    if (source !== this.source) {
      this.source = source;
      this.version += 1;
    }
    return {
      kind: 'config' as const,
      start,
      offset: valuePrefix.length + position - start,
    };
  }
}
