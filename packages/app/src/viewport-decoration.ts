import type {
  ModelModule,
  SourceTarget,
  SourceTargetEvaluation,
} from './model/compiler';
import type {
  EdgeId,
  ElementKind,
  ModelOperationInputRole,
  RenderMesh,
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
  operationRole?: ModelOperationInputRole;
}>;

export type ViewportMeshDecoration = ViewportDecorationBase &
  Readonly<{
    kind: 'mesh';
    /** When present, transform is local to each visible occurrence of this node. */
    nodeId?: string;
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
    /** When present, transform is local to each visible occurrence of this node. */
    nodeId?: string;
    mesh: RenderMesh;
    edgeIds?: readonly EdgeId[];
    transform: Transform;
    appearance: ViewportDecorationAppearance;
  }>;

type ViewportAnchorDecorationBase = ViewportDecorationBase &
  Readonly<{
    kind: 'anchor';
    nodeId: string;
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
    nodeId: string;
    mesh: RenderMesh;
    appearance: ViewportDecorationAppearance;
  }>;

export type ViewportBoundsDecoration = ViewportDecorationBase &
  Readonly<{
    kind: 'bounds';
    nodeId: string;
    /** Exact reference extent; replaces the occurrence's generic selection box. */
    size: Vec3;
    transform: Transform;
    appearance: ViewportDecorationAppearance;
  }>;

export type ViewportDecoration =
  | ViewportMeshDecoration
  | ViewportEdgeDecoration
  | ViewportSurfaceDecoration
  | ViewportBoundsDecoration
  | ViewportAnchorDecoration;

export type SourceDecorationContext = Readonly<{
  module: ModelModule;
  target: SourceTarget;
  evaluation: SourceTargetEvaluation;
}>;

export type SourceDecorationProvider = Readonly<{
  id: string;
  previewBehavior?: 'keep' | 'hide';
  decorations(context: SourceDecorationContext): readonly ViewportDecoration[];
}>;
