import * as THREE from 'three';
import {LineSegments2} from 'three/addons/lines/LineSegments2.js';
import {ModelCompilerClient} from '../../src/model/compiler-client';
import {browserPackageFiles} from '../../src/project/browser-packages';
import {ModelViewport} from '../../src/viewport';
import {
  elementSourceDecoration,
  relationSourceDecoration,
} from '../../src/model/element-decorations';
import {
  evaluatedConstraint,
  focusedConstraintSide,
} from '../../src/model/constraint-context';
import type {ViewportDecoration} from '../../src/viewport-decoration';

export async function measureRelationFocus() {
  const client = new ModelCompilerClient(browserPackageFiles);
  const viewport = new ModelViewport(
    document.querySelector<HTMLElement>('main')!,
    {
      onSelect() {},
      onDrillDown() {},
      onNavigateSource() {},
      onPositionTool() {},
      onTopologySelection() {},
      sourceDecorationProviders: [
        elementSourceDecoration,
        relationSourceDecoration,
      ],
    },
  );
  const samples: Array<{
    label: string;
    token: string;
    primary: string;
    selected: string;
    source: string;
    target: string;
    participants: string[];
    expectedOpacity: number;
    drawn: Array<{
      side: string;
      kind: string;
      opacity: number;
      baseOpacity: number;
      head: boolean;
      line: boolean;
    }>;
    bodies: Array<{
      role: 'primary' | 'secondary' | 'context';
      kind: 'surface' | 'line' | 'point';
      opacity: number;
      color: string;
    }>;
    selectionBox?: number;
    ownerPositions: number[][];
    expectedOwnerPosition: readonly number[];
    topologyHighlights: number;
    exported: boolean;
  }> = [];
  try {
    for (const [label, geometry, relation, baseOpacity] of [
      ['solid bound', 'box(8,6,4)', 'self.on( /* target */ base.up )', 0.85],
      [
        'two constraints',
        'box(8,6,4)',
        'self.on( /* target */ base.up )',
        0.85,
      ],
      [
        'painted bound',
        "box(8,6,4).material('#ff4d81')",
        'self.on( /* target */ base.up )',
        0.85,
      ],
      [
        'group bound',
        'group([box(8,6,4),group([box(2,4,6)])])',
        'self.on( /* target */ base.up )',
        0.85,
      ],
      [
        'reverse bound',
        'group([box(8,6,4)])',
        'base.on( /* target */ self.up )',
        0.85,
      ],
      [
        'axis',
        'box(8,6,4)',
        'self.axis.align( /* target */ base.axis.reverse() )',
        0.98,
      ],
      [
        'curve',
        'line([0,0,0],[10,5,0])',
        'self.align( /* target */ base.reverse() )',
        0.98,
      ],
      [
        'surface',
        'box(8,6,4)',
        'self.surface(1).align( /* target */ base.surface(2).flip() )',
        0.66,
      ],
      ['point', 'point()', 'self.align( /* target */ base )', 0.92],
    ] as const) {
      const constraints =
        label === 'two constraints'
          ? `[${relation},self.on(other.front)]`
          : `[${relation}, offset(2,0,0)]`;
      const source = `import {offset,box,group,line,point} from '@code3d/core'; const base=${geometry}; const other=${geometry}; const part=${geometry}.relate(self=>${constraints}); export default group([base,part,other]);`;
      const module = await client.compile(
        {files: [{path: '/main.ts', source}]},
        '/main.ts',
      );
      if (module.diagnostic) throw new Error(JSON.stringify(module.diagnostic));
      viewport.renderModule(module);
      const tokens = [
        '/* target */',
        label === 'two constraints' ? 'on( /* target */' : 'offset(',
        ...(label === 'two constraints'
          ? [
              'self.on( /* target */',
              'other.front',
              'on(other.front',
              'self.on(other.front)',
            ]
          : []),
        '/* target */',
      ];
      for (const token of tokens) {
        viewport.selectBySourceOffset('/main.ts', source.indexOf(token) + 1);
        const scope = viewport.sourceContext!;
        const constraint = evaluatedConstraint(
          module.objects,
          scope.evaluation,
        )!;
        const primary = focusedConstraintSide(scope.evaluation, constraint);
        viewport['root'].updateMatrixWorld(true);
        const ownerId = scope.evaluation.relationOwnerNodeId!;
        const ownerPositions = viewport['root'].children
          .filter(
            root =>
              (root.userData.sourceNodeId ??
                viewport['occurrences'].get(root.userData.selectionKey)?.node
                  .nodeId) === ownerId,
          )
          .map(root => root.getWorldPosition(new THREE.Vector3()).toArray());
        const expectedOwnerPosition =
          module.objects.get(ownerId)!.compositionTransform.position;
        const drawn: (typeof samples)[number]['drawn'] = [];
        const bodies: (typeof samples)[number]['bodies'] = [];
        let topologyHighlights = 0;
        let exporting = false;
        for (const root of viewport['root'].children) {
          const nodeId =
            root.userData.sourceNodeId ??
            viewport['occurrences'].get(root.userData.selectionKey)?.node
              .nodeId;
          const role =
            nodeId === constraint[primary].nodeId
              ? 'primary'
              : nodeId === constraint.source.nodeId ||
                  nodeId === constraint.target.nodeId
                ? 'secondary'
                : 'context';
          root.traverse(object => {
            if (!(
              object instanceof THREE.Mesh ||
              object instanceof THREE.Line ||
              object instanceof THREE.Points
            ))
              return;
            const material = Array.isArray(object.material)
              ? object.material[0]
              : object.material;
            if (material instanceof THREE.MeshBasicMaterial)
              topologyHighlights++;
            if (!(
              material instanceof THREE.MeshStandardMaterial ||
              material instanceof THREE.LineBasicMaterial ||
              material instanceof THREE.PointsMaterial
            ))
              return;
            const before = object.onBeforeRender;
            object.onBeforeRender = (...args) => {
              before.apply(object, args);
              if (exporting && args[2] === viewport['camera']) return;
              bodies.push({
                role,
                kind:
                  object instanceof THREE.Mesh
                    ? 'surface'
                    : object instanceof THREE.Points
                      ? 'point'
                      : 'line',
                opacity: material.opacity,
                color: material.color.getHexString(),
              });
            };
          });
        }
        for (const instance of viewport['decorationLayers'].get(
          'source-context:relation-geometry',
        ) ?? []) {
          const decoration: ViewportDecoration =
            instance.object.children[0].userData.decoration;
          const side = decoration.id.startsWith(`${constraint.id}:source:`)
            ? 'source'
            : 'target';
          instance.object.traverse(object => {
            if (!(
              object instanceof THREE.Mesh ||
              object instanceof THREE.Line ||
              object instanceof THREE.Points
            ))
              return;
            const material = Array.isArray(object.material)
              ? object.material[0]
              : object.material;
            const before = object.onBeforeRender;
            object.onBeforeRender = (...args) => {
              before.apply(object, args);
              if (exporting && args[2] === viewport['camera']) return;
              drawn.push({
                side,
                kind: decoration.kind,
                opacity: material.opacity,
                baseOpacity:
                  decoration.kind === 'surface'
                    ? 0.18
                    : decoration.kind === 'mesh' &&
                        object instanceof LineSegments2
                      ? 1
                      : baseOpacity,
                head: object.name === 'direction-arrow-head',
                line: object instanceof LineSegments2,
              });
            };
          });
        }
        let selectionBox: number | undefined;
        viewport['selectionHighlight']?.traverse(object => {
          if (!(object instanceof LineSegments2)) return;
          const before = object.onBeforeRender;
          object.onBeforeRender = (...args) => {
            before.apply(object, args);
            selectionBox = object.material.opacity;
          };
        });
        const capture = (exported: boolean) =>
          samples.push({
            label,
            token,
            primary,
            selected: viewport.getSelected()!.node.nodeId,
            source: constraint.source.nodeId,
            target: constraint.target.nodeId,
            participants: module.fallback!.children.map(node => node.nodeId),
            expectedOpacity: baseOpacity,
            drawn: [...drawn],
            bodies: [...bodies],
            selectionBox,
            ownerPositions,
            expectedOwnerPosition,
            topologyHighlights,
            exported,
          });
        viewport['rendering'].renderFrame();
        capture(false);
        if (label === 'solid bound' && token === 'offset(') {
          drawn.length = 0;
          bodies.length = 0;
          exporting = true;
          await viewport.captureImage(1200, 800);
          capture(true);
        }
      }
    }
    return samples;
  } finally {
    client.dispose();
  }
}

export async function measureCompletedRelationFocus() {
  const client = new ModelCompilerClient(browserPackageFiles);
  const viewport = new ModelViewport(
    document.querySelector<HTMLElement>('main')!,
    {
      onSelect() {},
      onDrillDown() {},
      onNavigateSource() {},
      onPositionTool() {},
      onTopologySelection() {},
      sourceDecorationProviders: [
        elementSourceDecoration,
        relationSourceDecoration,
      ],
    },
  );
  const samples: Array<{
    reverse: boolean;
    token: string;
    exported: boolean;
    selected: string;
    expectedSelected: string;
    constraintCount: number;
    bodies: Array<{
      nodeId: string;
      role: string;
      surface: boolean;
      opacity: number;
      color: string;
    }>;
    markers: Array<{
      nodeId: string;
      primary: boolean;
      kind: string;
      opacity: number;
    }>;
    participantIds: string[];
  }> = [];
  try {
    for (const reverse of [false, true]) {
      const source = `import {box,group} from '@code3d/core';
export const old = box(20,10,20).material('#ff4d81');
export const base = box(20,10,20).material('#ff4d81');
export const front = box(20,10,20).material('#ff4d81');
export const other = box(2,2,2).originOffset(-30,0,0).material('#ff4d81');
const original = ${reverse ? 'group([box(2,2,2),box(1,1,1)])' : 'box(2,2,2)'}.material('#ff4d81')
  .relate(self => ${reverse ? 'old.on(self.up)' : 'self.on(old.up)'});
export const part = original.relate( /* whole */ self => [
  ${reverse ? 'base.on(self.up)' : 'self.on(base.up)'},
  ${reverse ? 'front.on(self.back)' : 'self.on(front.front)'},
] /* completed */ );
export default group([part,base,front,old,other]);`;
      const module = await client.compile(
        {files: [{path: '/main.ts', source}]},
        '/main.ts',
      );
      if (module.diagnostic) throw new Error(JSON.stringify(module.diagnostic));
      viewport.renderModule(module);
      const id = (name: string) => module.exports.get(name)!;
      for (const token of [
        'relate(',
        '/* whole */',
        '/* completed */',
        reverse ? 'base.on(' : 'self.on(base',
      ]) {
        viewport.selectBySourceOffset(
          '/main.ts',
          source.lastIndexOf(token) + (token === 'self.on(base' ? 6 : 1),
        );
        const scope = viewport.sourceContext!;
        const whole = !!scope.evaluation.relationContext;
        const selected = reverse && !whole ? id('base') : id('part');
        const secondary = new Set(
          whole
            ? [id('base'), id('front')]
            : [reverse ? id('part') : id('base')],
        );
        const bodies: (typeof samples)[number]['bodies'] = [];
        const markers: (typeof samples)[number]['markers'] = [];
        let exporting = false;
        for (const root of viewport['root'].children) {
          const nodeId: string =
            root.userData.sourceNodeId ??
            viewport['occurrences'].get(root.userData.selectionKey)?.node
              .nodeId;
          const role =
            nodeId === selected
              ? 'primary'
              : secondary.has(nodeId)
                ? 'secondary'
                : 'context';
          root.traverse(object => {
            if (!(object instanceof THREE.Mesh || object instanceof THREE.Line))
              return;
            const material = Array.isArray(object.material)
              ? object.material[0]
              : object.material;
            if (!(
              material instanceof THREE.MeshStandardMaterial ||
              material instanceof THREE.LineBasicMaterial
            ))
              return;
            const before = object.onBeforeRender;
            object.onBeforeRender = (...args) => {
              before.apply(object, args);
              if (exporting && args[2] === viewport['camera']) return;
              bodies.push({
                nodeId,
                role,
                surface: object instanceof THREE.Mesh,
                opacity: material.opacity,
                color: material.color.getHexString(),
              });
            };
          });
        }
        for (const instance of viewport['decorationLayers'].get(
          'source-context:relation-geometry',
        ) ?? []) {
          const decoration: ViewportDecoration =
            instance.object.children[0].userData.decoration;
          instance.object.traverse(object => {
            if (!(object instanceof THREE.Mesh || object instanceof THREE.Line))
              return;
            const material = Array.isArray(object.material)
              ? object.material[0]
              : object.material;
            const before = object.onBeforeRender;
            object.onBeforeRender = (...args) => {
              before.apply(object, args);
              if (exporting && args[2] === viewport['camera']) return;
              markers.push({
                nodeId: decoration.nodeId!,
                primary: decoration.nodeId === selected,
                kind: decoration.kind,
                opacity: material.opacity,
              });
            };
          });
        }
        const capture = (exported: boolean) =>
          samples.push({
            reverse,
            token,
            exported,
            selected: viewport.getSelected()!.node.nodeId,
            expectedSelected: selected,
            constraintCount:
              scope.evaluation.relationContext?.constraintIds.length ?? 1,
            bodies: [...bodies],
            markers: [...markers],
            participantIds: whole
              ? [id('part'), id('base'), id('front')]
              : [id('part'), id('base')],
          });
        viewport['rendering'].renderFrame();
        capture(false);
        if (token === 'relate(') {
          bodies.length = 0;
          markers.length = 0;
          exporting = true;
          await viewport.captureImage(1200, 800);
          capture(true);
        }
      }
    }
    return samples;
  } finally {
    client.dispose();
  }
}
