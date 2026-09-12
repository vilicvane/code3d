import {box, sphere} from '@code3d/core';
import * as THREE from '@code3d/core/three';

// A plain color is enough for most models.
export const plain = box(16, 16, 16).material('#8ed5d1');

// Use a native material when you need control over its surface properties.
export const lacquered = sphere(9).material(makeLacquer());

// A texture uses the model's native UV coordinates.
export const textured = box(16, 16, 16).material(makeCheckerMaterial());

// Select an exported name, then switch to Render to inspect its appearance.
function makeLacquer() {
  return new THREE.MeshPhysicalMaterial({
    color: '#eb633e',
    roughness: 0.25,
    metalness: 0.1,
    clearcoat: 1,
    clearcoatRoughness: 0.12,
  });
}

function makeCheckerMaterial() {
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
  return new THREE.MeshStandardMaterial({map: checker, roughness: 0.65});
}
