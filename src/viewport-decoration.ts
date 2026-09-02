import type {ModelModule, SourceTarget} from './model/compiler';
import type {RenderMesh, Transform} from './model/runtime';

export type ViewportDecorationAppearance = Readonly<{
  color: string;
  opacity?: number;
  emissive?: string;
  emissiveIntensity?: number;
  edgeColor?: string;
  edgeOpacity?: number;
  depthBias?: number;
  depthTest?: boolean;
}>;

export type ViewportDecoration = Readonly<{
  id: string;
  mesh: RenderMesh;
  transform: Transform;
  appearance: ViewportDecorationAppearance;
}>;

export type SourceDecorationContext = Readonly<{
  module: ModelModule;
  target: SourceTarget;
}>;

export type SourceDecorationProvider = Readonly<{
  id: string;
  previewBehavior?: 'keep' | 'hide';
  decorations(context: SourceDecorationContext): readonly ViewportDecoration[];
}>;
