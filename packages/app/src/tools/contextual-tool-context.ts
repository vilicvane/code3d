import type {SourceRef} from '@code3d/core/tooling';
import type {SpatialTool, TransformGizmoBinding} from './transform-gizmo';
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

/** Source marks describe the selected semantic target, never another tool's candidate. */
export function contextualToolSource(
  module: ModelModule,
  target: SourceTarget,
  tool: SpatialTool | undefined,
): readonly SourceRef[] {
  if (!target.tool || target.relationArray) return [];
  const sourceTool = targetSpatialTool(target);
  return tool && tool !== sourceTool ? [] : authoredToolSources(module, target);
}

function targetSpatialTool(target: SourceTarget): SpatialTool | undefined {
  const selector = target.rotationSelection?.selector;
  if (selector)
    return ['aroundEdge', 'aroundLine'].includes(selector)
      ? 'rotate-axis'
      : 'rotate-point';
  const name = target.tool?.signature.name;
  if (
    [
      'offset',
      'originOffset',
      'originPoint',
      'originVertex',
      'originCenter',
    ].includes(name ?? '')
  )
    return 'translate';
  if (name === 'rotate')
    return target.evaluations.some(e => e.relationSpatial?.spatial.axisOnly)
      ? 'rotate-axis'
      : 'rotate-point';
  return undefined;
}

/** Resolve a toolbar command once; all consumers then use its selected source target. */
export function contextualToolActivation(
  module: ModelModule,
  scope: Readonly<{target: SourceTarget; evaluation: SourceTargetEvaluation}>,
  tool: SpatialTool | undefined,
  binding?: TransformGizmoBinding,
): SourceRef | undefined {
  const {target, evaluation} = scope;
  if (!tool) return;
  const sources = (target: SourceTarget) =>
    authoredToolSources(module, target).at(-1);
  if (targetSpatialTool(target) === tool) return sources(target);
  const owner =
    evaluation.relationOwnerNodeId &&
    module.objects.get(evaluation.relationOwnerNodeId);
  if (!owner) {
    if (target.tool) return sources(target);
    return binding?.kind === 'spatial'
      ? 'sourceRef' in binding.spatial.source
        ? binding.spatial.source.sourceRef
        : undefined
      : binding?.kind === 'expression'
        ? binding.receiver.sourceRef
        : binding?.completeArguments?.sourceRef;
  }
  const stage = owner.relationStages?.find(stage =>
    evaluation.transformationId
      ? stage.transformationIds.includes(evaluation.transformationId)
      : evaluation.constraintId
        ? stage.constraintIds.includes(evaluation.constraintId)
        : false,
  );
  const owns = (candidate: SourceTarget) =>
    candidate.evaluations.some(
      e =>
        e.relationOwnerNodeId === owner.nodeId &&
        e.contextId === evaluation.contextId,
    );
  const current = targetSpatialTool(target) !== undefined;
  const gap = target.relationArray;
  const candidates = module.sourceTargets
    .filter(candidate => {
      if (
        candidate.rotationToolId ||
        candidate.sourceRef.file !== target.sourceRef.file
      )
        return false;
      if (
        !['on', 'align', 'offset', 'rotate'].includes(
          candidate.tool?.signature.name ?? '',
        ) &&
        !candidate.rotationSelection &&
        !(
          candidate.kind === 'constraint' &&
          owner.constraints.some(constraint => {
            const ref = constraint.sourceRefs[0];
            return (
              ref &&
              ref.file === candidate.sourceRef.file &&
              ref.end === candidate.sourceRef.end
            );
          })
        )
      )
        return false;
      if (candidate.sourceRef.end <= target.sourceRef.end) return false;
      if (
        gap &&
        (candidate.sourceRef.start < gap.start ||
          candidate.sourceRef.end > gap.end)
      )
        return false;
      return candidate.evaluations.some(
        e =>
          e.relationOwnerNodeId === owner.nodeId &&
          e.contextId === evaluation.contextId &&
          (!stage ||
            (e.constraintId && stage.constraintIds.includes(e.constraintId)) ||
            (e.transformationId &&
              stage.transformationIds.includes(e.transformationId))),
      );
    })
    .sort((a, b) => a.sourceRef.end - b.sourceRef.end);
  // Self starts after the jointly solved constraint group. An explicit operation
  // or array gap cannot cross a following constraint to find another transform.
  const next =
    current || gap
      ? candidates[0]
      : candidates.find(candidate => targetSpatialTool(candidate));
  if (next && targetSpatialTool(next) === tool) return sources(next);
  if (gap) return target.sourceRef;
  const anchor = current
    ? target
    : (candidates
        .filter(
          candidate =>
            !targetSpatialTool(candidate) &&
            (!next || candidate.sourceRef.end < next.sourceRef.end),
        )
        .at(-1) ?? target);
  const before =
    next &&
    !current &&
    module.sourceTargets
      .filter(
        candidate =>
          candidate.relationArray &&
          owns(candidate) &&
          candidate.sourceRef.file === target.sourceRef.file &&
          candidate.sourceRef.end <= next.sourceRef.start &&
          candidate.sourceRef.start >= target.sourceRef.start,
      )
      .at(-1);
  if (before) return before.sourceRef;
  const ref = anchor.callRef ?? anchor.sourceRef;
  const after = module.sourceTargets.find(
    candidate =>
      candidate.relationArray &&
      owns(candidate) &&
      candidate.sourceRef.file === ref.file &&
      candidate.sourceRef.start === ref.end,
  );
  return after?.sourceRef ?? sources(anchor) ?? ref;
}

function authoredToolSources(
  module: ModelModule,
  authored: SourceTarget,
): readonly SourceRef[] {
  if (authored.rotationSelection)
    return authored.rotationSelection.calls.map(call => call.sourceRef);
  return [
    ...(authored.rotationSelectorIds ?? []).flatMap(id => {
      const selector = module.sourceTargets.find(
        candidate => candidate.id === id,
      );
      return selector ? [selector] : [];
    }),
    authored,
  ].map(target => target.sourceRef);
}

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
