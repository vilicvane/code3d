import type {
  ModelModule,
  SourceTarget,
  SourceTargetEvaluation,
} from './model/compiler';
import type {ElementKind, RenderMesh, Transform} from './model/runtime';

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

export type ViewportAnchorDecoration = Readonly<{
  kind: 'anchor';
  id: string;
  nodeId: string;
  elementKind: ElementKind;
  transform: Transform;
  size: number;
  appearance: ViewportDecorationAppearance;
}>;

export type ViewportSurfaceDecoration = Readonly<{
  kind: 'surface';
  id: string;
  nodeId: string;
  mesh: RenderMesh;
  appearance: ViewportDecorationAppearance;
}>;

export type ViewportDecoration =
  ViewportMeshDecoration | ViewportSurfaceDecoration | ViewportAnchorDecoration;

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
