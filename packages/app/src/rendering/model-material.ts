import * as THREE from 'three';
import {
  parseModelColor,
  type ModelKind,
  type ModelMaterialSnapshot,
} from '@code3d/core/tooling';

const texturesByMaterial = new WeakMap<
  THREE.Material,
  readonly THREE.Texture[]
>();

/** Restore an owned Three.js instance, preserving all authored rendering flags. */
export function createModelMaterial(
  snapshot: ModelMaterialSnapshot | undefined,
  kind: ModelKind,
): THREE.Material {
  if (snapshot !== undefined && typeof snapshot !== 'string') {
    const loader = new THREE.ObjectLoader();
    const images = loader.parseImages(snapshot.images ?? [], () => {});
    const textures = loader.parseTextures(snapshot.textures ?? [], images);
    const material = new THREE.MaterialLoader()
      .setTextures(textures)
      .parse(snapshot);
    texturesByMaterial.set(material, Object.values(textures));
    return material;
  }
  const color = snapshot === undefined ? undefined : parseModelColor(snapshot);
  const opacity = color?.alpha ?? 1;
  const parameters = {
    color: color?.rgb ?? '#dde0dc',
    opacity,
    transparent: opacity < 1,
    depthWrite: opacity === 1,
  };
  if (kind === 'vertex')
    return new THREE.PointsMaterial({
      ...parameters,
      size: 5,
      sizeAttenuation: false,
    });
  if (kind === 'edge')
    return new THREE.LineBasicMaterial({...parameters, toneMapped: false});
  return new THREE.MeshStandardMaterial({
    ...parameters,
    roughness: 0.52,
    metalness: 0.12,
    side: kind === 'face' ? THREE.DoubleSide : THREE.FrontSide,
  });
}

export function disposeModelMaterial(material: THREE.Material): void {
  material.dispose();
  for (const texture of texturesByMaterial.get(material) ?? [])
    texture.dispose();
  texturesByMaterial.delete(material);
}
