import {box, group, line, point, sphere} from '@code3d/core';
import * as THREE from '@code3d/core/three';

// Regression fixture for capture-by-value, independent of the introductory example.
const lacquer = new THREE.MeshPhysicalMaterial({
  color: '#eb633e',
  clearcoat: 1,
});
const warm = sphere(9).originOffset(24, 0, 0).material(lacquer);
lacquer.color.set('#388eb5');
const cool = sphere(9).material(lacquer);
const checker = new THREE.DataTexture(
  new Uint8Array([
    216, 255, 62, 255, 35, 48, 45, 255, 35, 48, 45, 255, 216, 255, 62, 255,
  ]),
  2,
  2,
);
checker.colorSpace = THREE.SRGBColorSpace;
checker.magFilter = checker.minFilter = THREE.NearestFilter;
checker.wrapS = checker.wrapT = THREE.RepeatWrapping;
checker.repeat.set(3, 3);
const textured = box(16, 16, 16)
  .originOffset(-24, 0, 0)
  .material(new THREE.MeshBasicMaterial({map: checker, toneMapped: false}));
const baseline = line([-34, -13, 0], [34, -13, 0]).material(
  new THREE.LineDashedMaterial({color: '#8ed5d1', dashSize: 2, gapSize: 1}),
);
const marker = point([34, -13, 0]).material(
  new THREE.PointsMaterial({color: '#d8ff3e', size: 8, sizeAttenuation: false}),
);
export const materialsExample = group([warm, cool, textured, baseline, marker]);
