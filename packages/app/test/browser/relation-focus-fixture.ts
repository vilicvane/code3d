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
        "box(8,6,4).paint('#ff4d81')",
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
          : `${relation}.offset(2,0,0)`;
      const source = `import {box,group,line,point} from '@code3d/core'; const base=${geometry}; const other=${geometry}; const part=${geometry}.relate(self=>${constraints}); export default group([base,part,other]);`;
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
          ? ['other.front', 'on(other.front']
          : []),
        '/* target */',
      ];
      for (const token of tokens) {
        viewport.selectBySourceOffset('/main.ts', source.indexOf(token) + 1);
        const scope = viewport.sourceEvaluation()!;
        const constraint = evaluatedConstraint(
          module.objects,
          scope.evaluation,
        )!;
        const primary = focusedConstraintSide(scope.evaluation, constraint);
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
