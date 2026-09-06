import {Line, type Object3D} from 'three';
import {LineSegments2} from 'three/addons/lines/LineSegments2.js';
import {ScreenSpaceArrowHead} from '../../src/rendering/screen-space-arrow-head.ts';
type HeadMeasurement = {
  visible: boolean;
  opacity: number;
  tip: number;
  size: number[];
};
type MarkerMeasurement = {
  role: string;
  heads: HeadMeasurement[];
  curve: boolean;
  shafts: number;
  position: import('@code3d/core/tooling').Vec3;
  direction: 1 | -1 | undefined;
};

export function inspectDirectionMarkers(root: Object3D) {
  const markers: MarkerMeasurement[] = [];
  root.traverse(object => {
    const decoration = object.userData.decoration as
      import('../../src/viewport-decoration.ts').ViewportDecoration | undefined;
    if (decoration?.kind === 'anchor' && decoration.directed) {
      let shafts = 0;
      const heads: HeadMeasurement[] = [];
      object.traverse(child => {
        if (
          (child instanceof Line || child instanceof LineSegments2) &&
          child.visible
        )
          shafts++;
        if (child.name === 'direction-arrow-head') {
          if (!(child instanceof ScreenSpaceArrowHead))
            throw new Error('Expected screen-space arrow geometry');
          child.geometry.computeBoundingBox();
          heads.push({
            visible: child.visible,
            opacity: child.material.opacity,
            tip: child.geometry.boundingBox!.max.y,
            size: child.material.uniforms.headSize.value.toArray(),
          });
        }
      });
      markers.push({
        role: decoration.id.includes(':target:') ? 'target' : 'source',
        heads,
        curve: !!decoration.headOnly,
        shafts,
        position: decoration.transform.position,
        direction: decoration.direction,
      });
    }
  });
  return markers;
}

export function lineWidths(root: Object3D): number[] {
  const widths: number[] = [];
  root.traverse(object => {
    if (object instanceof LineSegments2) widths.push(object.material.linewidth);
  });
  return widths;
}
