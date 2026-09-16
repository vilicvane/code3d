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
