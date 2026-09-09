import {box, group, line, point, sphere} from '@code3d/core';
import {
  DataTexture,
  LineDashedMaterial,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  NearestFilter,
  PointsMaterial,
  RepeatWrapping,
  SRGBColorSpace,
} from '@code3d/core/three';

// Native Three.js materials are captured by value at each material() call.
const lacquer = new MeshPhysicalMaterial({
  color: '#eb633e',
  roughness: 0.25,
  metalness: 0.1,
  clearcoat: 1,
  clearcoatRoughness: 0.12,
});
const warm = sphere(9).originOffset(24, 0, 0).material(lacquer);
lacquer.color.set('#388eb5');
const cool = sphere(9).material(lacquer);
// warm keeps its original color even after lacquer changes.

const checker = new DataTexture(
  new Uint8Array([
    216, 255, 62, 255, 35, 48, 45, 255, 35, 48, 45, 255, 216, 255, 62, 255,
  ]),
  2,
  2,
);
checker.colorSpace = SRGBColorSpace;
checker.magFilter = NearestFilter;
checker.minFilter = NearestFilter;
checker.wrapS = checker.wrapT = RepeatWrapping;
checker.repeat.set(3, 3);
// Each face has normalized native UVs; texture repeat controls the pattern.
const textured = box(16, 16, 16)
  .originOffset(-24, 0, 0)
  .material(new MeshBasicMaterial({map: checker, toneMapped: false}));

// Curves and vertices accept their corresponding native material classes.
const baseline = line([-34, -13, 0], [34, -13, 0]).material(
  new LineDashedMaterial({color: '#8ed5d1', dashSize: 2, gapSize: 1}),
);
const marker = point([34, -13, 0]).material(
  new PointsMaterial({color: '#d8ff3e', size: 8, sizeAttenuation: false}),
);

// Switch the viewport to Render to see the authored materials without guides.
export const materialsExample = group([warm, cool, textured, baseline, marker]);
