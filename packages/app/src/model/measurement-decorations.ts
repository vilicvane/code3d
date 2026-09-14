import {
  composeTransforms,
  invertTransform,
  identityRigidTransform,
  type DistanceSnapshot,
  type ElementSnapshot,
  type Vec3,
} from '@code3d/core/tooling';
import type {SourceDecorationProvider} from '../viewport-decoration';
import type {ModelModule, SourceTargetEvaluation} from './compiler';
import {
  finiteElementDecorations,
  namedElementDecorations,
  sourceElementReferences,
  secondaryElementMarkerOpacity,
} from './element-decorations';

export const measurementSourceDecoration: SourceDecorationProvider = {
  id: 'measurement',
  decorations({module, evaluation}) {
    const measurement = evaluation.measurement;
    if (!measurement) return [];
    const owner = measurement.operands[0].nodeId;
    const pose = measurement.placements.find(
      value => value.nodeId === owner,
    )!.transform;
    const local = invertTransform(pose);
    const point = (position: Vec3) =>
      composeTransforms(local, {position, quaternion: [0, 0, 0, 1]}).position;
    const focused = focusedElements(evaluation, measurement);
    const models = measuredModelIds(module, measurement);
    const elements = new Map<
      string,
      {
        nodeId: string;
        element: ElementSnapshot;
        primary: boolean;
        selected: boolean;
      }
    >();
    for (const operand of measurement.operands) {
      if (models.has(operand.nodeId) && operand.whole) continue;
      for (const element of operand.elements) {
        elements.set(elementKey(operand.nodeId, element), {
          nodeId: operand.nodeId,
          element,
          selected: false,
          primary:
            !evaluation.focusNodeIds?.length ||
            (!focused.length &&
              evaluation.focusNodeIds.includes(operand.nodeId)),
        });
      }
    }
    for (const {nodeId, element} of focused) {
      elements.set(elementKey(nodeId, element), {
        nodeId,
        element,
        primary: true,
        selected: true,
      });
    }
    return [
      ...[...elements.values()].flatMap(
        ({nodeId, element, primary, selected}, index) => {
          const node = module.objects.get(nodeId);
          const opacity = primary ? 1 : secondaryElementMarkerOpacity;
          return node
            ? (selected && element.bound
                ? namedElementDecorations(node, element)
                : finiteElementDecorations(module, node, element)
              ).map(decoration => ({
                ...decoration,
                id: `measurement:${index}:${decoration.id}`,
                appearance: {
                  ...decoration.appearance,
                  opacity: (decoration.appearance.opacity ?? 1) * opacity,
                  edgeOpacity: decoration.appearance.edgeColor
                    ? (decoration.appearance.edgeOpacity ?? 1) * opacity
                    : undefined,
                },
              }))
            : [];
        },
      ),
      {
        kind: 'measurement',
        id: 'distance',
        nodeId: owner,
        start: point(measurement.start),
        end: point(measurement.end),
        value: measurement.value,
        axisLabel:
          measurement.axisName?.toUpperCase() ??
          (measurement.axis ? 'axis' : undefined),
        appearance: {color: '#c4c4c4', opacity: 0.92, depthTest: false},
      },
    ];
  },
};

/** Whole bodies use their existing model rendering, not overlapping face fills. */
export function measuredModelIds(
  module: ModelModule,
  measurement: DistanceSnapshot | undefined,
): ReadonlySet<string> {
  return new Set(
    measurement?.operands.flatMap(operand => {
      const kind = module.objects.get(operand.nodeId)?.kind;
      return operand.whole && (kind === 'solid' || kind === 'group')
        ? [operand.nodeId]
        : [];
    }),
  );
}

function focusedElements(
  evaluation: SourceTargetEvaluation,
  measurement: DistanceSnapshot,
): {
  nodeId: string;
  element: ElementSnapshot;
}[] {
  const selection = evaluation.selection;
  const references = [
    ...(evaluation.topologyReferences ?? []),
    ...(selection
      ? selection.ids.map(id => ({
          nodeId: selection.inputNodeId,
          name: '',
          kind: selection.kind === 'edges' ? ('edge' as const) : selection.kind,
          id,
          geometryNodeId:
            selection.scope?.geometryNodeId ?? selection.inputNodeId,
          transform: selection.scope?.transform ?? {
            ...identityRigidTransform,
            scale: [1, 1, 1] as const,
          },
        }))
      : []),
  ];
  return [
    ...sourceElementReferences(evaluation).flatMap(({nodeId, ...element}) => {
      // An exposed group is one named frame with several finite geometry parts.
      const parts =
        element.kind === 'frame'
          ? measurement.operands
              .filter(operand => operand.nodeId === nodeId)
              .flatMap(operand =>
                operand.elements.filter(
                  part => part.name === element.name && part.topology,
                ),
              )
          : [];
      return (parts.length ? parts : [element]).map(element => ({
        nodeId,
        element,
      }));
    }),
    ...references.map(({nodeId, name, ...topology}) => ({
      nodeId,
      element: {
        name,
        kind:
          topology.kind === 'surface'
            ? ('face' as const)
            : topology.kind === 'edge'
              ? ('line' as const)
              : topology.kind === 'vertex'
                ? ('point' as const)
                : ('frame' as const),
        transform: topology.transform,
        topology,
      },
    })),
  ];
}

function elementKey(nodeId: string, element: ElementSnapshot): string {
  const topology = element.topology;
  return JSON.stringify(
    topology
      ? [
          nodeId,
          topology.kind,
          topology.geometryNodeId,
          topology.kind === 'solid' ? undefined : topology.id,
          topology.transform,
        ]
      : [nodeId, element.kind, element.transform, element.bound?.size],
  );
}
