import {
  Material,
  MaterialLoader,
  type JSONMeta,
  type MaterialJSON,
  type SerializedImage,
  type Texture,
  type TypedArray,
} from './three.js';
import {parseModelColor} from './model-color.js';

/** A color selects the default material for each geometry kind. */
export type ModelMaterialSnapshot = string | Readonly<MaterialJSON>;

/** Capture the authored value before mutable Three.js instances can change. */
export function captureModelMaterial(
  input: Material | string,
): ModelMaterialSnapshot {
  if (typeof input === 'string') {
    parseModelColor(input);
    return input;
  }
  const restored = MaterialLoader.createMaterialFromType(input.type);
  if (
    restored.type !== input.type ||
    restored.constructor !== input.constructor
  ) {
    throw new Error(
      `material() cannot restore the Three.js material type ${JSON.stringify(input.type)}. Import native material classes from @code3d/core/three; custom classes and separate Three.js instances are not supported.`,
    );
  }
  if (
    input.onBeforeCompile !== Material.prototype.onBeforeCompile ||
    input.onBeforeRender !== Material.prototype.onBeforeRender ||
    input.customProgramCacheKey !== Material.prototype.customProgramCacheKey
  ) {
    throw new Error(
      'material() cannot transfer custom material callbacks between the modeling worker and viewport. Use a serializable Three.js material.',
    );
  }
  for (const field of [
    'clippingPlanes',
    'clipIntersection',
    'clipShadows',
    'shadowSide',
    'precision',
  ] as const) {
    if (input[field] !== restored[field]) {
      throw new Error(
        `material() cannot capture ${field}: Three.js material JSON does not serialize this property.`,
      );
    }
  }
  if ('isShaderMaterial' in input) {
    const shader = input as import('./three.js').ShaderMaterial;
    if (
      shader.uniformsGroups.length ||
      shader.index0AttributeName !== undefined ||
      JSON.stringify(shader.defaultAttributeValues) !==
        JSON.stringify(
          (restored as import('./three.js').ShaderMaterial)
            .defaultAttributeValues,
        )
    ) {
      throw new Error(
        'material() cannot capture shader uniform groups, index0AttributeName or custom defaultAttributeValues through Three.js JSON.',
      );
    }
    for (const {value} of Object.values(shader.uniforms)) {
      // Native JSON handles these types only as direct uniform values.
      if (
        value &&
        [
          'isTexture',
          'isColor',
          'isVector2',
          'isVector3',
          'isVector4',
          'isMatrix3',
          'isMatrix4',
        ].some(flag => value[flag])
      )
        continue;
      validatePlainUniform(value);
    }
  }
  restored.dispose();

  const meta: JSONMeta = {
    geometries: {},
    materials: {},
    textures: {},
    images: {},
    shapes: {},
    skeletons: {},
    animations: {},
    nodes: {},
  };
  for (const texture of materialTextures(input)) {
    if (
      texture.isRenderTargetTexture ||
      texture.mipmaps.length ||
      'isVideoTexture' in texture ||
      'isCompressedTexture' in texture ||
      'isData3DTexture' in texture ||
      'isDataArrayTexture' in texture
    ) {
      throw new Error(
        'material() supports loaded image, data and cube textures; live, render-target, compressed and layered textures cannot be captured.',
      );
    }
    const source = texture.source;
    meta.images[source.uuid] = {
      uuid: source.uuid,
      url: Array.isArray(source.data)
        ? source.data.map(image =>
            captureImage(image.isDataTexture ? image.image : image),
          )
        : captureImage(source.data),
    };
  }
  const data = input.toJSON(meta);
  const textures = Object.values(meta.textures);
  const images = Object.values(meta.images);
  if (textures.length) data.textures = textures as MaterialJSON['textures'];
  if (images.length) data.images = images as MaterialJSON['images'];
  // Three.js JSON may still reference userData or shader uniform arrays.
  return JSON.parse(
    JSON.stringify(data, (_key, value: unknown) => {
      if (
        typeof value === 'function' ||
        typeof value === 'symbol' ||
        typeof value === 'bigint'
      ) {
        throw new Error(
          'material() requires serializable material data, including uniforms and userData.',
        );
      }
      if (ArrayBuffer.isView(value) && !(value instanceof DataView))
        return Array.from(value as TypedArray);
      return value;
    }),
  ) as MaterialJSON;
}

function validatePlainUniform(value: unknown): void {
  if (!value || typeof value !== 'object' || ArrayBuffer.isView(value)) return;
  if (
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new Error(
      'material() requires shader uniform arrays and structs to contain plain values; Three.js JSON cannot restore nested native objects.',
    );
  }
  for (const item of Object.values(value)) validatePlainUniform(item);
}

function* materialTextures(material: Material): Iterable<Texture> {
  for (const value of Object.values(material)) {
    if (value?.isTexture) yield value as Texture;
  }
  if ('uniforms' in material) {
    const uniforms = material.uniforms as Record<string, {value: unknown}>;
    for (const {value} of Object.values(uniforms)) {
      for (const item of Array.isArray(value) ? value : [value]) {
        if (item && typeof item === 'object' && 'isTexture' in item)
          yield item as Texture;
      }
    }
  }
}

function captureImage(image: Texture['image']): SerializedImage {
  if (!image)
    throw new Error(
      'material() requires textures to finish loading before assignment.',
    );
  if (typeof image === 'object' && 'data' in image) {
    const pixels = image as {data: TypedArray; width: number; height: number};
    if (!pixels.data || !(pixels.width > 0 && pixels.height > 0))
      throw new Error('material() requires a loaded texture image.');
    return {
      data: Array.from(pixels.data),
      width: pixels.width,
      height: pixels.height,
      type: pixels.data.constructor.name,
    };
  }
  const source = image as
    HTMLImageElement | HTMLCanvasElement | ImageBitmap | OffscreenCanvas;
  const width = 'naturalWidth' in source ? source.naturalWidth : source.width;
  const height =
    'naturalHeight' in source ? source.naturalHeight : source.height;
  if (!(width > 0 && height > 0))
    throw new Error('material() requires a loaded texture image.');
  const canvas =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(width, height)
      : document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d') as
    CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  context.drawImage(source, 0, 0);
  return {
    data: Array.from(context.getImageData(0, 0, width, height).data),
    width,
    height,
    type: 'Uint8Array',
  };
}

/** Base color for CAD formats that cannot encode a complete rendering material. */
export function modelMaterialColor(snapshot: ModelMaterialSnapshot) {
  if (typeof snapshot === 'string') return parseModelColor(snapshot);
  if (snapshot.color === undefined) return undefined;
  const rgb = '#' + snapshot.color.toString(16).padStart(6, '0');
  const alpha = snapshot.transparent ? (snapshot.opacity ?? 1) : 1;
  const hex =
    alpha === 1
      ? rgb
      : rgb +
        Math.round(alpha * 255)
          .toString(16)
          .padStart(2, '0');
  return {rgb, alpha, hex};
}
