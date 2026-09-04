import * as THREE from 'three';

type AxisView = Readonly<{
  direction: THREE.Vector3;
  group: SVGGElement;
  line: SVGLineElement;
  marker: SVGCircleElement;
  label: SVGTextElement;
}>;

const svgNamespace = 'http://www.w3.org/2000/svg';
const center = 44;
const axisLength = 27;

export class ViewportCoordinateReference {
  private readonly root = document.createElement('div');
  private readonly caption = document.createElement('span');
  private readonly axes: readonly AxisView[];
  private readonly cameraQuaternion = new THREE.Quaternion();
  private readonly frameQuaternion = new THREE.Quaternion();
  private readonly projectedCameraQuaternion = new THREE.Quaternion();
  private readonly projectedFrameQuaternion = new THREE.Quaternion();
  private readonly viewDirection = new THREE.Vector3();
  private hasProjection = false;
  private target?: THREE.Object3D;

  constructor(
    container: HTMLElement,
    private readonly camera: THREE.Camera,
  ) {
    this.root.className = 'viewport-coordinate-reference';
    this.root.setAttribute('role', 'img');

    const svg = document.createElementNS(svgNamespace, 'svg');
    svg.setAttribute('viewBox', '0 0 88 88');
    svg.setAttribute('aria-hidden', 'true');

    const backplate = document.createElementNS(svgNamespace, 'circle');
    backplate.classList.add('viewport-coordinate-backplate');
    backplate.setAttribute('cx', String(center));
    backplate.setAttribute('cy', String(center));
    backplate.setAttribute('r', '38');
    svg.append(backplate);

    const origin = document.createElementNS(svgNamespace, 'circle');
    origin.classList.add('viewport-coordinate-origin');
    origin.setAttribute('cx', String(center));
    origin.setAttribute('cy', String(center));
    origin.setAttribute('r', '2.25');
    svg.append(origin);

    this.axes = (
      [
        ['x', new THREE.Vector3(1, 0, 0)],
        ['y', new THREE.Vector3(0, 1, 0)],
        ['z', new THREE.Vector3(0, 0, 1)],
      ] as const
    ).map(([name, direction]) => {
      const group = document.createElementNS(svgNamespace, 'g');
      group.classList.add('viewport-coordinate-axis');
      group.dataset.axis = name;

      const line = document.createElementNS(svgNamespace, 'line');
      line.setAttribute('x1', String(center));
      line.setAttribute('y1', String(center));

      const marker = document.createElementNS(svgNamespace, 'circle');
      marker.setAttribute('r', '7');

      const label = document.createElementNS(svgNamespace, 'text');
      label.textContent = name.toUpperCase();

      group.append(line, marker, label);
      svg.append(group);
      return {direction, group, line, marker, label};
    });

    this.root.append(svg, this.caption);
    container.append(this.root);
    this.updateLabel();
  }

  setTarget(target?: THREE.Object3D): void {
    this.target = target;
    this.hasProjection = false;
    this.updateLabel();
  }

  update(): void {
    if (this.target) {
      this.target.updateWorldMatrix(true, false);
      this.target.getWorldQuaternion(this.frameQuaternion);
    } else {
      this.frameQuaternion.identity();
    }
    this.camera.getWorldQuaternion(this.cameraQuaternion).invert();
    if (
      this.hasProjection &&
      this.projectedCameraQuaternion.equals(this.cameraQuaternion) &&
      this.projectedFrameQuaternion.equals(this.frameQuaternion)
    ) {
      return;
    }
    this.hasProjection = true;
    this.projectedCameraQuaternion.copy(this.cameraQuaternion);
    this.projectedFrameQuaternion.copy(this.frameQuaternion);

    const depthSortedAxes = this.axes
      .map(axis => {
        this.viewDirection
          .copy(axis.direction)
          .applyQuaternion(this.frameQuaternion)
          .applyQuaternion(this.cameraQuaternion);
        const x = center + this.viewDirection.x * axisLength;
        const y = center - this.viewDirection.y * axisLength;
        axis.line.setAttribute('x2', x.toFixed(2));
        axis.line.setAttribute('y2', y.toFixed(2));
        axis.marker.setAttribute('cx', x.toFixed(2));
        axis.marker.setAttribute('cy', y.toFixed(2));
        axis.label.setAttribute('x', x.toFixed(2));
        axis.label.setAttribute('y', y.toFixed(2));
        axis.group.style.opacity = String(
          0.58 + (this.viewDirection.z + 1) * 0.21,
        );
        return {axis, depth: this.viewDirection.z};
      })
      .sort((left, right) => left.depth - right.depth);

    depthSortedAxes.forEach(({axis}) =>
      axis.group.parentElement?.append(axis.group),
    );
  }

  private updateLabel(): void {
    if (!this.target) {
      this.caption.textContent = 'WORLD XYZ';
      this.root.setAttribute('aria-label', 'World X, Y, Z coordinate axes');
      this.root.title = 'World coordinate frame';
      return;
    }
    const targetName = this.target.name || 'selected model';
    this.caption.textContent = 'LOCAL XYZ';
    this.root.setAttribute(
      'aria-label',
      `Local X, Y, Z coordinate axes for ${targetName}`,
    );
    this.root.title = `Local coordinate frame · ${targetName}`;
  }
}
