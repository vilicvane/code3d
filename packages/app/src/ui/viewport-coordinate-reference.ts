import * as THREE from 'three';
import {spatialAxisColors} from '../spatial-axis-colors';

type AxisEndView = Readonly<{
  name: 'x' | 'y' | 'z';
  kind: 'positive' | 'negative';
  direction: THREE.Vector3;
  group: SVGGElement;
  line?: SVGLineElement;
  marker: SVGCircleElement;
  outline: SVGCircleElement;
  hitArea: SVGCircleElement;
  label?: SVGTextElement;
}>;

type CoordinateActions = Readonly<{
  onSelect(direction: THREE.Vector3, up: THREE.Vector3): void;
  onReset(frame: THREE.Quaternion): void;
}>;

const svgNamespace = 'http://www.w3.org/2000/svg';
// Fit the 38px backplate radius and its 1px stroke without extra SVG padding.
const center = 38.5;
const axisLength = 27;

export class ViewportCoordinateReference {
  private readonly root = document.createElement('div');
  private readonly axisEnds: readonly AxisEndView[];
  private readonly cameraQuaternion = new THREE.Quaternion();
  private readonly frameQuaternion = new THREE.Quaternion();
  private readonly projectedCameraQuaternion = new THREE.Quaternion();
  private readonly projectedFrameQuaternion = new THREE.Quaternion();
  private readonly viewDirection = new THREE.Vector3();
  private hasProjection = false;
  private target?: THREE.Object3D;

  constructor(
    container: HTMLElement,
    private camera: THREE.Camera,
    private readonly actions: CoordinateActions,
  ) {
    this.root.className = 'viewport-coordinate-reference';
    this.root.setAttribute('role', 'group');
    this.root.tabIndex = 0;
    this.root.addEventListener('dblclick', event => {
      event.preventDefault();
      event.stopPropagation();
      this.resetView();
    });
    this.root.addEventListener('pointerdown', event => event.stopPropagation());
    this.root.addEventListener('keydown', event => {
      if (
        event.target === this.root &&
        (event.key === 'Enter' || event.key === ' ')
      ) {
        event.preventDefault();
        event.stopPropagation();
        this.resetView();
      }
    });

    const svg = document.createElementNS(svgNamespace, 'svg');
    svg.setAttribute('viewBox', '0 0 77 77');
    svg.setAttribute('role', 'group');

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

    this.axisEnds = (
      [
        ['x', new THREE.Vector3(1, 0, 0)],
        ['y', new THREE.Vector3(0, 1, 0)],
        ['z', new THREE.Vector3(0, 0, 1)],
      ] as const
    ).flatMap(([name, direction]) =>
      ([1, -1] as const).map(sign => {
        const kind = sign === 1 ? 'positive' : 'negative';
        const group = document.createElementNS(svgNamespace, 'g');
        group.classList.add('viewport-coordinate-axis');
        group.dataset.axis = name;
        group.dataset.direction = kind;
        group.style.color = spatialAxisColors[name];

        group.setAttribute('role', 'button');
        group.setAttribute('tabindex', '0');
        group.setAttribute(
          'aria-label',
          `View from ${sign === 1 ? '+' : '-'}${name.toUpperCase()}`,
        );
        const title = document.createElementNS(svgNamespace, 'title');
        title.textContent = `View from ${sign === 1 ? '+' : '-'}${name.toUpperCase()} · Click again to flip · Double-click to reset`;
        group.append(title);
        let line: SVGLineElement | undefined;
        if (kind === 'positive') {
          line = document.createElementNS(svgNamespace, 'line');
          line.setAttribute('x1', String(center));
          line.setAttribute('y1', String(center));
          group.append(line);
        }
        const markerRadius = kind === 'positive' ? 7 : 5.5;
        const marker = document.createElementNS(svgNamespace, 'circle');
        marker.classList.add('viewport-coordinate-marker');
        marker.setAttribute('r', String(markerRadius));
        const outline = document.createElementNS(svgNamespace, 'circle');
        outline.classList.add('viewport-coordinate-outline');
        // Place the 2px interaction ring directly outside the marker's 1px border.
        outline.setAttribute('r', String(markerRadius + 1.5));
        group.append(outline, marker);
        let label: SVGTextElement | undefined;
        if (kind === 'positive') {
          label = document.createElementNS(svgNamespace, 'text');
          label.textContent = name.toUpperCase();
          group.append(label);
        }
        const hitArea = document.createElementNS(svgNamespace, 'circle');
        hitArea.classList.add('viewport-coordinate-hit-area');
        hitArea.setAttribute('r', '11');
        group.append(hitArea);
        svg.append(group);
        const axisEnd: AxisEndView = {
          name,
          kind,
          direction: direction.clone().multiplyScalar(sign),
          group,
          line,
          marker,
          outline,
          hitArea,
          label,
        };
        group.addEventListener('click', event => {
          event.stopPropagation();
          if (event.detail < 2) this.selectAxis(axisEnd);
        });
        group.addEventListener('keydown', event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            event.stopPropagation();
            this.selectAxis(axisEnd);
          }
        });
        return axisEnd;
      }),
    );

    this.root.append(svg);
    container.append(this.root);
    this.updateLabel();
  }

  setVisible(visible: boolean): void {
    this.root.hidden = !visible;
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

    const depthSortedEnds = this.axisEnds
      .map(axisEnd => {
        this.viewDirection
          .copy(axisEnd.direction)
          .applyQuaternion(this.frameQuaternion)
          .applyQuaternion(this.cameraQuaternion);
        const x = center + this.viewDirection.x * axisLength;
        const y = center - this.viewDirection.y * axisLength;
        axisEnd.line?.setAttribute('x2', x.toFixed(2));
        axisEnd.line?.setAttribute('y2', y.toFixed(2));
        for (const circle of [
          axisEnd.marker,
          axisEnd.outline,
          axisEnd.hitArea,
        ]) {
          circle.setAttribute('cx', x.toFixed(2));
          circle.setAttribute('cy', y.toFixed(2));
        }
        axisEnd.label?.setAttribute('x', x.toFixed(2));
        axisEnd.label?.setAttribute('y', y.toFixed(2));
        axisEnd.group.setAttribute(
          'aria-pressed',
          String(this.viewDirection.z > 1 - 1e-6),
        );
        const intensity = String(
          axisEnd.kind === 'positive'
            ? 0.58 + (this.viewDirection.z + 1) * 0.21
            : 0.42 + (this.viewDirection.z + 1) * 0.1,
        );
        // Dim distant ends without making the markers reveal the axes behind them.
        axisEnd.group.style.setProperty('--axis-intensity', intensity);
        return {axisEnd, depth: this.viewDirection.z};
      })
      .sort((left, right) => left.depth - right.depth);

    const focused = document.activeElement;
    depthSortedEnds.forEach(({axisEnd}) =>
      axisEnd.group.parentElement?.append(axisEnd.group),
    );
    if (focused instanceof SVGElement && this.root.contains(focused))
      focused.focus({preventScroll: true});
  }

  setCamera(camera: THREE.Camera): void {
    this.camera = camera;
    this.hasProjection = false;
    this.update();
  }

  private selectAxis(axisEnd: AxisEndView): void {
    this.update();
    const direction = axisEnd.direction.clone();
    const facingCamera = direction
      .clone()
      .applyQuaternion(this.frameQuaternion)
      .applyQuaternion(this.cameraQuaternion).z;
    if (facingCamera > 1 - 1e-6) direction.negate();
    // Top and bottom views need a screen-up direction perpendicular to Y.
    const up =
      axisEnd.name === 'y'
        ? new THREE.Vector3(0, 0, -direction.y)
        : new THREE.Vector3(0, 1, 0);
    this.actions.onSelect(
      direction.applyQuaternion(this.frameQuaternion),
      up.applyQuaternion(this.frameQuaternion),
    );
    this.update();
  }

  private resetView(): void {
    this.update();
    this.actions.onReset(this.frameQuaternion.clone());
    this.update();
  }

  private updateLabel(): void {
    if (!this.target) {
      this.root.setAttribute('aria-label', 'World X, Y, Z coordinate axes');
      this.root.title =
        'World coordinate frame · Click an axis to align · Double-click to reset';
      return;
    }
    const targetName = this.target.name || 'selected model';
    this.root.setAttribute(
      'aria-label',
      `Local X, Y, Z coordinate axes for ${targetName}`,
    );
    this.root.title = `Local coordinate frame · ${targetName} · Click an axis to align · Double-click to reset`;
  }
}
