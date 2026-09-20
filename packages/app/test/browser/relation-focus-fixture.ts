import {inspectSource} from './inspection-fixture';
import * as THREE from 'three';
import {ModelCompilerClient} from '../../src/model/compiler-client';
import {browserPackageFiles} from '../../src/project/browser-packages';
import {ModelViewport} from '../../src/viewport';

function viewport() {
  return new ModelViewport(document.querySelector<HTMLElement>('main')!, {
    onSelect() {},
    onDrillDown() {},
    onNavigateSource() {},
    onPositionTool() {},
    onTopologySelection() {},
  });
}

export async function measureGearAssemblyFocus(source: string) {
  const client = new ModelCompilerClient(browserPackageFiles);
  const view = viewport();
  try {
    const module = await client.compile(
      {files: [{path: '/main.ts', source}]},
      '/main.ts',
    );
    if (module.diagnostic) throw new Error(module.diagnostic.summary);
    const array = '[pinion, wheel, idler]';
    const arrayStart = source.indexOf(array);
    const samples = [];
    for (const focus of [
      'wheel',
      'pinion',
      'idler',
      'array',
      'call',
      'wheel',
    ]) {
      const offset =
        focus === 'call'
          ? source.indexOf('assembleGears(')
          : focus === 'array'
            ? arrayStart
            : arrayStart + array.indexOf(focus) + focus.length;
      await inspectSource(client, view, module, '/main.ts', offset);
      const drawn = new Map<string, {position: number[]; opacity: number}>();
      view['root'].traverse(object => {
        if (!(object instanceof THREE.Mesh)) return;
        object.onBeforeRender = () => {
          const material = Array.isArray(object.material)
            ? object.material[0]
            : object.material;
          drawn.set(object.uuid, {
            position: new THREE.Vector3()
              .setFromMatrixPosition(object.matrixWorld)
              .toArray(),
            opacity: material.opacity,
          });
        };
      });
      view['rendering'].renderFrame();
      const onscreen = [...drawn.values()];
      drawn.clear();
      await view.captureImage(640, 480, {
        direction: [0.5, 1.8, 1.2],
        up: [0, 1, 0],
      });
      samples.push({focus, onscreen, exported: [...drawn.values()]});
    }
    return samples;
  } finally {
    view['renderer'].dispose();
    view['controls'].dispose();
    client.dispose();
  }
}

/** Ordinary values and explicit inspectors share transport, but not material emphasis. */
export async function measurePreviewMaterials() {
  const client = new ModelCompilerClient(browserPackageFiles);
  const view = viewport();
  const source = `import {box, group} from '@code3d/core';
import {MeshPhysicalMaterial} from '@code3d/core/three';
const defaulted=box(8,10,12);
const colored=box(8,10,12).material('#ff0000');
const alpha=box(8,10,12).originOffset(15,0,0).material('rgba(0,0,255,0.25)');
const native=box(8,10,12).material(new MeshPhysicalMaterial({color:'#00ff00',clearcoat:1}));
const nested=group([group([box(8,10,12)])]).material('#ffaa00');
function plain(size) {return box(size,10,12).material('#ff0000');}
/** @code3d.inspect items custom.inspect */
function custom(items) {return group(items);}
namespace custom {export function inspect([items]) {return {target:items};}}
defaulted; colored; alpha; native; nested; [colored,alpha]; plain(13); custom([colored,alpha]);
export default nested;`;
  try {
    const module = await client.compile(
      {files: [{path: '/main.ts', source}]},
      '/main.ts',
    );
    if (module.diagnostic) throw new Error(module.diagnostic.summary);
    const samples = [];
    for (const [token, delta] of [
      ['defaulted;', 0],
      ['colored;', 0],
      ['alpha;', 0],
      ['native;', 0],
      ['nested;', 0],
      ['[colored,alpha];', 0],
      ['plain(13)', 0],
      ['plain(13)', 6],
      ['custom([colored,alpha])', 8],
      ['colored;', 0],
    ] as const) {
      await inspectSource(
        client,
        view,
        module,
        '/main.ts',
        source.lastIndexOf(token) + delta,
      );
      const drawn: {color: string; opacity: number}[] = [];
      view['root'].traverse(object => {
        if (!(object instanceof THREE.Mesh)) return;
        object.onBeforeRender = () => {
          for (const material of Array.isArray(object.material)
            ? object.material
            : [object.material])
            drawn.push({
              color: (
                material as THREE.MeshStandardMaterial
              ).color.getHexString(),
              opacity: material.opacity,
            });
        };
      });
      view['rendering'].renderFrame();
      const onscreen = structuredClone(drawn);
      drawn.length = 0;
      await view.captureImage(640, 480);
      samples.push({
        token,
        delta,
        kind: view['inspectionScene']!.kind,
        onscreen,
        exported: [...drawn],
      });
    }
    return samples;
  } finally {
    view['renderer'].dispose();
    view['controls'].dispose();
    client.dispose();
  }
}

export async function measureRelationFocus() {
  const client = new ModelCompilerClient(browserPackageFiles);
  const view = viewport();
  const source = `import {box, group} from '@code3d/core';
const a=box(4,6,8).material('#ff4d81');
const b=box(6,8,10).originOffset(15,0,0).material('#ff4d81');
const c=box(8,10,12).originOffset(-15,0,0).material('#ff4d81');
/** @code3d.inspect items scene.inspect */
function scene(items) { return group(items); }
namespace scene { export function inspect([items]) { return {target: items, ambient: [c]}; } }
export default scene([a,b]);`;
  try {
    const module = await client.compile(
      {files: [{path: '/main.ts', source}]},
      '/main.ts',
    );
    if (module.diagnostic) throw new Error(module.diagnostic.summary);
    const samples = [];
    for (const [token, delta] of [
      ['[a,b]', 1],
      ['[a,b]', 0],
    ] as const) {
      await inspectSource(
        client,
        view,
        module,
        '/main.ts',
        source.lastIndexOf(token) + delta,
      );
      const drawn: Record<string, number[]> = {};
      const snapshot = view['inspectionScene']!;
      for (const [index, item] of [
        ...snapshot.target,
        ...snapshot.ambient,
      ].entries()) {
        if (item.kind !== 'model') continue;
        const object = view
          .renderedOccurrences()
          .find(o => o.renderedNodeId === item.model.nodeId)!.object;
        object.traverse(child => {
          if (!(child instanceof THREE.Mesh)) return;
          child.onBeforeRender = () => {
            drawn[index] ??= [];
            for (const material of Array.isArray(child.material)
              ? child.material
              : [child.material])
              drawn[index].push(material.opacity);
          };
        });
      }
      view['rendering'].renderFrame();
      const onscreen = structuredClone(drawn);
      for (const key of Object.keys(drawn)) delete drawn[key];
      await view.captureImage(800, 600);
      samples.push({
        focused: snapshot.target.map(item => item.focused),
        onscreen,
        exported: drawn,
      });
    }
    return samples;
  } finally {
    client.dispose();
  }
}

export async function measureCompletedRelationFocus() {
  const client = new ModelCompilerClient(browserPackageFiles);
  const view = viewport();
  const source = `import {box,group,offset} from '@code3d/core';
const base=box(20,10,20); const extra=box(100,100,100);
const part=box(2,2,2).relate(self=>[self.on(base.up),offset(0,4,0)]);
export default group([base,part,extra]);`;
  try {
    const module = await client.compile(
      {files: [{path: '/main.ts', source}]},
      '/main.ts',
    );
    if (module.diagnostic) throw new Error(module.diagnostic.summary);
    const samples = [];
    for (const [token, delta] of [
      ['.relate(', 1],
      ['.on(', 1],
      ['base.up', 6],
      ['offset(', 1],
    ] as const) {
      await inspectSource(
        client,
        view,
        module,
        '/main.ts',
        source.lastIndexOf(token) + delta,
      );
      const scene = view['inspectionScene']!;
      const extraId = module.fallback!.children[2].nodeId;
      samples.push({
        token,
        targets: scene.target.map(item => item.kind),
        ambient: scene.ambient.length,
        focused: scene.target
          .filter(item => item.focused)
          .map(item => item.kind),
        markers: view['decorationLayers'].get('inspection')?.length ?? 0,
        extraVisible: view
          .renderedOccurrences()
          .some(o => o.node.nodeId === extraId),
      });
    }
    return samples;
  } finally {
    client.dispose();
  }
}

/** Exercise the same source metadata and Worker/render path for every model array inspector. */
export async function measureCollectionFocus() {
  const client = new ModelCompilerClient(browserPackageFiles);
  const view = viewport();
  const source = `import {box, sphere, circle, group, union, intersect, cut, loft, extrude} from '@code3d/core';
const a=box(18,12,18), b=sphere(11).originOffset(-7,0,0);
const stock=box(40,40,40);
const p=circle(5), q=circle(3).originOffset(0,-20,0);
const nested=group([a,group([b])]);
/** @code3d.inspect items custom.inspect */
function custom(items) {return group(items);}
namespace custom {export function inspect([items]) {return {target:items};}}
group([a,b]); union([a,b]); intersect([a,b]); cut(stock,[a,b]); stock.cut([a,b]);
loft([p,q]); extrude([p,q],4); custom([nested,b]);
export default group([a,b]);`;
  try {
    const module = await client.compile(
      {files: [{path: '/main.ts', source}]},
      '/main.ts',
    );
    if (module.diagnostic) throw new Error(module.diagnostic.summary);
    const samples = [];
    for (const call of [
      'group([a,b])',
      'union([a,b])',
      'intersect([a,b])',
      'cut(stock,[a,b])',
      'stock.cut([a,b])',
      'loft([p,q])',
      'extrude([p,q],4)',
      'custom([nested,b])',
    ]) {
      const array = call.indexOf('[');
      for (const member of [0, 1, -1, 0]) {
        const offset =
          source.indexOf(call) +
          (member < 0
            ? array
            : member === 0
              ? array + 1
              : call.indexOf(',', array) + 1);
        await inspectSource(client, view, module, '/main.ts', offset);
        const scene = view['inspectionScene']!;
        const items = [
          ...scene.target.map(item => ({item, ambient: false})),
          ...scene.ambient.map(item => ({item, ambient: true})),
        ];
        const drawn: Record<
          number,
          {
            color: string;
            opacity: number;
            order: number;
            depthTest: boolean;
            toneMapped: boolean;
          }[]
        > = {};
        for (const [index, {item}] of items.entries()) {
          if (item.kind !== 'model') continue;
          const object = view
            .renderedOccurrences()
            .find(
              o =>
                o.renderedNodeId === item.model.nodeId &&
                o.object.parent === view['root'],
            )!.object;
          object.traverse(child => {
            if (!(child instanceof THREE.Mesh)) return;
            child.onBeforeRender = () => {
              drawn[index] ??= [];
              for (const material of Array.isArray(child.material)
                ? child.material
                : [child.material]) {
                const surface = material as THREE.MeshStandardMaterial;
                drawn[index].push({
                  color: surface.color.getHexString(),
                  opacity: surface.opacity,
                  order: child.renderOrder,
                  depthTest: surface.depthTest,
                  toneMapped: surface.toneMapped,
                });
              }
            };
          });
        }
        view['rendering'].renderFrame();
        const onscreen = structuredClone(drawn);
        for (const key of Object.keys(drawn)) delete drawn[Number(key)];
        await view.captureImage(640, 480);
        samples.push({
          call,
          member,
          items: items.map(({item, ambient}) => ({
            focused: item.focused,
            ambient,
          })),
          onscreen,
          exported: structuredClone(drawn),
        });
      }
    }
    return samples;
  } finally {
    client.dispose();
  }
}

export async function measureInspectionBoundaries() {
  const client = new ModelCompilerClient(browserPackageFiles);
  const view = viewport();
  const source = `import {box, sphere, group, intersect, cut} from '@code3d/core';
import {MeshBasicMaterial} from '@code3d/core/three';
const blank=box(18,12,18), ball=sphere(11).originOffset(-7,0,0);
const nativeView=group([group([box(12,10,8).material(new MeshBasicMaterial({color:'#66c9ff',depthTest:false,toneMapped:false}))])]);
intersect([blank,ball]); cut(blank,[ball]); nativeView;
export default group([blank,ball]);`;
  const pixels = async (blob: Blob) => {
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d')!;
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    return context.getImageData(0, 0, canvas.width, canvas.height).data;
  };
  try {
    const module = await client.compile(
      {files: [{path: '/main.ts', source}]},
      '/main.ts',
    );
    if (module.diagnostic) throw new Error(module.diagnostic.summary);
    const samples = [];
    for (const [token, delta] of [
      ['intersect([blank,ball])', 'intersect([blank,'.length],
      ['cut(blank,[ball])', 'cut(blank,['.length],
      ['nativeView;', 0],
      ['group([blank,ball])', 'group(['.length],
    ] as const) {
      await inspectSource(
        client,
        view,
        module,
        '/main.ts',
        source.lastIndexOf(token) + delta,
      );
      const pairs: {surface: THREE.Mesh; edge: THREE.LineSegments}[] = [];
      view['root'].traverse(object => {
        if (!(object instanceof THREE.Mesh)) return;
        const edge = object.parent!.children.find(
          child => child instanceof THREE.LineSegments,
        );
        if (edge instanceof THREE.LineSegments)
          pairs.push({surface: object, edge});
      });
      const foreground = pairs.filter(
        ({surface}) => !(surface.material as THREE.Material).depthTest,
      );
      const selected = foreground.length ? foreground : pairs;
      const drawn = {onscreen: [] as string[], exported: [] as string[]};
      for (const {surface, edge} of pairs) {
        for (const primitive of [surface, edge]) {
          primitive.onBeforeRender = renderer => {
            drawn[renderer === view['renderer'] ? 'onscreen' : 'exported'].push(
              primitive.uuid,
            );
          };
        }
      }
      const directions: readonly [number, number, number][] = [
        [1, 0.65, 1],
        [-1, 0.65, 1],
        [-1, 0.65, -1],
        [1, 0.65, -1],
        [1, 2, 1],
        [1, -0.8, 1],
      ];
      for (const direction of directions) {
        view.setView({direction, up: [0, 1, 0]});
        drawn.onscreen.length = 0;
        view['rendering'].renderFrame();
        const onscreen = [...drawn.onscreen];
        drawn.exported.length = 0;
        const visible = await pixels(await view.captureImage(640, 480));
        const exported = [...drawn.exported];
        for (const {edge} of selected) edge.visible = false;
        const hidden = await pixels(await view.captureImage(640, 480));
        for (const {edge} of selected) edge.visible = true;
        let changedPixels = 0;
        for (let i = 0; i < visible.length; i += 4) {
          if (
            Math.max(
              ...[0, 1, 2].map(channel =>
                Math.abs(visible[i + channel] - hidden[i + channel]),
              ),
            ) > 12
          )
            changedPixels++;
        }
        samples.push({
          token,
          direction,
          onscreen,
          exported,
          changedPixels,
          pairs: pairs.map(({surface, edge}) => ({
            surface: surface.uuid,
            edge: edge.uuid,
          })),
          foreground: foreground.map(({surface, edge}) => ({
            surface: surface.uuid,
            edge: edge.uuid,
          })),
        });
      }
    }
    return samples;
  } finally {
    client.dispose();
  }
}
