import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {createAppTestServer} from './vite-test-server.ts';
import {createTestProjectCompiler} from './project-test-files.ts';
import type {ModelModule} from '../src/model/compiler';
import type {sketchContextOutlines as Outlines} from '../src/tools/sketch-context';
import {defined} from '../../../test/assert.ts';

let server: Awaited<ReturnType<typeof createAppTestServer>>;
let compiler: Awaited<ReturnType<typeof createTestProjectCompiler>>;
let outlines: typeof Outlines;
before(async () => {
  server = await createAppTestServer();
  compiler = await createTestProjectCompiler(server);
  ({sketchContextOutlines: outlines} = await server.ssrLoadModule<
    typeof import('../src/tools/sketch-context')
  >('/src/tools/sketch-context.ts'));
});
after(async () => {
  compiler?.dispose();
  await server?.close();
});

async function compile(source: string): Promise<ModelModule> {
  const module = await compiler.compile(
    {files: [{path: '/model.ts', source}]},
    '/model.ts',
  );
  assert.equal(module.diagnostic, undefined);
  return module;
}
const near = (a: readonly number[], b: readonly number[]) =>
  a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-6, `${a} != ${b}`));

test('related sketches preserve source editability and carry their exact relation context', async () => {
  const source = `import {sketch, box} from '@code3d/core';
const host = box(40, 10, 30).rotate(0, 0, 45).originOffset(-20, -10, 0);
const profile = sketch([['point', 1, [2, 3]], ['circle', 2, [1, 4]]]);
const placed = profile.relate(s => s.plane.align(host.surface(6)));
placed;`;
  const result = await compile(source);
  const [profile, placed] = [...result.sketches.values()];
  assert.ok(placed);
  assert.notEqual(profile.id, placed.id);
  assert.equal(profile.geometryId, placed.geometryId);
  assert.deepEqual(placed.definitionRef, profile.definitionRef);
  assert.deepEqual(placed.data, profile.data);
  assert.deepEqual(profile.context, []);
  assert.ok(placed.context?.length);
  const frame = defined(result.objects.get(defined(placed.frameNodeId)));
  assert.equal(frame.kind, 'reference');
  assert.equal(frame.mesh, undefined);
  assert.equal(frame.constraints.length, 1);
  assert.ok(outlines(placed, result.objects).flatMap(o => o.segments).length);
  const ref = defined(placed.definitionRef);
  assert.equal(
    source.slice(ref.start, ref.end),
    "[['point', 1, [2, 3]], ['circle', 2, [1, 4]]]",
  );
  assert.ok(
    result.sourceTargets.some(
      target =>
        target.sourceRef.start === source.lastIndexOf('placed;') &&
        target.evaluations.some(e => e.sketchIds?.includes(placed.id)),
    ),
  );
});

test('copying a geometry definition into multiple placements does not disable its Fix action', async () => {
  const result = await compile(`import {sketch, box} from '@code3d/core';
const host = box(40, 10, 30);
const profile = sketch([['point', 1, [0, 0]], ['point', 2, [20, 0]], ['line', 3, [1, 2]]], {constraints: [['fixed', 1], ['horizontal', 3], ['length', 3, 30]]});
const placed = profile.relate(s => s.plane.align(host.up));
const another = profile.relate(s => s.plane.align(host.right));`);
  assert.equal(result.warnings.length, 1);
  const warning = result.warnings[0];
  assert.equal(warning.actions?.[0].label, 'Fix');
  assert.equal(warning.relatedSketchIds?.length, 3);
  assert.doesNotMatch(defined(warning.details), /more than once/);
});

test('an unbounded sketch plane never replaces the last geometric viewport fallback', async () => {
  const result = await compile(`import {sketch, box} from '@code3d/core';
const host = box(20, 10, 20);
const profile = sketch().relate(s => s.plane.flip().align(host.up));
profile.plane.flip();`);
  assert.equal(result.fallback?.kind, 'solid');
  assert.ok(result.fallback?.mesh);
});

test('derived related sketches resolve both old and related upstream point references', async () => {
  const result = await compile(`import {sketch, rectangle} from '@code3d/core';
const profile = sketch([['point', 1, [0, 0]], ['point', 2, [10, 0]], ['line', 3, [1, 2]]]);
const placed = profile.relate(s => s.plane.align(rectangle(30, 30).originOffset(0, -8, 0)));
const child = placed.derive([['point', 1, [0, 10]], ['line', 2, [profile.point(2), 1]], ['line', 3, [1, placed.point(1)]]]);
export const solid = child.face().extrude(2);`);
  const [, placed, child] = [...result.sketches.values()];
  assert.equal(child.base, placed.id);
  const lines = child.entities.filter(e => e.kind === 'line');
  assert.equal(lines[0].points[0].layer, placed.id);
  assert.equal(lines[1].points[1].layer, placed.id);
  const solid = defined(
    result.objects.get(defined(result.exports.get('solid'))),
  );
  near(solid.compositionTransform.position, [0, 8, 0]);
});

test('a rotated target context projects into unchanged local sketch coordinates', async () => {
  const result = await compile(`import {sketch, rectangle} from '@code3d/core';
const host = rectangle(20, 10).rotate(0, 0, 90).originOffset(-12, 0, 0);
const profile = sketch().relate(s => s.plane.align(host.plane));`);
  const placed = [...result.sketches.values()].at(-1)!;
  const points = outlines(placed, result.objects).flatMap(o =>
    o.segments.flat(),
  );
  near(
    [Math.min(...points.map(p => p[0])), Math.max(...points.map(p => p[0]))],
    [-10, 10],
  );
  near(
    [Math.min(...points.map(p => p[1])), Math.max(...points.map(p => p[1]))],
    [-5, 5],
  );
  assert.deepEqual(placed.entities, []);
});

test('a named original remains a writable point reference through an anonymous spatial base', async () => {
  const result = await compile(`import {sketch, rectangle} from '@code3d/core';
const profile = sketch([['point', 1, [0, 0]]]);
const child = profile.relate(s => s.plane.align(rectangle(20, 20))).derive([
  ['point', 1, [10, 0]], ['line', 2, [profile.point(1), 1]],
]);`);
  const child = [...result.sketches.values()].at(-1)!;
  assert.equal(child.references[defined(child.base)], 'profile');
});

test('context projection preserves separate occurrences of the same model inside nested groups', async () => {
  const result =
    await compile(`import {sketch, rectangle, group} from '@code3d/core';
const tile = rectangle(10, 10);
const frame = group([tile, tile]);
const host = group([frame]).expose({plane: frame.up}).rotate(0, 0, 90);
const profile = sketch().relate(s => s.plane.align(host.plane));`);
  const placed = [...result.sketches.values()].at(-1)!;
  const context = outlines(placed, result.objects);
  assert.equal(context.length, 2);
  assert.equal(context[0].nodeId, context[1].nodeId);
  assert.deepEqual(context[0].segments, context[1].segments);
  const points = context.flatMap(o => o.segments.flat());
  near(
    [Math.min(...points.map(p => p[0])), Math.max(...points.map(p => p[0]))],
    [-5, 5],
  );
  near(
    [Math.min(...points.map(p => p[1])), Math.max(...points.map(p => p[1]))],
    [-5, 5],
  );
});
