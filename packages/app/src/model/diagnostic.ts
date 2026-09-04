import {
  describeOpenCascadeException,
  type SourceRef,
} from '@code3d/core/tooling';

export type ModelDiagnosticKind =
  'syntax' | 'module' | 'evaluation' | 'project';

export type ModelDiagnostic = Readonly<{
  kind: ModelDiagnosticKind;
  summary: string;
  details?: string;
  sourceRef?: SourceRef;
}>;

export class ModelDiagnosticError extends Error {
  constructor(readonly diagnostic: ModelDiagnostic) {
    super(diagnostic.summary);
    this.name = 'ModelDiagnosticError';
  }
}

export function createModelDiagnostic(
  kind: ModelDiagnosticKind,
  message: string,
  sourceRef?: SourceRef,
): ModelDiagnostic {
  const [summary, ...detailLines] = message.split('\n');
  const details = detailLines.join('\n').trim();
  return {
    kind,
    summary: summary.trim() || 'Model evaluation failed.',
    ...(details ? {details} : {}),
    ...(sourceRef ? {sourceRef} : {}),
  };
}

export function diagnosticFromError(
  error: unknown,
  kind: ModelDiagnosticKind = 'evaluation',
): ModelDiagnostic {
  if (error instanceof ModelDiagnosticError) return error.diagnostic;
  return createModelDiagnostic(
    kind,
    describeOpenCascadeException(error) ??
      (error instanceof Error ? error.message : String(error)),
  );
}

export function locateModelError(
  error: unknown,
  sourceRef: SourceRef,
  kind: ModelDiagnosticKind = 'evaluation',
): ModelDiagnosticError {
  const diagnostic = diagnosticFromError(error, kind);
  return new ModelDiagnosticError(
    diagnostic.sourceRef ? diagnostic : {...diagnostic, sourceRef},
  );
}
