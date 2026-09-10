import {
  aluminum,
  glass,
  paint,
  plastic,
  rubber,
  type GlassOptions,
  type MetalOptions,
  type PaintOptions,
  type SurfaceOptions,
} from '@code3d/materials';
import {
  Color,
  type MeshPhysicalMaterial,
  type MeshStandardMaterial,
} from '@code3d/core/three';

const surface: SurfaceOptions = {
  color: new Color('#abc'),
  finish: 'matte',
  roughness: 0.2,
  opacity: 0.5,
};
const metal: MetalOptions = {finish: 'polished'};
const transparent: GlassOptions = {finish: 'frosted', thickness: 2};
const coating: PaintOptions = {clearcoat: 0.8};
const standardMaterial: MeshStandardMaterial = plastic(surface);
const physicalMaterial: MeshPhysicalMaterial = glass(transparent);
aluminum(metal);
paint(coating);
standardMaterial.metalness = 0.1;
physicalMaterial.dispersion = 0.1;

// @ts-expect-error Metal finishes are distinct from plastic finishes.
aluminum({finish: 'glossy'});
// @ts-expect-error Rubber does not offer a polished finish.
rubber({finish: 'polished'});
// @ts-expect-error Thickness belongs to transmissive materials.
plastic({thickness: 2});
// @ts-expect-error Roughness is a numeric Three.js parameter.
plastic({roughness: 'matte'});
