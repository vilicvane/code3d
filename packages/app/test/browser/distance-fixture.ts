import * as THREE from 'three';
import {LineSegments2} from 'three/addons/lines/LineSegments2.js';
import {ModelCompilerClient} from '../../src/model/compiler-client';
import {browserPackageFiles} from '../../src/project/browser-packages';
import {ModelViewport} from '../../src/viewport';
import {sourceDecorationProviders} from '../../src/model/source-decorations';
import {MeasurementDecorationObject} from '../../src/rendering/measurement-decoration';

let viewport: ModelViewport;
let client: ModelCompilerClient;
const source = `import {box,distance,group,offset,point,line} from '@code3d/core';
  const left=box(8,30,32).material('#708090');
  const right=box(8,30,32).relate(self=>[self.on(left.right),offset(60,0,0)]).material('#708090');
  const gap=distance(left.right,right.left,'x');
  distance(left, right);
  const tubeA=box(5,10,80).shell(0.5,[5,6]).rotate(-90,0,0).material('#708090');
  const tubeB=tubeA.originOffset(-25,0,0); distance(tubeA, tubeB);
  const a=point([0,0,0]), b=point([3,4,0]); distance(a,b); distance(a,a);
  const edge=line([0,0,0],[8,4,0]); distance(edge,b);
  distance(left.surface(1),right.surface(1));
  const cluster=group([left.scaled(2),right.scaled(2)]).rotate(0,30,0); const probe=point([200,0,0]); distance(cluster,probe);
  distance(left.up,left.up,'y');
  distance(left.left,left.right,'x');
  const corner=point([-4,-15,-16]); distance(corner,left.front,'z');
  const beam=box(gap,10,24).relate(self=>self.on(left.right));
  export default group([left,right,beam]).expose({supportA:left,supportB:right,beam});`;

export async function startDistanceFixture() {
  client = new ModelCompilerClient(browserPackageFiles);
  viewport = new ModelViewport(document.querySelector<HTMLElement>('main')!, {
    animateViewChanges: false,
    onSelect() {},
    onDrillDown() {},
    onNavigateSource() {},
    onPositionTool() {},
    onTopologySelection() {},
    sourceDecorationProviders,
  });
  const module = await client.compile(
    {files: [{path: '/main.ts', source}]},
    '/main.ts',
  );
  if (module.diagnostic) throw new Error(JSON.stringify(module.diagnostic));
  viewport.renderModule(module);
  return selectDistance('distance(left.right');
}

export async function selectDistance(token: string, resetView = false) {
  viewport.selectBySourceOffset('/main.ts', source.indexOf(token) + 1);
  if (resetView)
    viewport['controls'].restorePose(
      viewport['controls'].defaultPose(
        viewport['cameraFraming'](viewport['root'])!,
      ),
    );
  await new Promise<void>(resolve =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
  return measureDistance();
}

function dimension() {
  const layers = viewport['decorationLayers'].get(
    'source-context:measurement',
  )!;
  const measurement = layers
    .map(value => value.measurement)
    .find((value): value is MeasurementDecorationObject => !!value)!;
  if (!measurement) throw new Error('No rendered dimension');
  return measurement;
}

function pixels(label: THREE.Object3D, camera: THREE.Camera, height: number) {
  const a = new THREE.Vector3(0, -0.5, 0)
    .applyMatrix4(label.matrixWorld)
    .project(camera);
  const b = new THREE.Vector3(0, 0.5, 0)
    .applyMatrix4(label.matrixWorld)
    .project(camera);
  return (Math.hypot(a.x - b.x, a.y - b.y) * height) / 2;
}

export function measureDistance() {
  const measurement = dimension();
  const label = measurement.getObjectByName('distance-label')!;
  const surfaces: number[] = [];
  viewport['root'].traverse(object => {
    if (
      !(object instanceof THREE.Mesh) ||
      object.userData.modelingHelper ||
      !('opacity' in object.material)
    )
      return;
    surfaces.push(object.material.opacity);
  });
  const localStart = new THREE.Vector3(
    ...measurement.userData.decoration.start,
  ).applyMatrix4(measurement.matrixWorld);
  const localEnd = new THREE.Vector3(
    ...measurement.userData.decoration.end,
  ).applyMatrix4(measurement.matrixWorld);
  return {
    focusKind: viewport.sourceContext!.target.kind,
    focused: viewport.sourceContext!.evaluation.focusNodeIds,
    operands: viewport.sourceContext!.evaluation.measurement!.operands.map(
      value => value.nodeId,
    ),
    highlights: (
      viewport['decorationLayers'].get('source-context:measurement') ?? []
    ).flatMap(instance => {
      const decoration = instance.object.children[0].userData.decoration;
      if (decoration.kind === 'measurement') return [];
      const drawn: {
        nodeId: string;
        kind: string;
        opacity: number;
      }[] = [];
      instance.object.traverse(object => {
        if (!(object instanceof THREE.Mesh) || Array.isArray(object.material))
          return;
        drawn.push({
          nodeId: decoration.nodeId,
          kind: decoration.kind,
          opacity: object.material.opacity,
        });
      });
      return drawn;
    }),
    text: label.userData.text,
    marks: measurementMarks(
      viewport['camera'],
      viewport['renderer'].domElement.clientHeight,
    ),
    axisInk: axisInk(
      label as THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>,
    ),
    labelPixels: pixels(
      label,
      viewport['camera'],
      viewport['renderer'].domElement.clientHeight,
    ),
    lineLength: localStart.distanceTo(localEnd),
    start: localStart.toArray(),
    end: localEnd.toArray(),
    expected: viewport.sourceContext!.evaluation.measurement!.value,
    kinds: viewport['decorationLayers']
      .get('source-context:measurement')!
      .map(value => value.object.children[0].userData.decoration.kind),
    surfaces,
    modelFaces: [
      ...viewport['occurrences'].values(),
      ...viewport['contextOccurrences'].values(),
    ].flatMap(occurrence => {
      if (!occurrence.node.mesh) return [];
      const faces: {nodeId: string; opacity: number; color: string}[] = [];
      occurrence.object.traverse(object => {
        if (
          !(object instanceof THREE.Mesh) ||
          object instanceof LineSegments2 ||
          Array.isArray(object.material) ||
          !('color' in object.material)
        )
          return;
        faces.push({
          nodeId: occurrence.node.nodeId,
          opacity: object.material.opacity,
          color: (object.material.color as THREE.Color).getHexString(),
        });
      });
      return faces;
    }),
    tools: viewport.sourceContext!.target.tool,
    position: viewport['root'].children.map(value => value.position.toArray()),
    corners: (
      viewport['decorationLayers'].get('source-context:measurement') ?? []
    ).flatMap(instance => {
      const corners = instance.corners;
      if (!corners) return [];
      const starts = corners.geometry.getAttribute('instanceStart'),
        ends = corners.geometry.getAttribute('instanceEnd');
      return Array.from({length: starts.count}, (_, i) => {
        const a = new THREE.Vector3()
          .fromBufferAttribute(starts, i)
          .applyMatrix4(corners.matrixWorld)
          .project(viewport['camera']);
        const b = new THREE.Vector3()
          .fromBufferAttribute(ends, i)
          .applyMatrix4(corners.matrixWorld)
          .project(viewport['camera']);
        return Math.hypot(
          ((a.x - b.x) * viewport['renderer'].domElement.clientWidth) / 2,
          ((a.y - b.y) * viewport['renderer'].domElement.clientHeight) / 2,
        );
      });
    }),
    textures: viewport['renderer'].info.memory.textures,
  };
}

function axisInk(
  label: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>,
) {
  const canvas = label.material.map!.image as HTMLCanvasElement;
  const data = canvas
    .getContext('2d')!
    .getImageData(0, 0, canvas.width, canvas.height).data;
  const colors = new Map<string, number>();
  for (let i = 0; i < data.length; i += 4) {
    const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
    if (r === g && g === b) continue;
    const hex =
      '#' +
      [r, g, b].map(value => value.toString(16).padStart(2, '0')).join('');
    colors.set(hex, (colors.get(hex) ?? 0) + 1);
  }
  return [...colors].sort((a, b) => b[1] - a[1])[0]?.[0];
}

function measurementMarks(camera: THREE.Camera, height: number) {
  const measurement = dimension();
  const ticks = measurement.getObjectByName('distance-ticks') as LineSegments2;
  const line = measurement.getObjectByName('distance-line') as
    LineSegments2 | undefined;
  const starts = ticks.geometry.getAttribute('instanceStart'),
    ends = ticks.geometry.getAttribute('instanceEnd');
  const aspect =
    camera.projectionMatrix.elements[5] / camera.projectionMatrix.elements[0];
  return {
    ticks: Array.from({length: ticks.geometry.instanceCount}, (_, i) => {
      const a = new THREE.Vector3()
        .fromBufferAttribute(starts, i)
        .applyMatrix4(ticks.matrixWorld)
        .project(camera);
      const b = new THREE.Vector3()
        .fromBufferAttribute(ends, i)
        .applyMatrix4(ticks.matrixWorld)
        .project(camera);
      return (Math.hypot((a.x - b.x) * aspect, a.y - b.y) * height) / 2;
    }),
    dashed: line?.material.dashed,
    dash: line?.material.dashSize,
    gap: line?.material.gapSize,
    color: ticks.material.color.getHexString(),
  };
}

export async function zoomAndExportDistance() {
  const camera = viewport['camera'];
  camera.zoom *= 1.8;
  camera.updateProjectionMatrix();
  await new Promise<void>(resolve =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
  const zoomed = measureDistance();
  const label = dimension().getObjectByName('distance-label')!;
  const exported: {
    label: number;
    marks: ReturnType<typeof measurementMarks>;
  }[] = [];
  label.onBeforeRender = (_renderer, _scene, renderCamera) => {
    if (renderCamera !== camera)
      exported.push({
        label: pixels(label, renderCamera, 800),
        marks: measurementMarks(renderCamera, 800),
      });
  };
  const png = await viewport.captureImage(1200, 800);
  label.onBeforeRender = () => {};
  camera.zoom /= 1.8;
  camera.updateProjectionMatrix();
  await new Promise<void>(resolve =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
  return {zoomed, exported, pngBytes: png.size};
}

export function clearDistance(token = 'group([left,right') {
  viewport.selectBySourceOffset('/main.ts', source.indexOf(token) + 1);
  viewport['rendering'].renderFrame();
  return {
    layers: viewport['decorationLayers'].has('source-context:measurement'),
    textures: viewport['renderer'].info.memory.textures,
    contextNodes: [...viewport['contextOccurrences'].values()].map(
      value => value.node.nodeId,
    ),
    models: [...viewport['occurrences'].values()]
      .filter(value => value.node.mesh)
      .map(value => value.node.nodeId),
  };
}

export function finishDistanceFixture() {
  client.dispose();
}
