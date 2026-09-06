import type * as THREE from 'three';

export type MaterialDraw = {
  color: string;
  opacity: number;
  segments: number | undefined;
};

export function createMaterialDrawObserver() {
  const callbacks = new WeakMap<
    THREE.Object3D,
    THREE.Object3D['onBeforeRender']
  >();
  return (root: THREE.Object3D, onDraw: (draw: MaterialDraw) => void) => {
    root.traverse(part => {
      if (!isDrawable(part)) return;
      const material = Array.isArray(part.material)
        ? part.material[0]
        : part.material;
      const before = callbacks.get(part) ?? part.onBeforeRender;
      callbacks.set(part, before);
      part.onBeforeRender = (...args) => {
        before.apply(part, args);
        const color = (
          'color' in material
            ? material.color
            : (material as THREE.ShaderMaterial).uniforms.color.value
        ) as THREE.Color;
        onDraw({
          color: color.getHexString(),
          opacity: material.opacity,
          segments: isInstancedGeometry(part.geometry)
            ? part.geometry.instanceCount
            : undefined,
        });
      };
    });
  };
}

// Vite can rebuild its dependency graph between viewport creation and this
// fixture's dynamic import. Three's flags survive that module boundary;
// constructor identity does not.
function isDrawable(
  object: THREE.Object3D,
): object is THREE.Mesh | THREE.Line | THREE.Points {
  return 'isMesh' in object || 'isLine' in object || 'isPoints' in object;
}

function isInstancedGeometry(
  geometry: THREE.BufferGeometry,
): geometry is THREE.InstancedBufferGeometry {
  return 'isInstancedBufferGeometry' in geometry;
}
