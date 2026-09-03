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
} from '@code3d/core/tooling';

export type ViewportDecorationAppearance = Readonly<{
  color: string;
  opacity?: number;
  emissive?: string;
  emissiveIntensity?: number;
  edgeColor?: string;
  edgeOpacity?: number;
  lineWidth?: number;
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
    mesh: RenderMesh;
    transform: Transform;
    appearance: ViewportDecorationAppearance;
  }>;

export type ViewportEdgeDecoration = ViewportDecorationBase &
  Readonly<{
    kind: 'edges';
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
    markerSize: number;
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

export type ViewportDecoration =
  | ViewportMeshDecoration
  | ViewportEdgeDecoration
  | ViewportSurfaceDecoration
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
