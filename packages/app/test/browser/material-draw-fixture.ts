import * as THREE from 'three';

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
      if (!(
        part instanceof THREE.Mesh ||
        part instanceof THREE.Line ||
        part instanceof THREE.Points
      ))
        return;
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
          segments:
            part.geometry instanceof THREE.InstancedBufferGeometry
              ? part.geometry.instanceCount
              : undefined,
        });
      };
    });
  };
}
