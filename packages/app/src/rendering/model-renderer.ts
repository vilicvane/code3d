import * as THREE from 'three';
import type {
  ModelSnapshotObject,
  RenderMesh,
  Transform,
} from '@code3d/core/tooling';

export class ModelRenderer {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(42, 1, 0.1, 2000);
  readonly renderer: THREE.WebGLRenderer;
  private readonly cameraTarget = new THREE.Vector3(0, 20, 0);

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

    const grid = new THREE.GridHelper(360, 36, '#4b5046', '#282b26');
    grid.position.y = -0.08;
    this.scene.add(grid);

    this.camera.position.set(105, 82, 120);
    this.resize();
  }

  resize(): void {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (width === 0 || height === 0) return;

    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  frame(
    target: THREE.Object3D,
    allowZoomIn: boolean,
    cameraTarget = this.cameraTarget,
  ): void {
    const box = new THREE.Box3().setFromObject(target);
    if (box.isEmpty()) return;

    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const direction = this.camera.position
      .clone()
      .sub(cameraTarget)
      .normalize();
    const fittedDistance = Math.max(sphere.radius * 2.8, 24);
    const currentDistance = this.camera.position.distanceTo(cameraTarget);
    const distance = allowZoomIn
      ? fittedDistance
      : Math.max(fittedDistance, currentDistance);
    cameraTarget.copy(sphere.center);
    this.camera.position
      .copy(sphere.center)
      .addScaledVector(direction, distance);
    this.camera.lookAt(cameraTarget);
    this.camera.near = Math.max(distance / 1000, 0.05);
    this.camera.far = Math.max(distance * 20, 1000);
    this.camera.updateProjectionMatrix();
  }

  renderFrame(beforeRender?: () => void): void {
    beforeRender?.();
    this.renderer.render(this.scene, this.camera);
  }

  async captureImage(width: number, height: number): Promise<Blob> {
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
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.render(this.scene, camera);

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

export function createRenderedModelNode(
  node: ModelSnapshotObject,
): THREE.Object3D {
  if (node.kind === 'group') return new THREE.Group();
  if (!node.mesh) {
    throw new Error(`OpenCascade solid ${node.name} has no renderable mesh.`);
  }

  const container = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({
    color: node.color,
    roughness: 0.52,
    metalness: 0.12,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  container.add(new THREE.Mesh(createSurfaceGeometry(node.mesh), material));

  const edgeGeometry = createEdgeGeometry(node.mesh);
  if (edgeGeometry) {
    const edgeMaterial = new THREE.LineBasicMaterial({
      color: '#080a07',
      transparent: true,
      opacity: 0.72,
    });
    const edges = new THREE.LineSegments(edgeGeometry, edgeMaterial);
    edges.userData.edgeGroups = node.mesh.edgeGroups;
    container.add(edges);
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
    if (child instanceof THREE.Mesh || child instanceof THREE.Line) {
      child.geometry.dispose();
      const materials = Array.isArray(child.material)
        ? child.material
        : [child.material];
      materials.forEach(material => material.dispose());
    }
  });
}

export function applyNodeTransform(
  object: THREE.Object3D,
  node: ModelSnapshotObject,
): void {
  applyTransform(object, node.transform);
}

export function applyTransform(
  object: THREE.Object3D,
  transform: Transform,
): void {
  object.position.set(...transform.position);
  object.quaternion.set(...transform.quaternion);
  object.scale.set(...transform.scale);
}
