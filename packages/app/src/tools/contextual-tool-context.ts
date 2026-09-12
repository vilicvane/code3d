import type {SourceRef} from '@code3d/core/tooling';
import type {
  ModelModule,
  SourceTarget,
  SourceTargetEvaluation,
} from '../model/compiler';
import type {
  ToolArgumentSource,
  ToolSignatureSchema,
} from '../model/tool-schema';
import {
  contextualToolParameters,
  draftRotationParameters,
  type ContextualToolParameterState,
} from './contextual-tool-parameters';

/** Project one authored tool (including an incomplete rotation chain) into its panel fields. */
export function contextualToolContext(
  module: ModelModule,
  scope: Readonly<{target: SourceTarget; evaluation: SourceTargetEvaluation}>,
  readSource: (ref: SourceRef) => string,
) {
  const sourceTool = scope.target.tool;
  if (!sourceTool) return undefined;
  const draft = scope.target.rotationSelection;
  const components = draft
    ? draft.calls.map(site => {
        const target = module.sourceTargets.find(
          target => target.tool?.callId === site.siteId,
        );
        const evaluation = target?.evaluations.find(
          evaluation =>
            evaluation.contextId === scope.evaluation.contextId &&
            evaluation.relationOwnerNodeId ===
              scope.evaluation.relationOwnerNodeId,
        );
        const literalArguments = Object.fromEntries(
          site.arguments.flatMap(argument => {
            if (argument.target?.kind !== 'present') return [];
            const text = readSource(argument.target.sourceRef).trim();
            const value = text.length ? Number(text) : NaN;
            return Number.isFinite(value) ? [[argument.index, value]] : [];
          }),
        );
        return {
          target: {
            ...scope.target,
            sourceRef: site.sourceRef,
            argumentListRef: site.argumentListRef,
            tool: {
              callId: site.siteId,
              signature: site.signature,
              arguments: site.arguments,
            },
          },
          evaluation: {
            ...(evaluation ?? scope.evaluation),
            parameters: evaluation?.parameters ?? [],
            toolArguments: {...literalArguments, ...evaluation?.toolArguments},
          },
          prefix:
            site.signature.name === 'rotate' ? '' : `${site.signature.name}.`,
        };
      })
    : [
        ...(scope.target.rotationSelectorIds ?? []).flatMap(id => {
          const target = module.sourceTargets.find(target => target.id === id);
          const evaluation = target?.evaluations.find(
            evaluation =>
              evaluation.contextId === scope.evaluation.contextId &&
              evaluation.relationOwnerNodeId ===
                scope.evaluation.relationOwnerNodeId,
          );
          return target?.tool && evaluation
            ? [{target, evaluation, prefix: `${target.tool.signature.name}.`}]
            : [];
        }),
        {...scope, prefix: ''},
      ];
  const parameters = new Map<string, ContextualToolParameterState>();
  const mergedArguments: ToolArgumentSource[] = [];
  const mergedSchemas: ToolSignatureSchema['parameters'][number][] = [];
  for (const {target, evaluation, prefix} of components) {
    const tool = target.tool!;
    const name = (value: string) => prefix + value;
    contextualToolParameters(
      tool.signature,
      tool.arguments,
      target.sourceRef,
      evaluation.parameters ?? [],
      evaluation.toolArguments,
    ).forEach((parameter, key) => {
      parameters.set(name(key), {
        ...parameter,
        schema: {...parameter.schema, name: name(key)},
      });
    });
    mergedArguments.push(
      ...tool.arguments.map(argument => ({
        ...argument,
        name: name(argument.name),
      })),
    );
    mergedSchemas.push(
      ...tool.signature.parameters.map(parameter => ({
        ...parameter,
        name: name(parameter.name),
      })),
    );
  }
  if (draft && !draft.calls.some(call => call.signature.name === 'rotate')) {
    for (const [name, parameter] of draftRotationParameters(
      draft.sourceRef,
      ['aroundEdge', 'aroundLine'].includes(draft.selector),
    )) {
      parameters.set(name, parameter);
      mergedSchemas.push(parameter.schema);
    }
  }
  const signature: ToolSignatureSchema = {
    ...sourceTool.signature,
    name: draft ? 'rotate' : sourceTool.signature.name,
    parameters: mergedSchemas,
  };
  const selector = components.find(component =>
    ['pivotVertex', 'aroundEdge', 'pivotPoint', 'aroundLine'].includes(
      component.target.tool!.signature.name,
    ),
  );
  const reference = selector && {
    name:
      selector.prefix +
      (['pivotVertex', 'aroundEdge'].includes(
        selector.target.tool!.signature.name,
      )
        ? 'id'
        : 'reference'),
    sourceRef: selector.target.argumentListRef!,
  };
  return {
    callId: contextualToolCallId(module, scope.target)!,
    signature,
    arguments: mergedArguments,
    parameters,
    rotationSelection: draft,
    reference,
  };
}

/** Argument occurrence, not the upstream editable variable, owns source focus. */
export function contextualParameterAt(
  context: Pick<
    NonNullable<ReturnType<typeof contextualToolContext>>,
    'arguments' | 'reference'
  >,
  cursor: Readonly<{file: string; offset: number}>,
  resolve: (ref: SourceRef) => SourceRef | undefined,
): string | undefined {
  const contains = (source: SourceRef) => {
    const ref = resolve(source);
    return (
      ref?.file === cursor.file &&
      ref.start <= cursor.offset &&
      cursor.offset <= ref.end
    );
  };
  const argument = context.arguments.find(
    argument => argument.target && contains(argument.target.sourceRef),
  );
  return (
    argument?.name ??
    (context.reference && contains(context.reference.sourceRef)
      ? context.reference.name
      : undefined)
  );
}

/** Identity remains stable while a selector gains its offset or final rotate call. */
export function contextualToolCallId(
  module: ModelModule,
  target: SourceTarget,
): string | undefined {
  return (
    target.rotationSelection?.calls[0]?.siteId ??
    module.sourceTargets.find(
      candidate => candidate.id === target.rotationSelectorIds?.[0],
    )?.tool?.callId ??
    target.tool?.callId
  );
}
