import * as THREE from 'three';

export type SourceEmphasis = 'primary' | 'secondary' | 'context';

/** Each modeling layer finishes its surfaces before drawing its outlines. */
export const modelRenderOrder = {
  context: {surface: -2, line: -1},
  ordinary: {surface: 0, line: 1},
  foreground: {surface: 2, line: 3},
} as const;

export const sourceContextAppearance = {
  color: '#788078',
  opacity: 0.18,
  edgeColor: '#a1aa9d',
  edgeOpacity: 0.28,
} as const;

const opacityLimits = {
  primary: {surface: 0.82, line: 1},
  secondary: {surface: 0.4, line: 0.5},
  context: {
    surface: sourceContextAppearance.opacity,
    line: sourceContextAppearance.edgeOpacity,
  },
} as const;

export function applySourceEmphasis(
  object: THREE.Object3D,
  emphasis: SourceEmphasis,
): void {
  object.traverse(child => {
    if (!(
      child instanceof THREE.Mesh ||
      child instanceof THREE.Line ||
      child instanceof THREE.Points
    ))
      return;
    const materials = Array.isArray(child.material)
      ? child.material
      : [child.material];
    for (const material of materials) {
      const surface = child instanceof THREE.Mesh;
      const layer =
        emphasis === 'context'
          ? 'context'
          : material.depthTest
            ? 'ordinary'
            : 'foreground';
      child.renderOrder = modelRenderOrder[layer][surface ? 'surface' : 'line'];
      if (emphasis === 'context') {
        if ('color' in material && material.color instanceof THREE.Color)
          material.color.set(
            surface
              ? sourceContextAppearance.color
              : sourceContextAppearance.edgeColor,
          );
      } else if (layer === 'foreground') {
        // Depth-independent inspector materials must composite after ordinary
        // translucent bodies too; Three otherwise sorts them by object origin.
        material.transparent = true;
        material.depthWrite = false;
      }
      // Ensure the model is see-through without compounding its own opacity.
      const limit = opacityLimits[emphasis];
      material.opacity = Math.min(
        material.opacity,
        surface ? limit.surface : limit.line,
      );
      if (material.opacity < 1) {
        material.transparent = true;
        material.depthWrite = false;
      }
    }
  });
}
