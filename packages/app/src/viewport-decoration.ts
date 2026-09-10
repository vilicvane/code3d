import type {
  ModelModule,
  SourceTarget,
  SourceTargetEvaluation,
} from './model/compiler';
import type {ToolParameterSchema} from './model/tool-schema';
import type {
  EdgeId,
  ElementKind,
  ModelOperationInputRole,
  ModelParameterDimension,
  RenderMesh,
  TopologyId,
  TopologyKind,
  Transform,
  Vec3,
} from '@code3d/core/tooling';

export type ViewportDecorationAppearance = Readonly<{
  color: string;
  opacity?: number;
  emissive?: string;
  emissiveIntensity?: number;
  edgeColor?: string;
  edgeOpacity?: number;
  depthBias?: number;
  depthTest?: boolean;
  shading?: 'lit' | 'unlit';
}>;

type ViewportDecorationBase = Readonly<{
  id: string;
  /** Geometry and transforms are local to each visible occurrence of this node. */
  nodeId: string;
  operationRole?: ModelOperationInputRole;
}>;

export type ViewportMeshDecoration = ViewportDecorationBase &
  Readonly<{
    kind: 'mesh';
    mesh: RenderMesh;
    transform: Transform;
    appearance: ViewportDecorationAppearance;
  }>;

export type ViewportEdgeDecoration = ViewportDecorationBase &
  Readonly<{
    kind: 'edges';
    /** Supplement the outline only while this occurrence has no bounds highlight. */
    visibility?: 'without-object-bounds';
    /** Show short, screen-capped segments at each endpoint of the mesh edges. */
    corners?: boolean;
    mesh: RenderMesh;
    edgeIds?: readonly EdgeId[];
    transform: Transform;
    appearance: ViewportDecorationAppearance;
  }>;

type ViewportAnchorDecorationBase = ViewportDecorationBase &
  Readonly<{
    kind: 'anchor';
    /** Geometry follows spatial previews; the operation frame excludes their geometric delta. */
    frame?: 'geometry' | 'operation';
    transform: Transform;
    facing?: 1 | -1;
    direction?: 1 | -1;
    /** Draw a single arrow in a line reference's authored direction. */
    directed?: boolean;
    /** Existing curve geometry supplies the shaft; this frame is its endpoint. */
    headOnly?: boolean;
    layer?: 'reference' | 'foreground';
    appearance: ViewportDecorationAppearance;
  }>;

export type ViewportAnchorDecoration =
  | (ViewportAnchorDecorationBase &
      Readonly<{
        elementKind: 'line';
        span: Readonly<{negative: number; positive: number}>;
      }>)
  | (ViewportAnchorDecorationBase &
      Readonly<{
        elementKind: Exclude<ElementKind, 'line'>;
      }>);

export type ViewportSurfaceDecoration = ViewportDecorationBase &
  Readonly<{
    kind: 'surface';
    mesh: RenderMesh;
    appearance: ViewportDecorationAppearance;
  }>;

export type ViewportBoundsDecoration = ViewportDecorationBase &
  Readonly<{
    kind: 'bounds';
    /** Exact reference extent; replaces the occurrence's generic selection box. */
    size: Vec3;
    transform: Transform;
    appearance: ViewportDecorationAppearance;
  }>;

export type ViewportTopologyDecoration = ViewportDecorationBase &
  Readonly<{
    kind: 'topology';
    visibility?: 'without-topology-selection';
    mesh: RenderMesh;
    topologyKind: TopologyKind;
    ids: readonly TopologyId[];
    transform: Transform;
    appearance: ViewportDecorationAppearance;
  }>;

export type ViewportDimensionDecoration = ViewportDecorationBase &
  Readonly<{
    kind: 'dimension';
    mesh: RenderMesh;
    dimension: ModelParameterDimension;
    appearance: ViewportDecorationAppearance;
  }>;

export type ViewportDecoration =
  | ViewportMeshDecoration
  | ViewportEdgeDecoration
  | ViewportSurfaceDecoration
  | ViewportBoundsDecoration
  | ViewportTopologyDecoration
  | ViewportDimensionDecoration
  | ViewportAnchorDecoration;

export type SourceDecorationContext = Readonly<{
  module: ModelModule;
  target: SourceTarget;
  evaluation: SourceTargetEvaluation;
  parameter?: ToolParameterSchema;
}>;

export type SourceDecorationProvider = Readonly<{
  id: string;
  previewBehavior?: 'keep' | 'hide';
  decorations(context: SourceDecorationContext): readonly ViewportDecoration[];
}>;
