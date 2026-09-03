import type {
  ModelModule,
  SourceTarget,
  SourceTargetEvaluation,
} from './model/compiler';
import type {EdgeId, ElementKind, RenderMesh, Transform} from './model/runtime';

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

export type ViewportMeshDecoration = Readonly<{
  kind: 'mesh';
  id: string;
  mesh: RenderMesh;
  transform: Transform;
  appearance: ViewportDecorationAppearance;
}>;

export type ViewportEdgeDecoration = Readonly<{
  kind: 'edges';
  id: string;
  mesh: RenderMesh;
  edgeIds?: readonly EdgeId[];
  transform: Transform;
  appearance: ViewportDecorationAppearance;
}>;

type ViewportAnchorDecorationBase = Readonly<{
  kind: 'anchor';
  id: string;
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

export type ViewportSurfaceDecoration = Readonly<{
  kind: 'surface';
  id: string;
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
