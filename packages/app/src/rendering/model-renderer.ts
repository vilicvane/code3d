import {AdaptiveGrid} from './adaptive-grid';
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
  Transform,
} from '@code3d/core/tooling';

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
  object.material = preview;
  renderMaterials.set(object, {object, material});
  return object;
}

export class ModelRenderer {
  mode: ModelRenderMode = 'modeling';
  readonly scene = new THREE.Scene();
  camera: ViewCamera = createViewCamera('perspective', 1);
  readonly renderer: THREE.WebGLRenderer;
  readonly grid: AdaptiveGrid;
  private readonly renderSize = new THREE.Vector2();

  constructor(private readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    configureRenderer(this.renderer, Math.min(window.devicePixelRatio, 2));
    this.renderer.domElement.className = 'viewport-canvas';
    this.container.append(this.renderer.domElement);

    this.scene.background = new THREE.Color('#171815');
    this.scene.fog = new THREE.Fog('#171815', 180, 430);
    this.scene.add(
      new THREE.HemisphereLight('#f6f4df', '#333b40', 1.8),
      new THREE.AmbientLight('#eef0e8', 2.4),
    );

    const key = new THREE.DirectionalLight('#fff8df', 3.2);
    key.position.set(70, 110, 80);
    this.scene.add(key);

    const rim = new THREE.DirectionalLight('#90a0ff', 1.6);
    rim.position.set(-80, 55, -65);
    this.scene.add(rim);

    this.grid = modelingHelper(new AdaptiveGrid(this.scene.background));
    this.scene.add(this.grid);

    this.camera.position.set(105, 82, 120);
    this.resize();
  }

  resize(): void {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (width === 0 || height === 0) return;

    this.renderer.setSize(width, height, false);
    resizeViewCamera(this.camera, width / height);
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

  updateCameraRange(cameraTarget: THREE.Vector3, viewDistance: number): void {
    this.grid.focus.copy(cameraTarget);
    const distance = this.camera.position.distanceTo(cameraTarget);
    const shift = distance - viewDistance;
    const near = Math.max(Number.EPSILON, shift + viewDistance / 1000);
    const far = shift + Math.max(viewDistance * 20, 1000);
    if (near !== this.camera.near || far !== this.camera.far) {
      this.camera.near = near;
      this.camera.far = far;
      this.camera.updateProjectionMatrix();
    }
    const fog = this.scene.fog;
    if (fog instanceof THREE.Fog) {
      fog.near = shift + Math.max(180, viewDistance * 2);
      fog.far = shift + Math.max(430, viewDistance * 5);
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

export type ModelPlacement = 'standalone' | 'composition';

export function createRenderedModelNode(
  node: ModelSnapshotObject,
): THREE.Object3D {
  if (node.kind === 'group' || node.kind === 'reference')
    return new THREE.Group();
  if (!node.mesh) {
    throw new Error(`OpenCascade solid ${node.name} has no renderable mesh.`);
  }

  const material = createModelMaterial(node.material, node.kind);
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
      depthWrite: alpha === 1,
    });
    const edges = new THREE.LineSegments(edgeGeometry, edgeMaterial);
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
