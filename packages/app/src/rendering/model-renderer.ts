import {
  modelingScenePreset,
  renderScenePresets,
  RenderScenePreference,
  type RenderScenePreset,
  type ScenePreset,
} from './render-scene';
import {AdaptiveGrid} from './adaptive-grid';
import {action, computed, makeObservable, observableRef, reaction} from 'mobx';
import {appSettings, type AppSettings} from '../app-settings';
import * as THREE from 'three';
import {createModelMaterial, disposeModelMaterial} from './model-material';
import {orientImageCamera, type ImageView} from './image-camera';
import {
  createViewCamera,
  frameCameraBounds,
  resizeViewCamera,
  type CameraFraming,
  type ViewCamera,
} from './view-camera';
import type {
  ModelSnapshotObject,
  RenderMesh,
  SketchSnapshot,
  SketchPosition,
  Transform,
} from '@code3d/core/tooling';
import {
  sketchCurveGeometry,
  sketchCurvePosition,
  sketchPointResolver,
} from '@code3d/core/tooling';
import {
  applySketchEmphasis,
  applySourceEmphasis,
  modelRenderOrder,
  type SourceEmphasis,
} from './source-appearance';

const defaultSurfaceOpacity = 0.68;
const boundaryColor = '#080a07';
const boundaryOpacity = 0.72;

export type ModelRenderMode = 'modeling' | 'render';

type ModelMaterial = THREE.Material;
type ModelPrimitive =
  | THREE.Mesh<THREE.BufferGeometry, ModelMaterial>
  | THREE.Line<THREE.BufferGeometry, ModelMaterial>
  | THREE.Points<THREE.BufferGeometry, ModelMaterial>;

const modelingHelpers = new WeakSet<THREE.Object3D>();
const renderMaterials = new WeakMap<
  THREE.Object3D,
  Readonly<{object: ModelPrimitive; material: ModelMaterial}>
>();

export function modelingHelper<T extends THREE.Object3D>(object: T): T {
  modelingHelpers.add(object);
  return object;
}

function withRenderMaterial<T extends ModelPrimitive>(
  object: T,
  opacity = object.material.opacity,
): T {
  const material = object.material;
  const preview = material.clone();
  if (opacity < material.opacity) {
    preview.opacity = opacity;
    preview.transparent = true;
    preview.depthWrite = false;
  }
  if (object instanceof THREE.Mesh) {
    preview.polygonOffset = true;
    preview.polygonOffsetFactor = 1;
    preview.polygonOffsetUnits = 1;
  }
  const layer = preview.depthTest ? 'ordinary' : 'foreground';
  object.renderOrder =
    modelRenderOrder[layer][object instanceof THREE.Mesh ? 'surface' : 'line'];
  if (layer === 'foreground') {
    preview.transparent = true;
    preview.depthWrite = false;
  }
  object.material = preview;
  renderMaterials.set(object, {object, material});
  return object;
}

export class ModelRenderer {
  private renderMode: ModelRenderMode = 'modeling';
  readonly scene = new THREE.Scene();
  camera: ViewCamera = createViewCamera('perspective', 1);
  readonly renderer: THREE.WebGLRenderer;
  readonly grid: AdaptiveGrid;
  private readonly renderSize = new THREE.Vector2();
  private readonly stopSettings: () => void;
  private readonly stopScenePreset: () => void;
  private readonly hemisphere = new THREE.HemisphereLight('#ffffff', '#737373');
  private readonly ambient = new THREE.AmbientLight('#ffffff');
  private readonly key = new THREE.DirectionalLight('#ffffff');
  private readonly rim = new THREE.DirectionalLight('#ffffff');
  private readonly environments = new Map<ScenePreset, THREE.DataTexture>();
  private readonly contentBounds = new THREE.Box3();
  private readonly contentSphere = new THREE.Sphere();

  constructor(
    private readonly container: HTMLElement,
    private readonly onChange: () => void = () => {},
    private readonly settings: AppSettings = appSettings,
    private readonly scenePreference = new RenderScenePreference(),
  ) {
    makeObservable<this, 'renderMode' | 'activeScenePreset'>(this, {
      renderMode: observableRef,
      mode: computed,
      scenePreset: computed,
      activeScenePreset: computed,
      setMode: action,
      setScenePreset: action,
    });
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    configureRenderer(this.renderer, this.pixelRatio());
    this.renderer.domElement.className = 'viewport-canvas';
    this.container.append(this.renderer.domElement);
    this.renderer.domElement.addEventListener('webglcontextrestored', onChange);

    this.scene.background = new THREE.Color(modelingScenePreset.background);
    this.rim.position.set(-80, 55, -65);
    this.scene.add(this.hemisphere, this.ambient, this.key, this.rim);

    this.grid = modelingHelper(new AdaptiveGrid(this.scene.background));
    this.scene.add(this.grid);

    this.camera.position.set(105, 82, 120);
    this.stopScenePreset = reaction(
      () => this.activeScenePreset,
      preset => {
        let environment = this.environments.get(preset);
        if (!environment) {
          environment = createStudioEnvironment(preset.environment);
          this.environments.set(preset, environment);
        }
        (this.scene.background as THREE.Color).set(preset.background);
        this.scene.environment = environment;
        this.hemisphere.intensity = preset.hemisphere;
        this.ambient.intensity = preset.ambient;
        this.key.intensity = preset.key;
        this.key.position.set(...preset.keyPosition);
        this.rim.intensity = preset.rim;
        this.onChange();
      },
      {fireImmediately: true},
    );
    this.stopSettings = reaction(
      () => settings.value.pixelRatioLimit,
      () => this.resize(),
      {fireImmediately: true},
    );
    window.addEventListener('pagehide', this.dispose, {once: true});
  }

  get mode(): ModelRenderMode {
    return this.renderMode;
  }

  setMode(mode: ModelRenderMode): void {
    this.renderMode = mode;
  }

  get scenePreset(): RenderScenePreset {
    return this.scenePreference.preset;
  }

  setScenePreset(preset: RenderScenePreset): void {
    this.scenePreference.select(preset);
  }

  private get activeScenePreset(): ScenePreset {
    return this.mode === 'modeling'
      ? modelingScenePreset
      : renderScenePresets[this.scenePreset];
  }

  dispose = (): void => {
    this.stopSettings();
    this.stopScenePreset();
    window.removeEventListener('pagehide', this.dispose);
    this.renderer.domElement.removeEventListener(
      'webglcontextrestored',
      this.onChange,
    );
    this.renderer.dispose();
    for (const texture of this.environments.values()) texture.dispose();
    this.environments.clear();
  };

  private pixelRatio(): number {
    return Math.min(
      window.devicePixelRatio,
      this.settings.value.pixelRatioLimit ?? Infinity,
    );
  }

  resize(): void {
    this.renderer.setPixelRatio(this.pixelRatio());
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (width === 0 || height === 0) return;

    this.renderer.setSize(width, height, false);
    resizeViewCamera(this.camera, width / height);
    this.onChange();
  }

  framing(
    target: THREE.Object3D,
    camera: ViewCamera,
    additional?: Readonly<{bounds: THREE.Box3; paddingPixels: number}>,
  ): CameraFraming | undefined {
    const box = new THREE.Box3().setFromObject(target);
    if (additional) box.union(additional.bounds);
    if (box.isEmpty()) return;

    const availableFraction = additional
      ? Math.max(
          0.25,
          1 -
            (2 * additional.paddingPixels) /
              Math.min(this.container.clientWidth, this.container.clientHeight),
        )
      : 1;
    return frameCameraBounds(camera, box, availableFraction);
  }

  updateCameraRange(
    cameraTarget: THREE.Vector3,
    viewDistance: number,
    content?: THREE.Object3D,
  ): void {
    this.grid.focus.copy(cameraTarget);
    const distance = this.camera.position.distanceTo(cameraTarget);
    const shift = distance - viewDistance;
    const near = Math.max(Number.EPSILON, shift + viewDistance / 1000);
    let far = shift + Math.max(viewDistance * 20, 1000);
    if (content) {
      this.contentBounds.setFromObject(content);
      if (!this.contentBounds.isEmpty()) {
        this.contentBounds.getBoundingSphere(this.contentSphere);
        far = Math.max(
          far,
          this.camera.position.distanceTo(this.contentSphere.center) +
            this.contentSphere.radius * 1.01,
        );
      }
    }
    if (near !== this.camera.near || far !== this.camera.far) {
      this.camera.near = near;
      this.camera.far = far;
      this.camera.updateProjectionMatrix();
    }
  }

  renderFrame(beforeRender?: () => void): void {
    beforeRender?.();
    this.renderScene(this.renderer, this.camera);
  }

  private renderScene(
    renderer: THREE.WebGLRenderer,
    camera: ViewCamera,
    focus = this.grid.focus,
  ): void {
    renderer.getSize(this.renderSize);
    this.grid.update(
      camera,
      this.renderSize.y,
      renderer.getPixelRatio(),
      focus,
    );
    if (this.mode === 'modeling') {
      renderer.render(this.scene, camera);
      return;
    }
    const hidden: THREE.Object3D[] = [];
    const restored: {
      object: ModelPrimitive;
      material: ModelMaterial;
      renderOrder: number;
    }[] = [];
    // Keep modeling state intact, including source emphasis and active previews.
    // Screen frames and image exports use the same authored material pass.
    try {
      this.scene.traverseVisible(child => {
        if (modelingHelpers.has(child)) {
          hidden.push(child);
          child.visible = false;
        }
        const appearance = renderMaterials.get(child);
        if (!appearance) return;
        const {object, material} = appearance;
        restored.push({
          object,
          material: object.material,
          renderOrder: object.renderOrder,
        });
        object.material = material;
        object.renderOrder = 0;
      });
      renderer.render(this.scene, camera);
    } finally {
      for (const object of hidden) object.visible = true;
      for (const {object, material, renderOrder} of restored) {
        object.material = material;
        object.renderOrder = renderOrder;
      }
    }
  }

  async captureImage(
    width: number,
    height: number,
    beforeRender?: (
      camera: THREE.Camera,
      width: number,
      height: number,
    ) => void,
    framing?: Readonly<{view: ImageView; bounds: THREE.Box3}>,
  ): Promise<Blob> {
    const canvas = document.createElement('canvas');
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true,
    });
    configureRenderer(renderer, 1);
    renderer.setSize(width, height, false);

    const camera = this.camera.clone();
    resizeViewCamera(camera, width / height);
    if (framing) orientImageCamera(camera, framing.bounds, framing.view);
    camera.updateProjectionMatrix();
    beforeRender?.(camera, width, height);
    try {
      this.renderScene(
        renderer,
        camera,
        framing?.bounds.getCenter(new THREE.Vector3()),
      );
    } finally {
      this.renderer.getSize(this.renderSize);
      this.grid.update(
        this.camera,
        this.renderSize.y,
        this.renderer.getPixelRatio(),
      );
    }

    const image = await new Promise<Blob | null>(resolve =>
      canvas.toBlob(resolve, 'image/png'),
    );
    renderer.dispose();
    renderer.forceContextLoss();
    if (!image) throw new Error('The browser could not encode the PNG image.');
    return image;
  }
}

function configureRenderer(
  renderer: THREE.WebGLRenderer,
  pixelRatio: number,
): void {
  renderer.setPixelRatio(pixelRatio);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
}

export function createRenderedModel(node: ModelSnapshotObject): THREE.Object3D {
  const object = createRenderedModelNode(node);
  object.name = node.name;
  applyNodeTransform(object, node);
  node.children.forEach(child => object.add(createRenderedModel(child)));
  return object;
}

/** Passive sketch geometry in its XZ plane; no faces, constraints or editing state. */
export function createRenderedSketch(
  layers: readonly SketchSnapshot[],
  emphasis: SourceEmphasis,
  selectedPoints: ReadonlyMap<number, SourceEmphasis> = new Map(),
): THREE.Group {
  const object = new THREE.Group();
  const resolve = sketchPointResolver(layers);
  const points = new Map(
    layers.flatMap(layer =>
      layer.entities.flatMap(entity =>
        entity.kind === 'point'
          ? [[JSON.stringify([layer.id, entity.id]), entity] as const]
          : [],
      ),
    ),
  );
  const addressKey = (ref: {layer: string; id: number}) => {
    const address = resolve(ref);
    return JSON.stringify([address.layer, address.id]);
  };
  const point = (ref: {layer: string; id: number}) =>
    points.get(addressKey(ref))!.position;
  const selected = new Map(
    [...selectedPoints].map(([id, emphasis]) => [
      addressKey({layer: layers.at(-1)!.id, id}),
      emphasis,
    ]),
  );
  const coordinate = ([x, y]: SketchPosition) => [x, 0, -y];
  const seen = new Set<string>();
  for (const layer of layers)
    for (const entity of layer.entities) {
      const geometry = new THREE.BufferGeometry();
      let primitive: THREE.Points | THREE.LineSegments;
      let role = emphasis;
      if (entity.kind === 'point') {
        const ref = {layer: layer.id, id: entity.id};
        const key = addressKey(ref);
        if (seen.has(key)) {
          geometry.dispose();
          continue;
        }
        seen.add(key);
        role = selected.get(key) ?? role;
        geometry.setAttribute(
          'position',
          new THREE.Float32BufferAttribute(coordinate(point(ref)), 3),
        );
        primitive = new THREE.Points(
          geometry,
          createModelMaterial(undefined, 'vertex'),
        );
      } else {
        const curve = sketchCurveGeometry(entity, point)!;
        const count =
          curve.kind === 'line'
            ? 1
            : Math.max(
                1,
                Math.ceil(
                  (curve.kind === 'circle'
                    ? 2 * Math.PI
                    : Math.abs(curve.sweep)) /
                    (Math.PI / 64),
                ),
              );
        const positions: number[] = [];
        for (let i = 0; i < count; i++)
          positions.push(
            ...coordinate(sketchCurvePosition(curve, i / count)),
            ...coordinate(sketchCurvePosition(curve, (i + 1) / count)),
          );
        geometry.setAttribute(
          'position',
          new THREE.Float32BufferAttribute(positions, 3),
        );
        primitive = new THREE.LineSegments(
          geometry,
          createModelMaterial(undefined, 'edge'),
        );
      }
      primitive.userData.sketchEntity = {layer: layer.id, id: entity.id};
      applySketchEmphasis(primitive, role);
      object.add(primitive);
    }
  return object;
}

export type ModelPlacement = 'standalone' | 'composition';

export function createRenderedModelNode(
  node: ModelSnapshotObject,
  onChange?: () => void,
): THREE.Object3D {
  if (node.kind === 'group' || node.kind === 'reference')
    return new THREE.Group();
  if (!node.mesh) {
    throw new Error(`OpenCascade solid ${node.name} has no renderable mesh.`);
  }

  const material = createModelMaterial(node.material, node.kind, onChange);
  const alpha = material.transparent ? material.opacity : 1;
  const container = new THREE.Group();
  if (node.kind === 'vertex') {
    const pointGeometry = new THREE.BufferGeometry();
    pointGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(node.mesh.topologyVertices, 3),
    );
    container.add(
      withRenderMaterial(new THREE.Points(pointGeometry, material)),
    );
    return container;
  }
  const edgeGeometry = createEdgeGeometry(node.mesh);
  if (node.kind === 'edge') {
    if (edgeGeometry) {
      const curve = new THREE.LineSegments(edgeGeometry, material);
      if (material instanceof THREE.LineDashedMaterial)
        curve.computeLineDistances();
      curve.userData.edgeGroups = node.mesh.edgeGroups;
      container.add(withRenderMaterial(curve));
    } else {
      disposeModelMaterial(material);
    }
    return container;
  }

  container.add(
    withRenderMaterial(
      new THREE.Mesh(createSurfaceGeometry(node.mesh), material),
      node.material === undefined ? defaultSurfaceOpacity : material.opacity,
    ),
  );

  if (edgeGeometry) {
    const edgeMaterial = new THREE.LineBasicMaterial({
      color: boundaryColor,
      transparent: true,
      opacity: boundaryOpacity * alpha,
      depthTest: material.depthTest,
      depthWrite: false,
    });
    const edges = new THREE.LineSegments(edgeGeometry, edgeMaterial);
    edges.renderOrder =
      modelRenderOrder[material.depthTest ? 'ordinary' : 'foreground'].line;
    edges.userData.edgeGroups = node.mesh.edgeGroups;
    container.add(modelingHelper(edges));
  }

  return container;
}

export function createSurfaceGeometry(mesh: RenderMesh): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(mesh.vertices, 3),
  );
  if (mesh.normals.length === mesh.vertices.length) {
    geometry.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3));
  } else {
    geometry.computeVertexNormals();
  }
  geometry.setIndex(new THREE.BufferAttribute(mesh.triangles, 1));
  if (mesh.uvs)
    geometry.setAttribute('uv', new THREE.BufferAttribute(mesh.uvs, 2));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

export function createEdgeGeometry(
  mesh: RenderMesh,
): THREE.BufferGeometry | undefined {
  if (mesh.edges.length === 0) return undefined;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(mesh.edges, 3));
  return geometry;
}

export function disposeObject(object: THREE.Object3D): void {
  object.traverse(child => {
    if (
      child instanceof THREE.Mesh ||
      child instanceof THREE.Line ||
      child instanceof THREE.Points
    ) {
      child.geometry.dispose();
      const materials = Array.isArray(child.material)
        ? child.material
        : [child.material];
      materials.forEach(disposeModelMaterial);
      const authored = renderMaterials.get(child)?.material;
      if (authored) disposeModelMaterial(authored);
    }
  });
}

export function applyNodeTransform(
  object: THREE.Object3D,
  node: ModelSnapshotObject,
  placement: ModelPlacement = 'standalone',
): void {
  applyTransform(
    object,
    placement === 'composition' ? node.compositionTransform : node.transform,
  );
}

export function applyTransform(
  object: THREE.Object3D,
  transform: Transform,
): void {
  object.position.set(...transform.position);
  object.quaternion.set(...transform.quaternion);
  object.scale.set(...transform.scale);
}

/** CPU-backed white softboxes; each screen/export renderer owns its GPU reflection cache. */
function createStudioEnvironment(
  preset: ScenePreset['environment'],
): THREE.DataTexture {
  const width = 256;
  const height = 128;
  const data = new Float32Array(width * height * 4);
  const softboxes = [
    new THREE.Vector3(1, 1, 1).normalize(),
    new THREE.Vector3(-1, 0.6, -1).normalize(),
    new THREE.Vector3(-1, 0.3, 1).normalize(),
  ];
  const direction = new THREE.Vector3();
  for (let y = 0; y < height; y++) {
    const latitude = ((y + 0.5) / height - 0.5) * Math.PI;
    for (let x = 0; x < width; x++) {
      const longitude = ((x + 0.5) / width - 0.5) * Math.PI * 2;
      direction.set(
        Math.cos(latitude) * Math.cos(longitude),
        Math.sin(latitude),
        Math.cos(latitude) * Math.sin(longitude),
      );
      let light = preset.ambient + preset.sky * Math.max(direction.y, 0);
      for (const [i, softbox] of softboxes.entries())
        light +=
          preset.softboxes[i] *
          Math.exp((direction.dot(softbox) - 1) * preset.sharpness);
      const index = (y * width + x) * 4;
      data[index] = data[index + 1] = data[index + 2] = light;
      data[index + 3] = 1;
    }
  }
  const texture = new THREE.DataTexture(
    data,
    width,
    height,
    THREE.RGBAFormat,
    THREE.FloatType,
  );
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.needsUpdate = true;
  return texture;
}
