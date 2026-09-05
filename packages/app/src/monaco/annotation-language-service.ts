import ts from '@typescript/typescript6';
import type {
  TypeScriptLanguageService,
  TypeScriptSelectionRange,
} from 'monaco-editor/language/typescript/ts.worker';
import {code3dAnnotations} from '../model/annotations';
import {EmbeddedCodeProjection} from './embedded-code';
import configTypes from '../model/tool-parameter-config.ts?raw';
import {
  parameterAnnotationSites,
  parameterAnnotationDiagnostics,
} from '../model/tool-parameter-annotations';

const schemaFile = 'file:///workspace/.__code3d-param-schema.ts';
const valueFile = 'file:///workspace/.__code3d-annotation-value.ts';
const valuePrefix =
  "import type {ToolParameterConfig} from './.__code3d-param-schema.js';\nconst config: ToolParameterConfig = (";

/**
 * Analyze callable signatures with the same TS version as model tooling.
 * Config values use a private projection of their actual types, never a
 * Monaco model or a synthetic export in the author's language service.
 */
export class AnnotationLanguageService {
  private source = '';
  private version = 0;
  private readonly service: TypeScriptLanguageService;

  constructor(host: ts.LanguageServiceHost) {
    const readFile = (name: string): string | undefined =>
      name === schemaFile
        ? configTypes
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
    }) as TypeScriptLanguageService;
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
    const site = this.project(sourceFile, position);
    if (!site || site.kind === 'arguments') return undefined;
    const {projection} = site;
    if (site.kind === 'parameter') {
      return {
        isGlobalCompletion: false,
        isMemberCompletion: false,
        isNewIdentifierLocation: false,
        entries: site.parameters.map(name => ({
          name,
          kind: ts.ScriptElementKind.parameterElement,
          kindModifiers: '',
          sortText: '11',
          replacementSpan: projection.sourceSpan,
        })),
      };
    }
    const info = this.service.getCompletionsAtPosition(
      valueFile,
      projection.toGeneratedOffset(position),
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
          replacementSpan:
            entry.replacementSpan &&
            projection.toSourceSpan(entry.replacementSpan),
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
    const site = this.project(sourceFile, position);
    if (!site || site.kind === 'arguments') return undefined;
    if (site.kind === 'parameter') {
      return {
        name,
        kind: ts.ScriptElementKind.parameterElement,
        kindModifiers: '',
        displayParts: [{kind: 'text', text: `Parameter ${name}`}],
      };
    }
    return this.service.getCompletionEntryDetails(
      valueFile,
      site.projection.toGeneratedOffset(position),
      name,
      format,
      undefined,
      preferences,
      undefined,
    );
  }

  selectionRange(
    sourceFile: ts.SourceFile,
    position: number,
    outer: TypeScriptSelectionRange,
  ): TypeScriptSelectionRange {
    const site = this.project(sourceFile, position);
    if (!site || site.projection.sourceSpan.length === 0) return outer;
    const {annotation, projection} = site;
    if (
      position < projection.sourceSpan.start ||
      position > projection.sourceSpan.start + projection.sourceSpan.length
    )
      return outer;
    const generated = this.service.getSmartSelectionRange(
      valueFile,
      projection.toGeneratedOffset(position),
    );
    return projection.selectionRange(
      generated,
      [
        {
          start: annotation.valueStart,
          length: annotation.valueEnd - annotation.valueStart,
        },
        {
          start: annotation.start,
          length: annotation.valueEnd - annotation.start,
        },
      ],
      outer,
    );
  }

  private project(sourceFile: ts.SourceFile, position: number) {
    const annotation = code3dAnnotations(sourceFile).find(
      annotation =>
        (annotation.name === 'param' || annotation.name === 'arguments') &&
        annotation.end < position &&
        position <= annotation.contentEnd,
    );
    if (!annotation) return undefined;
    if (annotation.name === 'arguments') {
      return {
        kind: 'arguments' as const,
        annotation,
        projection: this.useProjection(
          new EmbeddedCodeProjection(
            {start: annotation.valueStart, text: annotation.value},
            'const value = (',
            ');',
          ),
        ),
      };
    }
    const match = /^([A-Za-z_$][\w$]*)/.exec(annotation.value);
    const name = match?.[0] ?? '';
    const nameEnd = annotation.valueStart + name.length;
    if (!name || position <= nameEnd) {
      const checker = this.service.getProgram()!.getTypeChecker();
      const parameters = parameterAnnotationSites(sourceFile, checker).find(
        site => site.annotation.start === annotation.start,
      )?.parameters;
      return {
        kind: 'parameter' as const,
        annotation,
        parameters: parameters?.map(parameter => parameter.name) ?? [],
        projection: this.useProjection(
          new EmbeddedCodeProjection(
            {start: Math.min(annotation.valueStart, position), text: name},
            'const value = (',
            ');',
          ),
        ),
      };
    }
    const remainder = annotation.value.slice(name.length);
    const leadingWhitespace = remainder.length - remainder.trimStart().length;
    const start = nameEnd + leadingWhitespace;
    const expression = annotation.value.slice(start - annotation.valueStart);
    return {
      kind: 'config' as const,
      annotation,
      projection: this.useProjection(
        new EmbeddedCodeProjection(
          {start, text: expression},
          valuePrefix,
          ');',
        ),
      ),
    };
  }

  private useProjection(
    projection: EmbeddedCodeProjection,
  ): EmbeddedCodeProjection {
    if (projection.source !== this.source) {
      this.source = projection.source;
      this.version += 1;
    }
    return projection;
  }
}
