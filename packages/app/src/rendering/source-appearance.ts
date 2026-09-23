import * as THREE from 'three';
import {LineSegments2} from 'three/addons/lines/LineSegments2.js';
import type {LineMaterial} from 'three/addons/lines/LineMaterial.js';

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

/**
 * The decoration band above model layers: translucent surfaces composite
 * first, then inspected sketch geometry, bounds marks, glyphs (rings, arrows,
 * frames), hover marks and topology highlights, so no member of the band is
 * tinted by a coincident patch and pick feedback stays on top.
 */
export const decorationRenderOrder = {
  contextSketch: -1,
  surface: 24,
  sketch: 25,
  mark: 26,
  glyph: 27,
  hover: 28,
  topology: 29,
} as const;

/** Sketch geometry keeps the 2D drawing accent instead of the model palette. */
export const sketchAppearance = {
  color: '#d8ff3e',
  opacity: {primary: 1, secondary: 0.7, context: 0.35},
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

/**
 * Sketch geometry lies on or inside models, so it composites after the
 * translucent bodies of its level instead of being dimmed by a face drawn
 * later; only the weakened context level keeps depth testing.
 */
export function applySketchEmphasis(
  object: THREE.Object3D,
  emphasis: SourceEmphasis,
): void {
  object.traverse(child => {
    if (!(
      child instanceof THREE.Line ||
      child instanceof THREE.Points ||
      child instanceof LineSegments2
    ))
      return;
    const material = child.material as
      THREE.LineBasicMaterial | THREE.PointsMaterial | LineMaterial;
    material.color.set(sketchAppearance.color);
    material.toneMapped = false;
    material.transparent = true;
    material.depthWrite = false;
    material.depthTest = emphasis === 'context';
    material.opacity = sketchAppearance.opacity[emphasis];
    child.renderOrder =
      emphasis === 'context'
        ? decorationRenderOrder.contextSketch
        : decorationRenderOrder.sketch;
  });
}
