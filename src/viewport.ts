import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { ModelModule } from "./model/compiler";
import type {
  ModelSnapshotObject,
  ParameterUsage,
  SourceRef,
  Vec3,
} from "./model/runtime";
import {
  PositionGizmo,
  type PositionAxis,
  type PositionGizmoBinding,
  type PositionGizmoEvent,
} from "./tools/position-gizmo";

export type Occurrence = Readonly<{
  key: string;
  node: ModelSnapshotObject;
  object: THREE.Object3D;
  depth: number;
}>;

export class ModelViewport {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(42, 1, 0.1, 2000);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly controls: OrbitControls;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly root = new THREE.Group();
  private readonly occurrences = new Map<string, Occurrence>();
  private readonly parameterPreviews = new Map<string, number>();
  private readonly occurrenceTranslationPreviews = new Map<string, Vec3>();
  private readonly positionGizmo: PositionGizmo;
  private readonly impactHelpers: THREE.BoxHelper[] = [];
  private selectionHelper: THREE.BoxHelper | null = null;
  private highlightedTargetId?: string;
  private highlightedOccurrenceKeys = new Set<string>();
  private selectedKey = "root";
  private explode = 0;
  private module: ModelModule | null = null;

  constructor(
    private readonly container: HTMLElement,
    private readonly onSelect: (occurrence: Occurrence) => void,
    onPositionTool: (event: PositionGizmoEvent) => void,
  ) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.domElement.className = "viewport-canvas";
    this.container.append(this.renderer.domElement);

    this.scene.background = new THREE.Color("#171815");
    this.scene.fog = new THREE.Fog("#171815", 180, 430);
    this.scene.add(this.root);

    const hemi = new THREE.HemisphereLight("#f6f4df", "#333b40", 1.8);
    this.scene.add(hemi);

    const key = new THREE.DirectionalLight("#fff8df", 3.2);
    key.position.set(70, 110, 80);
    this.scene.add(key);

    const rim = new THREE.DirectionalLight("#90a0ff", 1.6);
    rim.position.set(-80, 55, -65);
    this.scene.add(rim);

    const grid = new THREE.GridHelper(360, 36, "#4b5046", "#282b26");
    grid.position.y = -0.08;
    this.scene.add(grid);

    this.camera.position.set(105, 82, 120);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.075;
    this.controls.target.set(0, 20, 0);
    this.controls.minDistance = 20;
    this.controls.maxDistance = 650;
    this.positionGizmo = new PositionGizmo(
      this.scene,
      this.camera,
      this.renderer.domElement,
      (enabled) => {
        this.controls.enabled = enabled;
      },
      onPositionTool,
    );

    this.renderer.domElement.addEventListener("pointerdown", (event) => {
      this.pick(event);
    });

    new ResizeObserver(() => this.resize()).observe(this.container);
    this.resize();
    this.animate();
  }

  renderModule(
    module: ModelModule,
    selectedKey = "root",
    fitCamera = true,
  ): void {
    this.module = module;
    this.positionGizmo.detach();
    this.clearImpactHelpers();
    this.disposeRoot();
    this.occurrences.clear();
    this.parameterPreviews.clear();
    this.occurrenceTranslationPreviews.clear();
    this.highlightedTargetId = undefined;
    this.highlightedOccurrenceKeys.clear();
    this.root.clear();

    const rootObject = this.buildObject(module.root, "root", 0);
    this.root.add(rootObject);
    this.applyPreviewTransforms();
    this.selectKey(this.occurrences.has(selectedKey) ? selectedKey : "root", false);
    if (fitCamera) {
      this.fit();
    }
  }

  selectBySourceOffset(offset: number): void {
    const candidates = [...this.occurrences.values()]
      .flatMap((occurrence) =>
        occurrence.node.sourceRefs
          .filter((sourceRef) => sourceRef.start <= offset && offset <= sourceRef.end)
          .map((sourceRef) => ({
            occurrence,
            span: sourceRef.end - sourceRef.start,
          })),
      )
      .sort((a, b) => a.span - b.span || b.occurrence.depth - a.occurrence.depth);

    const current = candidates.find(
      ({ occurrence }) => occurrence.key === this.selectedKey,
    );
    const match = current ?? candidates[0];
    if (match) {
      this.selectKey(match.occurrence.key, false);
    }
  }

  selectNode(nodeId: string): void {
    const occurrence = [...this.occurrences.values()].find(
      (candidate) => candidate.node.nodeId === nodeId,
    );
    if (occurrence) {
      this.selectKey(occurrence.key, true);
    }
  }

  selectRoot(): void {
    this.selectKey("root", true);
  }

  getSelected(): Occurrence | undefined {
    return this.occurrences.get(this.selectedKey);
  }

  setExplode(value: number): void {
    this.explode = value;
    this.applyPreviewTransforms();
  }

  setParameterPreview(targetId: string, value: number): void {
    this.parameterPreviews.set(targetId, value);
    if (this.highlightedTargetId !== targetId) {
      this.highlightedTargetId = targetId;
      this.rebuildImpactHelpers();
    }
    this.applyPreviewTransforms();
  }

  clearParameterPreview(targetId: string): void {
    this.parameterPreviews.delete(targetId);
    if (this.highlightedTargetId === targetId) {
      this.highlightedTargetId = this.parameterPreviews.keys().next().value;
      this.rebuildImpactHelpers();
    }
    this.applyPreviewTransforms();
  }

  setOccurrenceTranslationPreview(
    occurrenceKeys: readonly string[],
    delta: Vec3,
  ): void {
    occurrenceKeys.forEach((key) =>
      this.occurrenceTranslationPreviews.set(key, delta),
    );
    this.highlightedOccurrenceKeys = new Set(occurrenceKeys);
    this.rebuildImpactHelpers();
    this.applyPreviewTransforms();
  }

  clearOccurrenceTranslationPreview(occurrenceKeys: readonly string[]): void {
    occurrenceKeys.forEach((key) =>
      this.occurrenceTranslationPreviews.delete(key),
    );
    this.highlightedOccurrenceKeys.clear();
    this.rebuildImpactHelpers();
    this.applyPreviewTransforms();
  }

  cancelPositionTool(): boolean {
    return this.positionGizmo.cancel();
  }

  fit(target: THREE.Object3D = this.root): void {
    const box = new THREE.Box3().setFromObject(target);
    if (box.isEmpty()) {
      return;
    }

    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const direction = this.camera.position
      .clone()
      .sub(this.controls.target)
      .normalize();
    const distance = Math.max(sphere.radius * 2.8, 24);
    this.controls.target.copy(sphere.center);
    this.camera.position.copy(sphere.center).addScaledVector(direction, distance);
    this.camera.near = Math.max(distance / 1000, 0.05);
    this.camera.far = Math.max(distance * 20, 1000);
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  focusSelection(): void {
    const occurrence = this.getSelected();
    if (occurrence) {
      this.fit(occurrence.object);
    }
  }

  private buildObject(node: ModelSnapshotObject, key: string, depth: number): THREE.Object3D {
    const object = createThreeObject(node);
    object.name = node.name;
    object.userData.selectionKey = key;
    applyNodeTransform(object, node);

    const occurrence = { key, node, object, depth };
    this.occurrences.set(key, occurrence);

    node.children.forEach((child, index) => {
      object.add(this.buildObject(child, `${key}/${index}`, depth + 1));
    });

    return object;
  }

  private selectKey(key: string, notify: boolean): void {
    const occurrence = this.occurrences.get(key);
    if (!occurrence) {
      return;
    }
    this.selectedKey = key;
    this.rebuildSelectionHelper();
    this.rebuildImpactHelpers();
    this.updatePositionGizmo();
    if (notify) {
      this.onSelect(occurrence);
    }
  }

  private rebuildSelectionHelper(): void {
    if (this.selectionHelper) {
      this.scene.remove(this.selectionHelper);
      this.selectionHelper.geometry.dispose();
      this.selectionHelper.material.dispose();
      this.selectionHelper = null;
    }

    const occurrence = this.getSelected();
    if (!occurrence) {
      return;
    }
    this.selectionHelper = new THREE.BoxHelper(occurrence.object, "#d8ff3e");
    this.selectionHelper.material.depthTest = false;
    this.selectionHelper.material.transparent = true;
    this.selectionHelper.material.opacity = 0.85;
    this.selectionHelper.renderOrder = 20;
    this.scene.add(this.selectionHelper);
  }

  private updatePositionGizmo(): void {
    const occurrence = this.getSelected();
    if (!occurrence || occurrence.depth === 0) {
      this.positionGizmo.detach();
      return;
    }
    this.positionGizmo.attach(
      occurrence.object,
      positionBindings(
        occurrence,
        [...this.occurrences.values()],
      ),
    );
  }

  private applyPreviewTransforms(): void {
    for (const occurrence of this.occurrences.values()) {
      applyNodeTransform(occurrence.object, occurrence.node);
      const offset: [number, number, number] = [
        ...(this.occurrenceTranslationPreviews.get(occurrence.key) ?? [0, 0, 0]),
      ];
      for (const parameter of occurrence.node.parameters) {
        const previewValue = this.parameterPreviews.get(parameter.target.id);
        if (
          previewValue === undefined ||
          (parameter.operation !== "at" && parameter.operation !== "move")
        ) {
          continue;
        }
        const axis = axisIndex(parameter.argument);
        if (axis !== undefined) {
          offset[axis] +=
            (previewValue - parameter.target.value) * parameter.sensitivity;
        }
      }
      occurrence.object.position.x += offset[0];
      occurrence.object.position.y += offset[1];
      occurrence.object.position.z += offset[2];

      if (occurrence.depth === 1 && this.explode > 0) {
        const factor = 1 + this.explode / 55;
        occurrence.object.position.multiplyScalar(factor);
      }
    }
    this.root.updateMatrixWorld(true);
    this.selectionHelper?.update();
    this.impactHelpers.forEach((helper) => helper.update());
    this.positionGizmo.updateAnchor();
  }

  private pick(event: PointerEvent): void {
    if (this.positionGizmo.isPointerActive()) {
      return;
    }
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);

    const hits = this.raycaster.intersectObjects(this.root.children, true);
    const key = hits
      .map(({ object }) => selectionKeyFromAncestors(object))
      .find((selectionKey) => selectionKey !== undefined);
    if (key) {
      this.selectKey(key, true);
    }
  }

  private resize(): void {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (width === 0 || height === 0) {
      return;
    }
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private animate = (): void => {
    requestAnimationFrame(this.animate);
    this.controls.update();
    this.selectionHelper?.update();
    this.impactHelpers.forEach((helper) => helper.update());
    this.renderer.render(this.scene, this.camera);
  };

  private rebuildImpactHelpers(): void {
    this.clearImpactHelpers();
    if (!this.highlightedTargetId && this.highlightedOccurrenceKeys.size === 0) {
      return;
    }
    for (const occurrence of this.occurrences.values()) {
      if (
        occurrence.key === this.selectedKey ||
        (!this.highlightedOccurrenceKeys.has(occurrence.key) &&
          !occurrence.node.parameters.some(
            (parameter) => parameter.target.id === this.highlightedTargetId,
          ))
      ) {
        continue;
      }
      const helper = new THREE.BoxHelper(occurrence.object, "#8ea2ff");
      helper.material.depthTest = false;
      helper.material.transparent = true;
      helper.material.opacity = 0.72;
      helper.renderOrder = 19;
      this.impactHelpers.push(helper);
      this.scene.add(helper);
    }
  }

  private clearImpactHelpers(): void {
    for (const helper of this.impactHelpers) {
      this.scene.remove(helper);
      helper.geometry.dispose();
      helper.material.dispose();
    }
    this.impactHelpers.length = 0;
  }

  private disposeRoot(): void {
    this.root.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
        object.geometry.dispose();
        const materials = Array.isArray(object.material)
          ? object.material
          : [object.material];
        materials.forEach((material) => material.dispose());
      }
    });
  }
}

function positionBindings(
  occurrence: Occurrence,
  occurrences: readonly Occurrence[],
): PositionGizmoBinding[] {
  const receiver = occurrence.node.sourceRefs.at(-1);
  const parameters = receiver
    ? occurrence.node.parameters.filter(({ expressionRef }) =>
        containsSource(receiver, expressionRef),
      )
    : [];
  const modelParameters = occurrences.flatMap(({ node }) => node.parameters);
  const safeTargets = positionOnlyTargets(modelParameters);
  const byTarget = new Map<
    string,
    {
      target: ParameterUsage["target"];
      sensitivities: Map<PositionAxis, number>;
    }
  >();
  for (const parameter of parameters) {
    if (!safeTargets.has(parameter.target.id)) {
      continue;
    }
    if (parameter.operation !== "at" && parameter.operation !== "move") {
      continue;
    }
    const axis = positionAxis(parameter.argument);
    if (!axis || !Number.isFinite(parameter.sensitivity)) {
      continue;
    }
    const aggregate = byTarget.get(parameter.target.id) ?? {
      target: parameter.target,
      sensitivities: new Map<PositionAxis, number>(),
    };
    aggregate.sensitivities.set(
      axis,
      (aggregate.sensitivities.get(axis) ?? 0) + parameter.sensitivity,
    );
    byTarget.set(parameter.target.id, aggregate);
  }

  const candidates = new Map<PositionAxis, PositionGizmoBinding[]>();
  for (const { target, sensitivities } of byTarget.values()) {
    const effective = [...sensitivities].filter(
      ([, sensitivity]) => Math.abs(sensitivity) > 1e-9,
    );
    if (effective.length !== 1) {
      continue;
    }
    const [axis, sensitivity] = effective[0];
    const binding: PositionGizmoBinding = {
      kind: "parameter",
      axis,
      target,
      label: target.label,
      value: target.value,
      sensitivity,
      parameterKind: target.kind,
      unit: target.unit,
      min: target.min,
      max: target.max,
      step: target.step,
    };
    const axisCandidates = candidates.get(axis) ?? [];
    axisCandidates.push(binding);
    candidates.set(axis, axisCandidates);
  }

  return (["x", "y", "z"] as const).flatMap((axis) => {
    const axisCandidates = candidates.get(axis) ?? [];
    if (axisCandidates.length === 1) {
      return axisCandidates;
    }
    if (!receiver) {
      return [];
    }
    const occurrenceKeys = occurrences
      .filter(({ node }) =>
        node.sourceRefs.some((sourceRef) => sameSource(sourceRef, receiver)),
      )
      .map(({ key }) => key);
    return [
      {
        kind: "expression",
        axis,
        label: `Δ${axis.toUpperCase()}`,
        value: 0,
        sensitivity: 1,
        parameterKind: "length",
        step: 0.5,
        receiver: { sourceRef: receiver },
        occurrenceKeys,
      },
    ];
  });
}

function containsSource(container: SourceRef, candidate: SourceRef): boolean {
  return container.start <= candidate.start && candidate.end <= container.end;
}

function sameSource(left: SourceRef, right: SourceRef): boolean {
  return left.start === right.start && left.end === right.end;
}

function positionOnlyTargets(parameters: readonly ParameterUsage[]): Set<string> {
  const usages = new Map<string, ParameterUsage[]>();
  for (const parameter of parameters) {
    const targetUsages = usages.get(parameter.target.id) ?? [];
    targetUsages.push(parameter);
    usages.set(parameter.target.id, targetUsages);
  }

  const safe = new Set<string>();
  for (const [targetId, targetUsages] of usages) {
    const axes = new Set(
      targetUsages.map((usage) =>
        usage.operation === "at" || usage.operation === "move"
          ? positionAxis(usage.argument)
          : undefined,
      ),
    );
    if (
      axes.size === 1 &&
      !axes.has(undefined) &&
      targetUsages.every(
        ({ sensitivity }) =>
          Number.isFinite(sensitivity) && Math.abs(sensitivity) > 1e-9,
      )
    ) {
      safe.add(targetId);
    }
  }
  return safe;
}

function positionAxis(argument: string): PositionAxis | undefined {
  if (argument === "x") return "x";
  if (argument === "y") return "y";
  if (argument === "z") return "z";
  return undefined;
}

function axisIndex(argument: string): 0 | 1 | 2 | undefined {
  if (argument === "x") return 0;
  if (argument === "y") return 1;
  if (argument === "z") return 2;
  return undefined;
}

function createThreeObject(node: ModelSnapshotObject): THREE.Object3D {
  if (node.kind === "group") {
    return new THREE.Group();
  }

  if (!node.mesh) {
    throw new Error(`OpenCascade solid ${node.name} 没有可渲染网格。`);
  }

  const container = new THREE.Group();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(node.mesh.vertices, 3),
  );
  if (node.mesh.normals.length === node.mesh.vertices.length) {
    geometry.setAttribute(
      "normal",
      new THREE.BufferAttribute(node.mesh.normals, 3),
    );
  } else {
    geometry.computeVertexNormals();
  }
  geometry.setIndex(new THREE.BufferAttribute(node.mesh.triangles, 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  const material = new THREE.MeshStandardMaterial({
    color: node.color,
    roughness: 0.52,
    metalness: 0.12,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  container.add(new THREE.Mesh(geometry, material));

  if (node.mesh.edges.length > 0) {
    const edgeGeometry = new THREE.BufferGeometry();
    edgeGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(node.mesh.edges, 3),
    );
    const edgeMaterial = new THREE.LineBasicMaterial({
      color: "#080a07",
      transparent: true,
      opacity: 0.72,
    });
    container.add(new THREE.LineSegments(edgeGeometry, edgeMaterial));
  }

  return container;
}

function applyNodeTransform(object: THREE.Object3D, node: ModelSnapshotObject): void {
  object.position.set(...node.transform.position);
  object.rotation.set(
    THREE.MathUtils.degToRad(node.transform.rotation[0]),
    THREE.MathUtils.degToRad(node.transform.rotation[1]),
    THREE.MathUtils.degToRad(node.transform.rotation[2]),
  );
  object.scale.set(...node.transform.scale);
}

function selectionKeyFromAncestors(object: THREE.Object3D): string | undefined {
  let current: THREE.Object3D | null = object;
  while (current) {
    if (typeof current.userData.selectionKey === "string") {
      return current.userData.selectionKey;
    }
    current = current.parent;
  }
  return undefined;
}
