import {
  Color,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  type ColorRepresentation,
  type MeshPhysicalMaterialParameters,
} from '@code3d/core/three';

/** Native Three.js color; use opacity for alpha transparency. */
export type MaterialColor = ColorRepresentation;
export type SurfaceFinish = 'matte' | 'satin' | 'glossy';
export type MetalFinish = 'satin' | 'polished';
export type RubberFinish = 'matte' | 'satin';
export type GlassFinish = 'clear' | 'frosted';

/** Explicit roughness overrides finish. Opacity below 1 enables transparency. */
export type MaterialOptions<Finish extends string> = Readonly<{
  color?: MaterialColor;
  finish?: Finish;
  roughness?: number;
  opacity?: number;
}>;

export type SurfaceOptions = MaterialOptions<SurfaceFinish>;
export type MetalOptions = MaterialOptions<MetalFinish>;
export type RubberOptions = MaterialOptions<RubberFinish>;
export type GlassOptions = MaterialOptions<GlassFinish> &
  Readonly<
    Pick<
      MeshPhysicalMaterialParameters,
      | 'transmission'
      | 'ior'
      | 'thickness'
      | 'attenuationColor'
      | 'attenuationDistance'
    >
  >;
export type PaintOptions = SurfaceOptions &
  Readonly<
    Pick<MeshPhysicalMaterialParameters, 'clearcoat' | 'clearcoatRoughness'>
  >;

const surfaceRoughness = {matte: 0.8, satin: 0.4, glossy: 0.12};
const metalRoughness = {satin: 0.32, polished: 0.08};
const rubberRoughness = {matte: 0.95, satin: 0.65};
const glassRoughness = {clear: 0.03, frosted: 0.45};

/** General-purpose plastic, with a satin surface by default. */
export function plastic(
  input: MaterialColor | SurfaceOptions = {},
): MeshStandardMaterial {
  return new MeshStandardMaterial(
    parameters(
      {name: 'plastic', color: '#d9dce0', roughness: 0.4, metalness: 0},
      input,
      surfaceRoughness,
    ),
  );
}

/** Dark matte rubber for grips, seals and feet. */
export function rubber(
  input: MaterialColor | RubberOptions = {},
): MeshStandardMaterial {
  return new MeshStandardMaterial(
    parameters(
      {name: 'rubber', color: '#252525', roughness: 0.95, metalness: 0},
      input,
      rubberRoughness,
    ),
  );
}

/** Light neutral aluminum with a satin finish. */
export function aluminum(
  input: MaterialColor | MetalOptions = {},
): MeshStandardMaterial {
  return metal('aluminum', '#d6d9dc', input);
}

/** Neutral steel for fasteners and mechanical parts. */
export function steel(
  input: MaterialColor | MetalOptions = {},
): MeshStandardMaterial {
  return metal('steel', '#a6adb4', input);
}

/** Warm yellow brass for inserts and fittings. */
export function brass(
  input: MaterialColor | MetalOptions = {},
): MeshStandardMaterial {
  return metal('brass', '#cfaa64', input);
}

/** Reddish copper for conductors and copper parts. */
export function copper(
  input: MaterialColor | MetalOptions = {},
): MeshStandardMaterial {
  return metal('copper', '#c78564', input);
}

/** Clear glass. Thickness is in model units; 0 is a thin-walled surface. */
export function glass(
  input: MaterialColor | GlassOptions = {},
): MeshPhysicalMaterial {
  return transparentSolid('glass', 1.5, input);
}

/** Clear acrylic. Thickness is in model units; 0 is a thin-walled surface. */
export function acrylic(
  input: MaterialColor | GlassOptions = {},
): MeshPhysicalMaterial {
  return transparentSolid('acrylic', 1.49, input);
}

/** White ceramic, glossy by default; matte and satin finishes are available. */
export function ceramic(
  input: MaterialColor | SurfaceOptions = {},
): MeshStandardMaterial {
  return new MeshStandardMaterial(
    parameters(
      {name: 'ceramic', color: '#f2eee5', roughness: 0.12, metalness: 0},
      input,
      surfaceRoughness,
    ),
  );
}

/** Painted surface; finish controls both the base and clear coat roughness. */
export function paint(
  input: MaterialColor | PaintOptions = {},
): MeshPhysicalMaterial {
  const values = parameters(
    {
      name: 'paint',
      color: '#c94935',
      roughness: 0.12,
      metalness: 0,
      clearcoat: 1,
    },
    input,
    surfaceRoughness,
  );
  return new MeshPhysicalMaterial({
    ...values,
    clearcoatRoughness: values.clearcoatRoughness ?? values.roughness,
  });
}

function metal(
  name: string,
  color: MaterialColor,
  input: MaterialColor | MetalOptions,
): MeshStandardMaterial {
  return new MeshStandardMaterial(
    parameters(
      {name, color, roughness: 0.32, metalness: 1},
      input,
      metalRoughness,
    ),
  );
}

function transparentSolid(
  name: string,
  ior: number,
  input: MaterialColor | GlassOptions,
): MeshPhysicalMaterial {
  return new MeshPhysicalMaterial(
    parameters(
      {
        name,
        color: '#ffffff',
        roughness: 0.03,
        metalness: 0,
        transmission: 1,
        thickness: 0,
        ior,
      },
      input,
      glassRoughness,
    ),
  );
}

function parameters<Finish extends string>(
  defaults: MeshPhysicalMaterialParameters,
  input: MaterialColor | MaterialOptions<Finish>,
  finishes: Readonly<Record<Finish, number>>,
): MeshPhysicalMaterialParameters {
  const options =
    typeof input !== 'object' || input instanceof Color
      ? {color: input}
      : input;
  const {finish, ...values} = options;
  const opacity = values.opacity ?? 1;
  return {
    ...defaults,
    ...values,
    color: values.color ?? defaults.color,
    roughness:
      values.roughness ??
      (finish === undefined ? defaults.roughness : finishes[finish]),
    opacity,
    transparent: opacity < 1,
  };
}
