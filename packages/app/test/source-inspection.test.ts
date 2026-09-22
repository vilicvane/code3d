import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import type {InspectionItem} from '../src/model/inspection-snapshot.ts';
import {defined} from '../../../test/assert.ts';
import {
  createTestModelPipeline,
  packageTestFiles,
} from './project-test-files.ts';
import {createAppTestServer} from './vite-test-server.ts';

let server: Awaited<ReturnType<typeof createAppTestServer>>;
let pipeline: Awaited<ReturnType<typeof createTestModelPipeline>>;
before(async () => {
  server = await createAppTestServer();
  pipeline = await createTestModelPipeline(server);
});
after(async () => {
  await pipeline?.dispose();
  await server?.close();
});

async function compile(source: string, failure?: RegExp) {
  const module = await pipeline.compile(
    {files: [{path: '/model.ts', source}]},
    '/model.ts',
  );
  if (failure) assert.match(defined(module.diagnostic).summary, failure);
  else assert.equal(module.diagnostic, undefined, module.diagnostic?.summary);
  return (text: string, delta = 0) => {
    const offset = source.lastIndexOf(text);
    assert.notEqual(offset, -1, text);
    return pipeline.executor.inspect({
      file: '/model.ts',
      offset: offset + delta,
    });
  };
}

function width(value: unknown): number {
  const item = value as Extract<InspectionItem, {kind: 'model'}>;
  assert.equal(item.kind, 'model');
  const vertices = defined(item.model.mesh).vertices;
  const xs = Array.from(vertices).filter((_, index) => index % 3 === 0);
  return Math.max(...xs) - Math.min(...xs);
}

test('originCenter previews the complete centered layout and keeps input member focus', async () => {
  const inspect =
    await compile(`import {rectangle, originCenter, extrude} from '@code3d/core';
    const first=rectangle(2,4).originOffset(-3,0,0);
    const second=rectangle(6,2).originOffset(-12,0,0);
    const centered=originCenter([first,second]);
    export default extrude(centered,1);`);
  const all = defined(await inspect('originCenter([first,second])'));
  assert.equal(all.target.length, 2);
  assert.equal(all.ambient.length, 0);
  const member = defined(await inspect('first,second', 0));
  assert.equal(member.target.length, 2);
  assert.equal(member.target.filter(value => value.focused).length, 1);
  member.target.forEach((item, index) => {
    assert.ok(item.kind === 'model');
    assert.equal(
      width({kind: 'model', model: defined(item.model.children[0])}),
      [2, 6][index],
    );
  });
});

test('parameter inspection falls through to call inspection and then the ordinary call result', async () => {
  const inspect = await compile(`import {box} from '@code3d/core';
    /**
     * @code3d.inspect part.inspectCall
     * @code3d.inspect width part.inspectWidth
     */
    function part(width: number, height: number) { return box(width, height, 3); }
    namespace part {
      export function inspectWidth([width]) {
        if (width === 4) return undefined;
        if (width === 1) return {};
        return {target: [box(width * 2, 2, 3)]};
      }
      export function inspectCall([width, height], context) {
        if (width === 6) return undefined;
        return {target: [box(context.focused.parameter === 'height' ? height * 3 : 11, 2, 3)]};
      }
    }
    function plain(width: number) { return box(width, 2, 3); }
    part(3, 7);
    part(4, 8);
    part(6, 9);
    part(1, 2);
    plain(13);
    export default box(2, 2, 2);`);
  assert.equal(width(defined(await inspect('part(3, 7)', 5)).target[0]), 6);
  assert.equal(width(defined(await inspect('part(3, 7)', 8)).target[0]), 21);
  assert.equal(width(defined(await inspect('part(4, 8)', 5)).target[0]), 11);
  assert.equal(width(defined(await inspect('part(6, 9)', 8)).target[0]), 6);
  assert.deepEqual(defined(await inspect('part(1, 2)', 5)).target, []);
  assert.equal(width(defined(await inspect('plain(13)', 6)).target[0]), 13);
  assert.equal(width(defined(await inspect('part(3, 7)')).target[0]), 11);
  for (const [token, delta, kind] of [
    ['part(3, 7)', 5, 'inspect'],
    ['part(4, 8)', 5, 'inspect'],
    ['part(1, 2)', 5, 'inspect'],
    ['part(6, 9)', 8, 'preview'],
    ['plain(13)', 6, 'preview'],
    ['plain(13)', 0, 'preview'],
  ] as const)
    assert.equal(defined(await inspect(token, delta)).kind, kind, token);
});

test('failed calls retain evaluated arguments and the last captured data without reexecuting', async () => {
  const inspect = await compile(
    `import {box, captureInspectData} from '@code3d/core';
    let calls = 0;
    /** @code3d.inspect broken.inspect */
    function broken(size: number) {
      calls++;
      captureInspectData({body: box(99, 2, 3)});
      captureInspectData({body: box(size, 2, 3)});
      throw new Error('Model failed');
    }
    namespace broken {
      export function inspect([size], context) {
        if (calls !== 2 || context.return !== undefined) throw new Error('Repeated or completed call');
        if (context.data.body.bounds().size[0] !== size) throw new Error('Wrong failed invocation');
        return {ambient: [context.data.body]};
      }
    }
    try { broken(3); } catch {}
    broken(7);`,
    /Model failed/,
  );
  for (const size of [3, 7]) {
    const scene = defined(await inspect(`broken(${size})`));
    assert.equal(width(scene.ambient[0]), size);
    assert.deepEqual(scene.target, []);
    assert.equal(
      width(defined(await inspect(`broken(${size})`, 7)).ambient[0]),
      size,
    );
  }
});

test('argument failures and optional short circuits never invoke the outer inspector', async () => {
  const inspect = await compile(`import {box} from '@code3d/core';
    function badArgument() { throw new Error('Argument failed'); }
    /** @code3d.inspect never.inspect */
    function never(a: number, b: number) { throw new Error('Should not enter'); }
    namespace never {
      export function inspect() { throw new Error('Should not inspect'); }
    }
    try { never(1, badArgument()); } catch {}
    const absent: typeof never | undefined = undefined;
    absent?.(1, 2);
    export default box(2, 2, 3);`);
  assert.equal(await inspect('never(1,'), undefined);
  assert.equal(await inspect('absent?.'), undefined);
});

test('a failed callback can inspect its entered closure and captured parent context', async () => {
  const inspect = await compile(
    `import {box, captureInspectData} from '@code3d/core';
    /**
     * @code3d.inspect.context build wrap.context
     * @code3d.inspect.closure build wrap.inspect
     */
    function wrap(build: () => void) {
      captureInspectData({body: box(17, 2, 3)});
      build();
    }
    namespace wrap {
      export function context(execution) {
        if (execution.call.return !== undefined || execution.return !== undefined)
          throw new Error('Unexpected closure result');
        return execution.call.data;
      }
      export function inspect(_args, context) { return {target: [context.closure.data.body]}; }
    }
    wrap(() => { const selected = 'before failure'; throw new Error('Callback failed'); });`,
    /Callback failed/,
  );
  assert.equal(width(defined(await inspect("'before failure'")).target[0]), 17);
});

test('failed intersection and zero extrusion retain complete original input scopes', async () => {
  const common = await compile(
    `import {box, intersect} from '@code3d/core';
    const a = box(4, 4, 4);
    const b = box(4, 4, 4).originOffset(-20, 0, 0);
    intersect([a, b]);`,
    /no common solid volume/,
  );
  const scene = defined(await common('[a, b]', 1));
  assert.equal(scene.ambient.length, 1);
  assert.equal(scene.target.length, 1);
  assert.equal(scene.target[0].focused, true);
  for (const call of ['a.extrude(0)', 'extrude([a, b], 0)']) {
    const inspect = await compile(
      `import {on, align, rectangle, extrude} from '@code3d/core';
      const a = rectangle(4, 6);
      const b = rectangle(8, 10).originOffset(-20, 0, 0);
      ${call};`,
      /finite and non-zero/,
    );
    const scene = defined(await inspect('0)', 0));
    assert.equal(scene.ambient.length, call.startsWith('a.') ? 1 : 2);
    assert.deepEqual(scene.target, []);
  }
});

test('executes a namespace inspector through a function alias only when requested', async () => {
  const inspect = await compile(`import {box} from '@code3d/core';
    let inspections = 0;
    /** @code3d.inspect width part.inspectWidth */
    function part(width: number) { return box(width, 2, 3); }
    namespace part {
      export function inspectWidth([width], context) {
        inspections++;
        if (context.focused.parameter !== 'width' || context.focused.value !== width)
          throw new Error('Wrong parameter focus');
        if (context.return.bounds().size[0] !== width) throw new Error('Wrong result');
        return {target: [box(width * 2, 2, 3)]};
      }
    }
    const alias = part;
    export default alias(7);
    if (inspections !== 0) throw new Error('Inspector ran during modeling');`);
  const result = defined(await inspect('alias(7)', 'alias('.length));
  assert.equal(width(result.target?.[0]), 14);
  assert.equal(
    width(defined(await inspect('alias(7)')).target[0]),
    7,
    'an unannotated identifier keeps its ordinary return preview',
  );
});

test('keeps captured data with its actual call across nested calls and equal scalar results', async () => {
  const inspect =
    await compile(`import {box, captureInspectData} from '@code3d/core';
    captureInspectData({width: 99}); // No inspected call owns this record.
    /** @code3d.inspect measured.inspect */
    function measured(width: number): number {
      captureInspectData({width});
      return 0;
    }
    namespace measured {
      export function inspect(_args, context) {
        if (context.return !== 0) throw new Error('Changed modeling result');
        return {target: [box(context.data.width, 2, 3)]};
      }
    }
    /** @code3d.inspect outer.inspect */
    function outer(width: number): number {
      captureInspectData({width: 100});
      measured(4);
      captureInspectData({width});
      measured(6);
      return 0;
    }
    namespace outer {
      export function inspect(_args, context) {
        if (context.return !== 0) throw new Error('Changed outer result');
        return {target: [box(context.data.width, 2, 3)]};
      }
    }
    measured(3);
    measured(8);
    outer(11 + measured(5));
    export default box(2, 2, 3);`);
  for (const [selection, expected] of [
    ['measured(3)', 3],
    ['measured(8)', 8],
    ['measured(4)', 4],
    ['measured(5)', 5],
    ['measured(6)', 6],
    ['outer(11', 11],
  ] as const) {
    assert.equal(
      width(defined(await inspect(selection)).target[0]),
      expected,
      selection,
    );
  }
});

test('provides captured call data to closure factories and restores recording after execution', async () => {
  const inspect =
    await compile(`import {box, captureInspectData} from '@code3d/core';
    /**
     * @code3d.inspect.context build wrap.context
     * @code3d.inspect.closure build wrap.inspect
     */
    function wrap(width: number, build: () => void) {
      build();
      captureInspectData(box(width, 2, 3));
      return 0;
    }
    namespace wrap {
      export function context(execution) {
        if (execution.call.return !== 0) throw new Error('Wrong call');
        return execution.call.data;
      }
      export function inspect(_args, context) {
        captureInspectData(box(99, 2, 3)); // Inspectors cannot overwrite model records.
        return {target: [context.closure.data]};
      }
    }
    /** @code3d.inspect empty.inspect */
    function empty() { return 0; }
    namespace empty {
      export function inspect(_args, context) {
        if (context.data !== undefined) throw new Error('Inherited data from another call');
        return {};
      }
    }
    wrap(7, () => { const selected = 'here'; });
    empty();
    export default box(2, 2, 3);`);
  for (let count = 0; count < 2; count++)
    assert.equal(width(defined(await inspect("'here'")).target[0]), 7);
  assert.deepEqual(defined(await inspect('empty();')).target, []);
});

test('retains private helpers in the lexical instance that created each callable', async () => {
  const inspect = await compile(`import {box, group} from '@code3d/core';
    function factory(multiplier: number) {
      function preview([size]) { return {target: [box(size * multiplier, 2, 3)]}; }
      /** @code3d.inspect size preview */
      const build = (size: number) => box(size, 2, 3);
      return build;
    }
    const first = factory(2);
    const second = factory(3);
    export default group([first(5), second(7)]);`);
  assert.equal(
    width(defined(await inspect('first(5)', 'first('.length)).target?.[0]),
    10,
  );
  assert.equal(
    width(defined(await inspect('second(7)', 'second('.length)).target?.[0]),
    21,
  );
});

test('provides per-execution closure data independently of which inspector renders', async () => {
  const inspect = await compile(`import {box, group} from '@code3d/core';
    let initialized = 0;
    /**
     * @code3d.inspect.context build surround.context
     * @code3d.inspect.closure build surround.inspect
     */
    function surround(self, build) { build(self); return self; }
    namespace surround {
      export function context(execution) {
        initialized++;
        if (initialized > 1) throw new Error('Context constructed more than once');
        return {self: execution.arguments[0], result: execution.call.return};
      }
      export function inspect(_args, context) {
        if (context.focused.value !== context.closure.data.self) return undefined;
        return {target: [context.closure.data.self]};
      }
    }
    /** @code3d.inspect join.inspect */
    function join(left, right) { return left; }
    namespace join {
      export function inspect([left, right], context) {
        const closure = context.closure;
        if (closure.provider !== surround.context || closure.data.self !== left || closure.data.result !== left)
          throw new Error('Missing closure data');
        return {ambient: [right], target: [closure.data.self]};
      }
    }
    function build(self) {
      const extra = box(4, 2, 3);
      self;
      return join(self, extra);
    }
    const first = surround(box(5, 2, 3), build);
    const second = surround(box(9, 2, 3), build);
    if (initialized) throw new Error('Context constructed during modeling');
    export default group([first, second]);`);
  const child = defined(await inspect('join(self, extra)'));
  assert.equal(width(child.target?.[0]), 9);
  assert.equal(width(child.ambient?.[0]), 4);
  const closure = defined(await inspect('self;'));
  assert.equal(width(closure.target?.[0]), 9);
  assert.equal(width(defined(await inspect('box(4, 2, 3)')).target[0]), 4);
});

test('maps destructured parameters and array members without changing the argument tuple', async () => {
  const inspect = await compile(`import {box} from '@code3d/core';
    /**
     * @code3d.inspect height build.inspectHeight
     * @code3d.inspect widths build.inspectWidths
     */
    function build({height, widths}: {height: number; widths: number[]}) { return box(widths[0], height, 3); }
    namespace build {
      export function inspectHeight([options], context) {
        if (context.focused.parameter !== 'height' || context.focused.path.length) throw new Error('Wrong height scope');
        return {target: [box(options.height, 2, 3)]};
      }
      export function inspectWidths([options], context) {
        if (context.focused.parameter !== 'widths' || context.focused.path.join('.') !== '1') throw new Error('Wrong array path');
        return {target: [box(options.widths[1], 2, 3)]};
      }
    }
    export default build({height: 6, widths: [4, 9]});`);
  assert.equal(
    width(defined(await inspect('height: 6', 'height: '.length)).target?.[0]),
    6,
  );
  assert.equal(
    width(defined(await inspect('4, 9', '4, '.length)).target?.[0]),
    9,
  );
});

test('walks nested closure scopes and preserves an explicitly empty local scene', async () => {
  const inspect = await compile(`import {box} from '@code3d/core';
    /**
     * @code3d.inspect.context build wrap.context
     * @code3d.inspect.closure build wrap.inspect
     */
    function wrap(size: number, build: () => unknown) { build(); return box(size, 2, 3); }
    namespace wrap {
      export function context(execution) { return execution.call.return; }
      export function inspect(args, context) {
        const closure = context.closure;
        if (closure.parent) {
          if (closure.parent.data.bounds().size[0] !== 10)
            throw new Error('Missing parent context');
          if (context.focused.value === 4) return undefined;
        }
        return {target: [closure.data]};
      }
    }
    /** @code3d.inspect inspectPick */
    function pick(value: number) { return value; }
    function inspectPick([value]) { return value === 3 ? {} : undefined; }
    export default wrap(10, () => wrap(6, () => {
      pick(2);
      pick(3);
      pick(4);
    }));`);
  assert.equal(width(defined(await inspect('pick(2)')).target?.[0]), 6);
  const empty = defined(await inspect('pick(3)'));
  assert.deepEqual(empty.target, []);
  assert.deepEqual(empty.ambient, []);
  assert.equal(width(defined(await inspect('pick(4)')).target?.[0]), 10);
});

test('loads published inspectors whose declarations were stripped, through aliases and namespaces', async () => {
  const entries = new Map(
    Object.entries({
      '/package.json':
        '{"type":"module","dependencies":{"@code3d/core":"*","inspection-library":"1.0.0"}}',
      '/node_modules/inspection-library/package.json':
        '{"type":"module","exports":{"types":"./index.d.ts","default":"./index.js"}}',
      '/node_modules/inspection-library/index.js': `import {box, captureInspectData} from '@code3d/core';
      export function build(width) { captureInspectData({width: width * 2}); return box(width, 2, 3); }
      export function inspectBuild(_args, context) { return {target: [box(context.data.width, 2, 3)]}; }
      export function part(width) { return box(width, 2, 3); }
      part.inspect = ([width]) => ({target: [box(width * 3, 2, 3)]});`,
      '/node_modules/inspection-library/index.d.ts': `import type {SolidModel} from '@code3d/core';
      /** @code3d.inspect inspectBuild */
      export declare function build(width: number): SolidModel;
      /** @code3d.inspect part.inspect */
      export declare function part(width: number): SolidModel;`,
    }),
  );
  const published = await createTestModelPipeline(server, {
    readFile: async path =>
      entries.has(path)
        ? new TextEncoder().encode(entries.get(path))
        : packageTestFiles.readFile(path),
    stat: async path =>
      entries.has(path)
        ? {kind: 'file', version: entries.get(path)!}
        : [...entries.keys()].some(file => file.startsWith(path + '/'))
          ? {kind: 'directory', version: ''}
          : packageTestFiles.stat(path),
  });
  try {
    const source = `import {build as renamed, part} from 'inspection-library';
      import {group} from '@code3d/core';
      export default group([renamed(5), part(7)]);`;
    const module = await published.compile(
      {files: [{path: '/model.ts', source}]},
      '/model.ts',
    );
    assert.equal(module.diagnostic, undefined);
    const inspect = (text: string) =>
      published.executor.inspect({
        file: '/model.ts',
        offset: source.lastIndexOf(text),
      });
    assert.equal(width(defined(await inspect('renamed(5)')).target?.[0]), 10);
    assert.equal(width(defined(await inspect('part(7)')).target?.[0]), 21);
  } finally {
    await published.dispose();
  }
});

test('reference-only inspection preserves captured measurement and relation stages without model wrappers', async () => {
  const inspect =
    await compile(`import {align, distance, frame, offset} from '@code3d/core';
    const base = frame('Base').relate(() => offset(2, 3, 4));
    export default frame('Moving').relate(self => {
      const measured = distance(base.origin, self.origin);
      return [align(self, base), offset(8, 0, 0)];
    });`);
  const measured = defined(await inspect('distance(base.origin, self.origin)'));
  const dimension = measured.target.find(item => item.kind === 'dimension');
  assert.ok(dimension?.kind === 'dimension' && 'start' in dimension);
  assert.equal(dimension.model.kind, 'reference');
  assert.ok(Math.abs(dimension.value - Math.sqrt(29)) < 1e-6);
  assert.deepEqual(dimension.start, [2, 3, 4]);
  assert.deepEqual(dimension.end, [0, 0, 0]);
  for (const scene of [
    measured,
    defined(await inspect('align(self, base)', 1)),
    defined(await inspect('offset(8, 0, 0)', 8)),
  ]) {
    assert.ok(scene.objects.size > 0);
    for (const object of scene.objects.values()) {
      assert.equal(object.kind, 'reference');
      assert.equal(object.mesh, undefined);
      assert.deepEqual(object.children, []);
    }
  }
  const stage = defined(await inspect('align(self, base)', 1));
  const self = stage.target.find(
    item => item.kind === 'anchor' && item.model.name === 'Moving',
  );
  assert.ok(self?.kind === 'anchor');
  assert.deepEqual(self.elements[0].transform.position, [2, 3, 4]);
  const final = defined(await inspect('offset(8, 0, 0)', 8));
  const moved = final.target.find(
    item => item.kind === 'anchor' && item.model.name === 'Moving',
  );
  assert.ok(moved?.kind === 'anchor');
  assert.deepEqual(moved.elements[0].transform.position, [10, 3, 4]);
  const again = defined(await inspect('distance(base.origin, self.origin)'));
  assert.equal(
    again.target.find(item => item.kind === 'dimension')?.model.nodeId,
    dimension.model.nodeId,
  );
});

test('standalone frames inspect without geometry and group frame options retain the assembly context', async () => {
  const inspect =
    await compile(`import {align, box, frame, group, offset, rotate} from '@code3d/core';
    const datum = frame('Datum');
    const base = datum.relate(() => [offset(10, 20, 30), rotate(0, 30, 0)]);
    const part = box(4, 6, 8).relate(self => [align(self.frame, base), rotate(0, 450, 0)]);
    export default group([part], {name: 'Assembly', frame: base});`);
  const created = defined(await inspect("frame('Datum')")).target[0];
  assert.equal(created.kind, 'anchor');
  if (created.kind !== 'anchor') return;
  assert.equal(created.elements[0].kind, 'frame');
  const position = defined(await inspect('offset(10, 20, 30)', 8));
  assert.ok(
    position.target.some(
      item =>
        item.kind === 'anchor' &&
        item.elements.some(element => element.kind === 'frame'),
    ),
  );
  const selected = defined(await inspect('base});', 1));
  assert.equal(selected.kind, 'inspect');
  assert.equal(selected.target.length, 1);
  const base = selected.target[0];
  assert.equal(base.kind, 'anchor');
  if (base.kind !== 'anchor') return;
  assert.equal(base.model.kind, 'reference');
  assert.equal(base.focused, true);
  assert.equal(base.elements[0].kind, 'frame');
  base.elements[0].transform.position.forEach(value =>
    assert.ok(Math.abs(value) < 1e-6),
  );
  assert.equal(selected.ambient.length, 1);
  const members = defined(await inspect('[part]', 1));
  assert.equal(members.target.length, 1);
  assert.equal(members.target[0].focused, true);
  assert.equal(members.target[0].kind, 'model');
});

test('group member inspection preserves empty reference frames and member focus', async () => {
  const inspect =
    await compile(`import {align, box, group, offset} from '@code3d/core';
    const base = group([]);
    const part = box(4, 6, 8).relate(self => [align(self.frame, base.frame), offset(12, 0, 0)]);
    export default group([base, part]);`);
  for (const [token, focused] of [
    ['[base, part]', [true, true]],
    ['base, part', [true, false]],
    ['part]);', [false, true]],
  ] as const) {
    const scene = defined(await inspect(token));
    assert.deepEqual(
      scene.target.map(item => item.focused),
      focused,
      token,
    );
    const [empty, part] = scene.target;
    assert.ok(empty.kind === 'model' && part.kind === 'model');
    assert.deepEqual(
      empty.model.elements.filter(element => element.bound),
      [],
    );
    assert.equal(empty.model.children[0].mesh, undefined);
    assert.equal(empty.model.children[0].children.length, 0);
    assert.deepEqual(part.model.children[0].transform.position, [12, 0, 0]);
    assert.equal(width({kind: 'model', model: part.model.children[0]}), 4);
  }
});

test('gear assembly parameters inspect the positioned train', async () => {
  const inspect = await compile(`import {group} from '@code3d/core';
    import {assembleGears, spurGear} from '@code3d/gears';
    const first = spurGear({module: 2, teeth: 20, faceWidth: 10});
    const second = spurGear({module: 2, teeth: 30, faceWidth: 10});
    const placed = assembleGears([first, second], {centerDistanceDelta: 0.2});
    export default group(placed);`);
  for (const [token, delta] of [
    ['assembleGears(', 0],
    ['[first, second]', 0],
    ['centerDistanceDelta: 0.2', 21],
  ] as const) {
    const scene = defined(await inspect(token, delta));
    assert.equal(scene.kind, 'inspect');
    assert.equal(scene.target.length, 2);
    assert.deepEqual(
      scene.target.map(target => {
        assert.equal(target.kind, 'model');
        return target.kind === 'model'
          ? target.model.children[0].transform.position[0]
          : undefined;
      }),
      [0, 50.2],
    );
  }
  const all = defined(await inspect('[first, second]'));
  assert.deepEqual(
    all.target.map(target => target.focused),
    [true, true],
  );
  const call = defined(await inspect('assembleGears('));
  assert.deepEqual(
    call.target.map(target => target.focused),
    [true, true],
  );
  const focused = defined(await inspect('second],', 1));
  assert.deepEqual(
    focused.target.map(target => target.focused),
    [false, true],
  );
});

test('compound gear inspection keeps tuple and individual member focus', async () => {
  const inspect = await compile(`import {group} from '@code3d/core';
    import {assembleGears, spurGear} from '@code3d/gears';
    const first = spurGear({module: 2, teeth: 20, faceWidth: 10});
    const large = spurGear({module: 2, teeth: 30, faceWidth: 10});
    const small = spurGear({module: 2, teeth: 18, faceWidth: 10}).originOffset(0, -12, 0);
    const last = spurGear({module: 2, teeth: 40, faceWidth: 10});
    const placed = assembleGears([first, [large, small], last], {centerDistanceDelta: 0.2});
    export default group(placed);`);
  for (const [token, focused] of [
    ['assembleGears(', [true, true, true, true]],
    ['[first, [large, small], last]', [true, true, true, true]],
    ['[large, small]', [false, true, true, false]],
    ['large, small', [false, true, false, false]],
    ['small], last', [false, false, true, false]],
  ] as const) {
    const scene = defined(await inspect(token));
    assert.deepEqual(
      scene.target.map(item => item.focused),
      focused,
      token,
    );
    const positions = scene.target.map(item => {
      assert.ok(item.kind === 'model');
      return item.model.children[0].transform.position;
    });
    positions.forEach((position, index) => {
      const expected = [
        [0, 0, 0],
        [50.2, 0, 0],
        [50.2, 0, 0],
        [108.4, 12, 0],
      ][index];
      assert.ok(
        position.every(
          (value, axis) => Math.abs(value - expected[axis]) < 1e-6,
        ),
      );
    });
  }
});

test('reports inspector errors separately from successful model evaluation and drops replaced contexts', async () => {
  const inspect = await compile(`import {box} from '@code3d/core';
    /** @code3d.inspect part.inspect */
    function part() { return box(4, 2, 3); }
    namespace part { export function inspect() { throw new Error('Inspection failed'); } }
    export default part();`);
  await assert.rejects(inspect('part()')!, error => {
    const diagnostic = (error as {diagnostic: {kind: string; summary: string}})
      .diagnostic;
    assert.equal(diagnostic.kind, 'inspect');
    assert.equal(diagnostic.summary, 'Inspection failed');
    return true;
  });
  const next = await compile(
    `import {box} from '@code3d/core'; export default box(8, 2, 3);`,
  );
  assert.equal(width(defined(await next('box(8, 2, 3)')).target[0]), 8);
});

test('serializes generated dimensions with their owner and keeps model geometry immutable', async () => {
  const inspect = await compile(`import {box, dimension} from '@code3d/core';
    /** @code3d.inspect size part.inspect */
    function part(size: number) { return box(size, 2, 3); }
    namespace part {
      export function inspect([size], {return: model}) {
        return {ambient: [model], target: [model, dimension({
          owner: model, start: [-size / 2, 0, 0], end: [size / 2, 0, 0], value: size,
        })]};
      }
    }
    export default part(12);`);
  const scene = structuredClone(
    defined(await inspect('part(12)', 'part('.length)),
  );
  assert.equal(width(scene.target[0]), 12);
  assert.equal(
    scene.ambient.length,
    0,
    'the same explicit target is not duplicated in ambient',
  );
  const dimension = scene.target[1];
  assert.equal(dimension.kind, 'dimension');
  if (dimension.kind !== 'dimension' || scene.target[0].kind !== 'model')
    return;
  assert.ok('start' in dimension);
  assert.equal(dimension.model, scene.target[0].model);
  assert.deepEqual(dimension.start, [-6, 0, 0]);
  assert.deepEqual(dimension.end, [6, 0, 0]);
  assert.equal(dimension.value, 12);
  assert.equal(width(defined(await inspect('part(12)')).target[0]), 12);
});

test('distance inspection retains measured endpoints and poses when relate finishes later', async () => {
  const inspect =
    await compile(`import {on, box, distance, group, offset} from '@code3d/core';
    const base = box(10, 10, 10);
    const part = box(2, 2, 2).relate(self => {
      const before = distance(base.right, self.left, 'x');
      if (before !== 6) throw new Error('Wrong original measurement');
      return [on(self, base.right), offset(3, 0, 0)];
    });
    const after = distance(base.right, part.left, 'x');
    if (after !== 3) throw new Error('Wrong final measurement');
    export default group([base, part]);`);
  const before = defined(await inspect("distance(base.right, self.left, 'x')"));
  const beforeDimension = before.target.find(
    value => value.kind === 'dimension',
  );
  assert.equal(beforeDimension?.kind, 'dimension');
  if (beforeDimension?.kind !== 'dimension') return;
  assert.ok('start' in beforeDimension);
  assert.equal(beforeDimension.value, 6);
  assert.deepEqual(beforeDimension.start, [5, 0, 0]);
  assert.deepEqual(beforeDimension.end, [-1, 0, 0]);
  assert.equal(beforeDimension.axisLabel, 'X');
  assert.equal(
    before.target.filter(value => value.kind === 'anchor').length,
    2,
  );
  for (const body of before.ambient) {
    assert.equal(body.kind, 'model');
    if (body.kind === 'model')
      assert.deepEqual(body.model.children[0].transform.position, [0, 0, 0]);
  }
  const after = defined(await inspect("distance(base.right, part.left, 'x')"));
  const afterDimension = after.target.find(value => value.kind === 'dimension');
  assert.equal(afterDimension?.kind, 'dimension');
  if (afterDimension?.kind !== 'dimension') return;
  assert.ok('start' in afterDimension);
  assert.equal(afterDimension.value, 3);
  assert.deepEqual(afterDimension.start, [5, 0, 0]);
  assert.deepEqual(afterDimension.end, [8, 0, 0]);
  const moved = after.ambient.find(
    value =>
      value.kind === 'model' &&
      value.model.children[0].transform.position[0] === 9,
  );
  assert.ok(moved);

  const focused = defined(await inspect('self.left', 'self.'.length));
  assert.equal(
    focused.target.filter(value => value.kind === 'anchor' && value.focused)
      .length,
    1,
  );
  assert.equal(
    focused.target.filter(value => value.kind === 'anchor').length,
    2,
    'positioning preserves identity without duplicating the focused anchor',
  );
});

test('distance whole-model parameter inspection directly partitions target and ambient', async () => {
  const inspect =
    await compile(`import {box, distance, group} from '@code3d/core';
    const a = box(2, 2, 2);
    const b = box(2, 2, 2).originOffset(-8, 0, 0);
    const size = distance(a, b);
    export default group([a, b]);`);
  const call = defined(await inspect('distance(a, b)'));
  assert.equal(call.target.filter(value => value.kind === 'model').length, 2);
  assert.equal(call.ambient.length, 0);
  const argument = defined(await inspect('distance(a, b)', 'distance('.length));
  assert.equal(
    argument.target.filter(value => value.kind === 'model').length,
    1,
  );
  assert.equal(
    argument.ambient.filter(value => value.kind === 'model').length,
    1,
  );
  assert.equal(
    argument.target.find(value => value.kind === 'model')?.focused,
    true,
  );
});

test('box and extrude parameter inspectors emit complete candidate segments and keep batch owners separate', async () => {
  const inspect =
    await compile(`import {box, rectangle, extrude, offset} from '@code3d/core';
    const body = box(12,14,16);
    const profile = rectangle(20,12).rotate(0,0,30).relate(self => offset(10,0,0));
    const solid = extrude(profile,-8);
    const batch = extrude([profile,profile.originOffset(0,0,-30)],8);
    profile.extrude(8); export default solid;`);
  const box = defined(await inspect('box(12,14,16)', 'box('.length));
  assert.equal(box.target.length, 2);
  const x = defined(box.target.find(value => value.kind === 'dimension'));
  assert.ok('candidates' in x);
  assert.equal(x.value, 12);
  assert.equal(x.axisLabel, 'X');
  assert.equal(x.candidates.length, 4);
  for (const {start, end} of x.candidates) {
    assert.equal(Math.abs(start[0] - end[0]), 12);
    assert.deepEqual(start.slice(1), end.slice(1));
  }
  for (const [token, delta, count, value] of [
    ['extrude(profile,-8)', 'extrude(profile,'.length, 1, -8],
    ['profile.extrude(8)', 'profile.extrude('.length, 1, 8],
    ['-30)],8)', '-30)],'.length, 2, 8],
  ] as const) {
    const scene = defined(await inspect(token, delta));
    const annotations = scene.target.filter(item => item.kind === 'dimension');
    assert.equal(annotations.length, count);
    assert.equal(scene.ambient.length, count);
    assert.equal(
      new Set(annotations.map(item => item.model.nodeId)).size,
      count,
    );
    for (const annotation of annotations) {
      assert.ok('candidates' in annotation);
      assert.equal(annotation.value, value);
      assert.equal(annotation.candidates.length, 4);
      for (const {start, end} of annotation.candidates)
        assert.ok(
          Math.abs(Math.hypot(...end.map((v, i) => v - start[i])) - 8) < 1e-8,
        );
      assert.ok(
        scene.target.some(
          item =>
            item.kind === 'model' &&
            item.model.nodeId === annotation.model.nodeId,
        ),
      );
    }
  }
  const input = defined(
    await inspect('extrude(profile,-8)', 'extrude('.length),
  );
  assert.equal(input.target.length, 1);
  assert.equal(input.target[0].focused, true);
  assert.equal(input.ambient.length, 1);
  const result = defined(await inspect('extrude(profile,-8)'));
  assert.equal(result.target.length, 1);
  assert.equal(result.ambient.length, 0);
});

test('group parameter inspection keeps each member in the actual assembly frame', async () => {
  const inspect =
    await compile(`import {on, box, group, offset} from '@code3d/core';
    const a = box(10, 10, 10).relate(self => offset(20, 0, 0));
    const b = box(2, 2, 2).relate(self => on(self, a.right));
    const assembly = group([a, b]);
    export default group([assembly, assembly.relate(self => offset(100, 0, 0))]);`);
  const all = defined(await inspect('[a, b]', 0));
  assert.equal(all.target.length, 2);
  assert.equal(all.ambient.length, 0);
  assert.ok(all.target.every(item => item.focused));
  const positions = all.target.map(item => {
    assert.equal(item.kind, 'model');
    return item.kind === 'model'
      ? item.model.children[0].transform.position
      : undefined;
  });
  assert.deepEqual(positions, [
    [0, 0, 0],
    [6, 0, 0],
  ]);
  const member = defined(await inspect('b]);', 0));
  assert.deepEqual(
    member.target.map(item => item.focused),
    [false, true],
  );
  const result = defined(await inspect('group([a, b])'));
  assert.equal(result.target.length, 1);
  assert.equal(result.target[0].kind, 'model');
});

test('missing and invalid topology references inspect their owner while valid references keep default preview', async () => {
  for (const method of ['vertex', 'edge', 'surface']) {
    for (const argument of ['', '0']) {
      const call = `body.${method}(${argument})`;
      const inspect = await compile(
        `import {on, align, box} from '@code3d/core'; const body = box(4,6,8); ${call};`,
        /IDs must be/,
      );
      const scene = defined(await inspect(call, call.length - 1));
      assert.equal(scene.target.length, 0);
      assert.equal(scene.ambient.length, 1);
      assert.equal(width(scene.ambient[0]), 4);
    }
    const call = `body.${method}(1)`;
    const inspect = await compile(
      `import {on, align, box} from '@code3d/core'; const body = box(4,6,8); ${call};`,
    );
    const scene = defined(await inspect(call, call.length - 1));
    assert.equal(scene.target[0].kind, 'anchor');
    assert.equal(scene.ambient.length, 0);
  }
  for (const call of ['body.edge(1).vertex()', 'body.vertices([])']) {
    const inspect = await compile(
      `import {on, align, box} from '@code3d/core'; const body = box(4,6,8); ${call};`,
      call.endsWith('vertex()') ? /IDs must be/ : undefined,
    );
    const scene = defined(await inspect(call, call.length - 1));
    assert.equal(scene.target.length, 0);
    assert.equal(scene.ambient.length, 1);
    assert.equal(width(scene.ambient[0]), 4);
  }
});

test('expose inspects recorded references in the receiving assembly without repeating getters', async () => {
  const inspect =
    await compile(`import {on, box, group, offset} from '@code3d/core';
    const body = box(4, 6, 8), other = box(2,2,2).relate(self => on(self, body.right));
    let reads = 0;
    const refs = {get end() {if (++reads > 1) throw new Error('Getter repeated'); return other.right;}, center: body.center};
    const exposed = group([body, other]).expose(refs);
    const staticRefs = {tip: other.right, center: body.center};
    group([body, other]).expose(staticRefs);
    export default exposed;`);
  const saved = defined(await inspect('expose(refs)', 'expose('.length));
  assert.deepEqual(
    saved.target.map(item => item.kind),
    ['anchor', 'anchor'],
  );
  assert.equal(saved.ambient.length, 1);
  const reference = saved.target[0];
  assert.equal(reference.kind, 'anchor');
  if (reference.kind === 'anchor')
    assert.deepEqual(reference.elements[0].transform.position, [4, 0, 0]);
  const direct = defined(await inspect('expose(staticRefs)', 'expose('.length));
  assert.ok(direct.target.every(item => item.focused));
  const result = defined(await inspect('expose(refs)'));
  assert.equal(result.target.length, 1);
  assert.equal(result.target[0].kind, 'model');
  assert.equal(result.ambient.length, 0);
});

test('nested constructors preview their own result before a cut consumes a related copy', async () => {
  const inspect = await compile(`import {box, cut, on} from '@code3d/core';
    let body = box(20,8,16).fillet(3.96, [1,3,5,7]);
    body = body.cut([
      box(16,6,16).relate(self => on(self.up, body.up)),
    ]);
    cut(box(20,8,16), [box(12,4,12).originOffset(-2,0,0)]);`);
  for (const [token, size] of [
    ['box(16,6,16)', 16],
    ['box(12,4,12)', 12],
  ] as const) {
    const scene = defined(await inspect(token, 'box'.length));
    assert.equal(scene.kind, 'preview');
    assert.equal(scene.target.length, 1);
    assert.equal(width(scene.target[0]), size);
    assert.deepEqual(scene.ambient, []);
  }
  const dimension = defined(await inspect('box(16,6,16)', 'box('.length));
  assert.equal(dimension.kind, 'inspect');
  assert.ok(dimension.target.some(item => item.kind === 'dimension'));
  const tools = defined(await inspect('[\n      box', 1));
  assert.equal(tools.kind, 'inspect');
  assert.equal(tools.target.length, 2);
  assert.deepEqual(
    tools.target.map(item => item.focused),
    [true, false],
  );
  assert.equal(tools.ambient.length, 1);
});

test('cut tool inspection declines upstream values outside its recorded operands', async () => {
  const inspect = await compile(`import {box, cut, on} from '@code3d/core';
    const stock = box(20,8,16);
    const tool = box(16,6,16);
    stock.cut([tool.relate(self => on(self.up, stock.up))]);
    cut(stock, [tool.originOffset(-1,0,0)]);`);
  for (const token of ['tool.relate', 'tool.originOffset']) {
    const scene = defined(await inspect(token));
    assert.equal(scene.kind, 'preview');
    assert.equal(scene.target.length, 1);
    assert.equal(width(scene.target[0]), 16);
    assert.deepEqual(scene.ambient, []);
  }
});

test('cut tool inspection declines non-solid values in tool builder receivers', async () => {
  const inspect = await compile(`import {box, rectangle} from '@code3d/core';
    const stock = box(20,20,20);
    const builder = {
      profile: rectangle(12,12),
      tool() { return this.profile.extrude(30); },
    };
    stock.cut([builder.tool()]);`);
  const scene = defined(await inspect('builder.tool'));
  assert.equal(scene.kind, 'preview');
  assert.equal(scene.target.length, 1);
  assert.equal(width(scene.target[0]), 12);
  assert.deepEqual(scene.ambient, []);
});

test('enclosing inspectors retain the default preview owner across calls, receivers and closures', async () => {
  const inspect = await compile(`import {box} from '@code3d/core';
    /**
     * @code3d.inspect operand outer.inspectInput
     * @code3d.inspect outer.inspectCall
     */
    function outer(operand: unknown, mode: string) { return box(30,2,3); }
    namespace outer {
      export function inspectInput([operand, mode]) {
        return mode === 'parameter' ? {target: [box(40,2,3)]} : undefined;
      }
      export function inspectCall([operand, mode]) {
        return mode === 'call' ? {target: [box(50,2,3)]} : undefined;
      }
    }
    /**
     * @code3d.inspect.closure build wrap.inspectBody
     * @code3d.inspect wrap.inspectCall
     */
    function wrap(build: () => void) { build(); return box(13,2,3); }
    namespace wrap {
      export function inspectBody() { return undefined; }
      export function inspectCall() { throw new Error('Callback body re-entered the call inspector'); }
    }
    const input = box(7,2,3);
    outer(box(9,2,3).originOffset(-1,0,0), 'decline');
    outer(input.originOffset(-2,0,0), 'decline');
    outer(input, 'decline');
    outer(input.originOffset(-3,0,0), 'parameter');
    outer(input.originOffset(-4,0,0), 'call');
    outer(wrap(() => { input; }), 'decline');
    outer(wrap(() => { input.originOffset(-5,0,0); }), 'decline');`);
  for (const [token, delta, size, kind] of [
    ['box(9,2,3)', 3, 9, 'preview'],
    ['input.originOffset(-2', 0, 7, 'preview'],
    ["input, 'decline'", 0, 30, 'preview'],
    ['input.originOffset(-3', 0, 40, 'inspect'],
    ['input.originOffset(-4', 0, 50, 'inspect'],
    ['input;', 0, 7, 'preview'],
    ['input.originOffset(-5', 6, 7, 'preview'],
  ] as const) {
    const scene = defined(await inspect(token, delta));
    assert.equal(scene.kind, kind, token);
    assert.equal(scene.target.length, 1, token);
    assert.equal(width(scene.target[0]), size, token);
    assert.deepEqual(scene.ambient, [], token);
  }
});

test('boolean inspectors preserve original placement and generate only the focused cut volume', async () => {
  const inspect =
    await compile(`import {align, box, cut, union, intersect, group, offset} from '@code3d/core';
    const stock = box(20,20,20).relate(self => offset(30,0,0));
    const a = box(4,40,4).relate(self => [align(self.center, stock.center), offset(-5,0,0)]);
    const b = box(4,40,4).relate(self => [align(self.center, stock.center), offset(5,0,0)]);
    const result = cut(stock, [a,b]);
    stock.cut([a,b]); union([stock,a]); intersect([stock,a]);
    const far = box(2,2,2).originOffset(-100,0,0);
    cut(stock, [far]); export default result;`);
  const centerX = (item: InspectionItem) => {
    assert.equal(item.kind, 'model');
    if (item.kind !== 'model') return NaN;
    const child = item.model.children[0];
    const xs = Array.from(defined(child.mesh).vertices).filter(
      (_, i) => i % 3 === 0,
    );
    return (
      (Math.min(...xs) + Math.max(...xs)) / 2 + child.transform.position[0]
    );
  };
  const stock = defined(await inspect('cut(stock, [a,b])', 'cut('.length));
  assert.equal(stock.target.length, 1);
  assert.equal(centerX(stock.target[0]), 30);
  assert.deepEqual(stock.ambient.map(centerX), [25, 35]);
  for (const [token, delta, size, center, selected] of [
    ['[a,b]', 0, 14, 30, 2],
    ['[a,b]', 1, 4, 25, 1],
    ['[a,b]', 3, 4, 35, 1],
    ['stock.cut([a,b])', 'stock.cut(['.length, 4, 25, 1],
  ] as const) {
    const scene = defined(await inspect(token, delta));
    assert.equal(scene.target.length, selected + 1);
    assert.deepEqual(
      scene.target.map(item => item.focused),
      [...Array(selected).fill(true), false],
    );
    assert.equal(scene.ambient.length, 3 - selected);
    const region = scene.target.at(-1)!;
    assert.equal(region.kind, 'model');
    if (region.kind === 'model')
      assert.equal(
        width({kind: 'model', model: region.model.children[0]}),
        size,
      );
    assert.equal(centerX(region), center);
  }
  const noVolume = defined(await inspect('[far]'));
  assert.equal(noVolume.target.length, 1);
  assert.equal(noVolume.target[0].focused, true);
  assert.equal(noVolume.ambient.length, 1);
  const union = defined(
    await inspect('union([stock,a])', 'union([stock,'.length),
  );
  assert.deepEqual(union.target.map(centerX), [30, 25]);
  assert.deepEqual(
    union.target.map(value => value.focused),
    [false, true],
  );
  for (const delta of [
    'intersect('.length,
    'intersect(['.length,
    'intersect([stock,'.length,
  ]) {
    const common = defined(await inspect('intersect([stock,a])', delta));
    const selected = delta === 'intersect('.length ? 2 : 1;
    assert.equal(common.target.length, selected + 1);
    assert.equal(common.ambient.length, 2 - selected);
    assert.deepEqual(
      common.target.map(item => item.focused),
      [...Array(selected).fill(true), false],
    );
    const region = common.target.at(-1)!;
    assert.equal(region.kind, 'model');
    if (region.kind === 'model') {
      const material = region.model.material;
      assert.ok(material && typeof material !== 'string');
      assert.equal(material.color, 0x66c9ff);
      assert.equal(material.depthTest, false);
      assert.equal(material.toneMapped, false);
    }
    assert.equal(centerX(region), 25);
  }
  const result = defined(await inspect('cut(stock, [a,b])'));
  assert.equal(result.target.length, 1);
  assert.equal(result.ambient.length, 0);
  const original = defined(await inspect('intersect([stock,a])')).target[0];
  assert.equal(original.kind, 'model');
  if (original.kind === 'model')
    assert.equal(original.model.material, undefined);
});

test('loft inspectors distinguish section and destructured spine parameters in the same solved frame', async () => {
  const inspect =
    await compile(`import {align, circle, line, loft, offset} from '@code3d/core';
    const lower = circle(8);
    const upper = circle(4).relate(self => [align(self.center, lower.center), offset(0,20,0)]);
    const path = line([0,20,0]);
    export default loft([lower, upper], {spine: path});`);
  const sections = defined(await inspect('[lower, upper]'));
  assert.equal(sections.target.length, 2);
  assert.equal(sections.ambient.length, 2);
  assert.ok(sections.target.every(item => item.focused));
  const upper = sections.target[1];
  assert.equal(upper.kind, 'model');
  if (upper.kind === 'model')
    assert.deepEqual(upper.model.children[0].transform.position, [0, 20, 0]);
  const spine = defined(await inspect('path});'));
  assert.equal(spine.target.length, 1);
  assert.equal(spine.ambient.length, 3);
  assert.equal(spine.target[0].focused, true);
  const result = defined(await inspect('loft([lower'));
  assert.equal(result.target.length, 1);
  assert.equal(result.ambient.length, 0);
});

test('revolve inspection keeps profile, axis and solid in the solved frame', async () => {
  const inspect =
    await compile(`import {rectangle, line, revolve} from '@code3d/core';
    const profile = rectangle(4, 6).rotate(90, 0, 0).originOffset(-8, 0, 0);
    const axis = line([0, -20, 0], [0, 20, 0]).edge(1);
    export default revolve(profile, axis, {angle: 180});`);
  const profile = defined(await inspect('profile, axis'));
  assert.equal(profile.target.length, 1);
  assert.equal(profile.ambient.length, 2);
  const axis = defined(await inspect('axis, {angle'));
  assert.equal(axis.target.length, 1);
  assert.equal(axis.ambient.length, 2);
  const output = defined(await inspect('revolve(profile'));
  assert.equal(output.target.length, 1);
  assert.equal(output.ambient.length, 0);
});

test('sweep inspection distinguishes profile, spine and solid', async () => {
  const inspect =
    await compile(`import {circle, bezier, sweep} from '@code3d/core';
    const profile = circle(2);
    const spine = bezier([[0, 0, 0], [0, 8, 0], [5, 16, 0], [5, 24, 0]]);
    export default sweep(profile, spine);`);
  const profile = defined(await inspect('profile, spine'));
  assert.equal(profile.target.length, 1);
  assert.equal(profile.ambient.length, 2);
  const spine = defined(await inspect('spine);'));
  assert.equal(spine.target.length, 1);
  assert.equal(spine.ambient.length, 2);
  const result = defined(await inspect('sweep(profile'));
  assert.equal(result.target.length, 1);
  assert.equal(result.ambient.length, 0);

  const inspectMethod =
    await compile(`import {circle, line} from '@code3d/core';
    const profile = circle(2);
    const spine = line([0, 12, 0]);
    export default profile.sweep(spine);`);
  const methodSpine = defined(await inspectMethod('spine);'));
  assert.equal(methodSpine.target.length, 1);
  assert.equal(methodSpine.ambient.length, 2);
});

test('relate call and closure inspectors use actual consumed participants and relation stages', async () => {
  const inspect =
    await compile(`import {on, box, group, offset} from '@code3d/core';
    const base = box(10, 10, 10);
    const part = box(2, 2, 2).relate(self => {
      const extra = box(99, 2, 2);
      extra;
      const face = base.right;
      face;
      const relation = on(self, face);
      return [relation, offset(3, 0, 0)];
    });
    export default group([base, part]);`);
  const call = defined(await inspect('.relate(', 1));
  assert.equal(call.target.length, 1);
  assert.equal(call.ambient.length, 1);
  const part = call.target[0];
  assert.equal(part.kind, 'model');
  if (part.kind !== 'model') return;
  assert.deepEqual(part.model.children[0].transform.position, [9, 0, 0]);
  const repeated = defined(await inspect('.relate(', 1));
  assert.equal(repeated.target[0].kind, 'model');
  if (repeated.target[0].kind === 'model')
    assert.equal(repeated.target[0].model.nodeId, part.model.nodeId);
  assert.equal(
    width(
      call.ambient[0].kind === 'model'
        ? {kind: 'model', model: call.ambient[0].model.children[0]}
        : undefined,
    ),
    10,
  );
  const unrelated = defined(await inspect('extra;'));
  assert.equal(width(unrelated.target[0]), 99);
  assert.equal(unrelated.ambient.length, 0);
  const face = defined(await inspect('face;'));
  assert.equal(face.target[0].kind, 'anchor');
  assert.equal(face.target[0].focused, true);
  const stage = defined(await inspect('relation, offset'));
  assert.equal(stage.target[0].kind, 'model');
  if (stage.target[0].kind === 'model')
    assert.deepEqual(
      stage.target[0].model.children[0].transform.position,
      [6, 0, 0],
    );
});

test('spatial relation parameters inspect their consumed stage without adopting unrelated values', async () => {
  const inspect =
    await compile(`import {on, box, offset, pivotVertex, axisEdge} from '@code3d/core';
    const base = box(10, 10, 10);
    export default box(2, 4, 6).relate(self => {
      const unused = pivotVertex(1);
      return [on(self, base.up), offset(3, 0, 0), pivotVertex(6).pivotOffset(2, 0, 0).rotate(0, 0, 30), axisEdge(1).axisOffset(1, 0, 0).rotate(20)];
    });`);
  for (const token of [
    'offset(3',
    'pivotVertex(6',
    'pivotOffset(2',
    'rotate(0, 0, 30',
    'axisEdge(1',
    'axisOffset(1',
    'rotate(20',
  ]) {
    const scene = defined(await inspect(token, token.indexOf('(') + 1));
    assert.equal(scene.target[0].kind, 'model', token);
    assert.equal(scene.ambient.length, 1, token);
    assert.ok(
      scene.target.every(item => !item.focused),
      token,
    );
  }
  assert.equal(await inspect('pivotVertex(1)', 12), undefined);
});

test('relate takes complete related collections and declines mixed collections without dropping members', async () => {
  const inspect =
    await compile(`import {on, box, group, offset} from '@code3d/core';
    const base = box(10, 10, 10), extra = box(99, 2, 2);
    const part = box(2, 2, 2).relate(self => {
      const related = [self, [base.right]];
      const mixed = [self, extra];
      const named = {self, face: base.right};
      const mapped = new Map<string, unknown>([['self', self], ['face', base.right]]);
      const unique = new Set([self, base.right]);
      const mixedMap = new Map<string, unknown>([['self', self], ['extra', extra]]);
      Object.defineProperty(mapped, 'values', {value() {throw new Error('Do not invoke override');}});
      const accessor = {self, get extra() {throw new Error('Do not invoke');}};
      related; mixed; named; mapped; unique; mixedMap; accessor;
      const relations = [on(self, base.right), offset(3, 0, 0)];
      return relations;
    }); export default group([base, part]);`);
  for (const token of ['related;', 'named;', 'mapped;', 'unique;']) {
    const scene = defined(await inspect(token));
    assert.deepEqual(
      scene.target.map(item => item.kind),
      ['model', 'anchor'],
    );
    const model = scene.target[0];
    assert.equal(model.kind, 'model');
    if (model.kind === 'model')
      assert.deepEqual(model.model.children[0].transform.position, [9, 0, 0]);
    assert.equal(scene.ambient.length, 1);
    assert.ok(scene.target.every(item => item.focused));
  }
  const mixed = defined(await inspect('mixed;'));
  assert.equal(mixed.target.length, 2);
  assert.equal(width(mixed.target[1]), 99);
  assert.equal(mixed.ambient.length, 0);
  const mixedMap = defined(await inspect('mixedMap;'));
  assert.equal(mixedMap.target.length, 2);
  assert.equal(width(mixedMap.target[1]), 99);
  assert.equal(mixedMap.ambient.length, 0);
  const accessor = defined(await inspect('accessor;'));
  assert.equal(accessor.target.length, 1);
  assert.equal(accessor.ambient.length, 0);
  const relations = defined(
    await inspect('return relations', 'return '.length),
  );
  assert.equal(relations.target[0].kind, 'model');
  assert.equal(relations.ambient.length, 1);
});

test('on returns the exact support bounds and operands in its joint constraint stage', async () => {
  const inspect =
    await compile(`import {on, box, group, offset} from '@code3d/core';
    const base = box(10, 10, 10);
    const part = box(2, 4, 6).relate(self => [on(self, base.right), offset(3, 0, 0)]);
    export default group([base, part]);`);
  const call = defined(await inspect('on(', 1));
  assert.deepEqual(
    call.target.map(value => value.kind),
    ['model', 'model', 'anchor', 'anchor', 'bounds'],
  );
  assert.equal(call.ambient.length, 0);
  const bounds = call.target[4];
  assert.equal(bounds.kind, 'bounds');
  if (bounds.kind !== 'bounds') return;
  assert.deepEqual(
    [...bounds.size].sort((a, b) => a - b),
    [2, 4, 6],
  );
  assert.deepEqual(bounds.frame.position, [6, 0, 0]);
  assert.deepEqual(bounds.model.children[0].transform.position, [6, 0, 0]);
  const parameter = defined(await inspect('base.right', 'base.'.length));
  assert.equal(
    parameter.target.filter(value => value.kind === 'anchor' && value.focused)
      .length,
    1,
  );
  assert.equal(
    parameter.target.find(value => value.kind === 'bounds')?.focused,
    false,
  );
  const source = defined(await inspect('self, ', 1));
  assert.equal(
    source.target.find(value => value.kind === 'bounds')?.focused,
    true,
  );
});

test('anchor annotations retain focus and both curve endpoints without changing geometry', async () => {
  const inspect =
    await compile(`import {arc, anchorAnnotation} from '@code3d/core';
    /** @code3d.inspect reference show.inspect */
    function show(reference, direction) { return reference; }
    namespace show {
      export function inspect([reference, direction]) {
        return {target: [anchorAnnotation(reference, {direction})]};
      }
    }
    const curve = arc([10, 0, 0], [0, 10, 0], [-10, 0, 0]);
    show(curve, 'both');
    show(curve.edge(1).reverse(), 'forward');
    export default show(curve.edge(1), 'none');`);
  const both = defined(await inspect("show(curve, 'both')", 'show('.length))
    .target[0];
  assert.equal(both.kind, 'anchor');
  if (both.kind !== 'anchor') return;
  assert.equal(both.focused, true);
  assert.equal(both.direction, 'both');
  assert.equal(both.elements[0].arrows?.length, 2);
  assert.notDeepEqual(
    both.elements[0].arrows?.[0].position,
    both.elements[0].arrows?.[1].position,
  );
  const reverse = defined(
    await inspect('curve.edge(1).reverse()', 'curve.edge(1).'.length),
  ).target[0];
  assert.equal(reverse.kind, 'anchor');
  if (reverse.kind !== 'anchor') return;
  assert.equal(reverse.direction, 'forward');
  assert.equal(reverse.focused, true);
  assert.deepEqual(
    reverse.elements[0].arrows?.[0],
    both.elements[0].arrows?.[1],
  );
  const none = defined(
    await inspect("show(curve.edge(1), 'none')", 'show(curve.'.length),
  ).target[0];
  assert.equal(none.kind, 'anchor');
  if (none.kind !== 'anchor') return;
  assert.equal(none.direction, 'none');
  assert.equal(none.elements[0].arrows, undefined);
});

test('align provides directed reference annotations for whole curve models', async () => {
  const inspect =
    await compile(`import {align, line, box, group} from '@code3d/core';
    const base = box(10, 10, 10);
    const part = line([8, 0, 0]).relate(self => align(self, base.axis));
    export default group([base, part]);`);
  const scene = defined(await inspect('align(', 1));
  const refs = scene.target.filter(value => value.kind === 'anchor');
  assert.equal(refs.length, 2);
  assert.ok(refs.every(ref => ref.direction === 'forward'));
  assert.equal(refs[0].elements[0].arrows?.length, 1);
  assert.equal(refs[0].elements[0].topology?.kind, 'edge');
});

test('inspection sketches and point references do not accumulate across selections', async () => {
  const inspect = await compile(`import {box, sketch} from '@code3d/core';
    /** @code3d.inspect size preview */
    function part(size: number) { return box(size, 2, 3); }
    function preview([size]) {
      const profile = sketch([['point', 1, [0, 0]], ['point', 2, [size, 0]], ['line', 3, [1, 2]]]);
      return {target: [profile, profile.point(2)]};
    }
    export default part(12);`);
  for (let index = 0; index < 3; index++) {
    const scene = defined(await inspect('part(12)', 'part('.length));
    assert.equal(scene.sketches.size, 1);
    assert.deepEqual(
      scene.target.map(item => item.kind),
      ['sketch', 'sketch'],
    );
    const point = scene.target[1];
    if (point.kind !== 'sketch') return;
    assert.equal(point.pointId, 2);
    assert.ok(scene.sketches.has(point.sketchId));
  }
});

test('captures actual method receivers and spread tuples without repeating getters', async () => {
  const inspect = await compile(`import {box} from '@code3d/core';
    const events: string[] = [];
    function preview([a, b], context) {
      if (a !== 2 || b !== 3 || context.receiver !== receiver)
        throw new Error('Changed call arguments or this');
      return {target: [box(a + b, 2, 3)]};
    }
    class Methods {
      /** @code3d.inspect preview */
      run(a: number, b: number) {
        if (this !== receiver) throw new Error('Changed receiver');
        events.push('run');
        return box(a + b, 2, 3);
      }
    }
    const method = Methods.prototype.run;
    const receiver = {get run() { events.push('get'); return method; }};
    function* values() { events.push('spread'); yield 2; yield 3; }
    export default receiver.run(...values());
    if (events.join(',') !== 'get,spread,run') throw new Error(events.join(','));`);
  assert.equal(
    width(
      defined(await inspect('receiver.run', 'receiver.'.length)).target?.[0],
    ),
    5,
  );
});

test('preserves optional-chain short circuiting and private method receivers', async () => {
  const inspect = await compile(`import {box} from '@code3d/core';
    function preview(args, context) { return {target: [context.return]}; }
    class Methods {
      /** @code3d.inspect preview */
      #run(value: number) { return box(value, 2, 3); }
      run() { return this.#run(8); }
    }
    const receiver = new Methods();
    let calls = 0;
    /** @code3d.inspect preview */
    function part(value: number) { calls++; return box(value, 2, 3); }
    const maybe: {nested: {part: typeof part}} | undefined = undefined;
    maybe?.nested.part(calls++);
    const holder = {nested: {part}};
    holder?.nested.part(5);
    if (calls !== 1) throw new Error('Changed optional-chain evaluation');
    export default receiver.run();`);
  assert.equal(
    width(defined(await inspect('this.#run', 'this.'.length)).target?.[0]),
    8,
  );
  assert.equal(
    width(
      defined(await inspect('holder?.nested.part', 'holder?.nested.'.length))
        .target?.[0],
    ),
    5,
  );
});

test('sketch inspect mixes models, independent planes, derived layers and point references', async () => {
  const inspect =
    await compile(`import {align, box, sketch} from '@code3d/core';
    const stock = box(20, 20, 20);
    const base = sketch([['point', 1, [2, 3]], ['circle', 2, [1, 4]]]);
    const a = base.relate(s => align(s.plane, stock.up));
    const b = base.derive([['point', 3, [5, 6]]]).relate(s => align(s.plane, stock.right));
    /** @code3d.inspect show.inspect */
    function show() { return stock; }
    namespace show { export function inspect() { return {ambient: [stock], target: [a, b, b.point(3)]}; } }
    export default show();`);
  const scene = defined(await inspect('show();'));
  assert.equal(scene.ambient[0].kind, 'model');
  const [a, b, point] = scene.target;
  assert.ok(
    a.kind === 'sketch' && b.kind === 'sketch' && point.kind === 'sketch',
  );
  assert.notDeepEqual(
    a.model.compositionTransform.quaternion,
    b.model.compositionTransform.quaternion,
  );
  assert.equal(point.sketchId, b.sketchId);
  assert.equal(point.pointId, 3);
  assert.equal(a.model.mesh, undefined);
  assert.equal(b.model.mesh, undefined);
  assert.ok(scene.sketches.get(b.sketchId)?.base);
});

test('sketch relate inspection retains each relation stage, participants and focused points', async () => {
  const inspect =
    await compile(`import {align, box, sketch, offset} from '@code3d/core';
    const stock = box(20, 20, 20);
    const extra = sketch([['point', 9, [99, 99]]]);
    const profile = sketch([['point', 1, [2, 3]], ['point', 2, [7, 9]], ['line', 3, [1, 2]]]).relate(self => {
      const unrelated = extra;
      const selectedPoint = self.point(2);
      return [align(self.plane, stock.up), offset(4, 0, 0)];
    });
    export default profile;`);
  const call = defined(await inspect('.relate(', 1));
  const profile = call.target.find(item => item.kind === 'sketch');
  assert.ok(profile?.kind === 'sketch');
  assert.ok(
    Math.abs(profile.model.compositionTransform.position[0] - 4) < 1e-6,
  );
  assert.ok(call.ambient.some(item => item.kind === 'model'));
  const relation = defined(await inspect('align(', 1));
  const before = relation.target.find(item => item.kind === 'sketch');
  assert.ok(before?.kind === 'sketch');
  assert.ok(Math.abs(before.model.compositionTransform.position[0]) < 1e-6);
  const selected = defined(await inspect('self.point(2)', 6));
  const point = selected.target.find(item => item.kind === 'sketch');
  assert.ok(point?.kind === 'sketch');
  assert.equal(point.pointId, 2);
  assert.equal(point.focused, true);
  const unrelated = defined(await inspect('= extra', 2));
  assert.equal(unrelated.ambient.length, 0);
  assert.equal(unrelated.target.length, 1);
  assert.equal(unrelated.target[0].kind, 'sketch');
});

test('inspection geometry survives topology queries and export until the next successful scene', async () => {
  const inspect = await compile(`import {box} from '@code3d/core';
    /** @code3d.inspect part.inspect */
    function part(width: number) { return box(2, 2, 2); }
    namespace part {
      export function inspect([width]) {
        if (width === 0) throw new Error('Inspection failed');
        return {target: [box(width, 3, 4)]};
      }
    }
    part(7);
    part(0);
    part(9);`);
  const first = defined(await inspect('part(7)')).target[0];
  assert.equal(first.kind, 'model');
  assert.equal(first.model.kind, 'solid');
  const id = first.model.nodeId;
  const topology = () => pipeline.executor.inspectTopology(id, {});
  assert.ok(Math.abs(topology().bounds!.size[0] - 7) < 1e-5);
  const exported = pipeline.executor.export(
    [
      {
        nodeId: id,
        name: 'inspected',
        kind: first.model.kind,
        transform: first.model.transform,
      },
    ],
    {
      format: 'stl',
      scale: 1,
      upAxis: 'y',
      tolerance: 0.1,
      angularTolerance: 0.1,
      binary: true,
    },
  );
  assert.ok(exported.size > 84);
  assert.equal(
    await pipeline.executor.inspect({file: '/model.ts', offset: 0}),
    undefined,
  );
  assert.ok(Math.abs(topology().bounds!.size[0] - 7) < 1e-5);
  await assert.rejects(inspect('part(0)'), /Inspection failed/);
  assert.ok(Math.abs(topology().bounds!.size[0] - 7) < 1e-5);
  const second = defined(await inspect('part(9)')).target[0];
  assert.ok(
    Math.abs(
      pipeline.executor.inspectTopology(second.model.nodeId, {}).bounds!
        .size[0] - 9,
    ) < 1e-5,
  );
  assert.throws(topology, /snapshot is unavailable/);
});

test('invalid author-returned annotations fail before replacing retained inspection geometry', async () => {
  const inspect = await compile(`import {box} from '@code3d/core';
    /** @code3d.inspect show.inspect */
    function show(mode: number) { return box(7, 3, 4); }
    namespace show { export function inspect([mode], context) {
      if (mode === 0) return {target: [context.return]};
      return {target: [mode === 1
        ? {kind: 'dimension', owner: context.return, value: 1, candidates: []}
        : mode === 2 ? {kind: 'dimension', owner: context.return, value: NaN, start: [0,0,0], end: [1,0,0]}
        : {kind: 'bounds', owner: context.return, size: [-1,2,3], frame: {position: [0,0,0], quaternion: [0,0,0,1]}}]};
    } }
    show(0); show(1); show(2); show(3);`);
  const good = defined(await inspect('show(0)'));
  for (const mode of [1, 2, 3]) {
    await assert.rejects(
      inspect(`show(${mode})`),
      /dimension requires|bounds annotation requires/,
    );
    const geometry = pipeline.executor.inspectTopology(
      good.target[0].model.nodeId,
      {},
    );
    assert.ok(Math.abs(geometry.bounds!.size[0] - 7) < 1e-5);
  }
});

test('getter inspectors retain each read, lexical callbacks, receiver and data without rerunning getters', async () => {
  const inspect =
    await compile(`import {box, captureInspectData} from '@code3d/core';
    let reads = 0;
    let receivers = 0;
    function create(size: number) {
      const body = box(size, 2, 3);
      function show(args, context) {
        if (reads !== 3 || receivers !== 1 || args.length || context.return !== 7 || context.receiver.size !== size || context.data !== body)
          throw new Error('Getter was repeated or mixed with another read');
        return {target: [body]};
      }
      return new class {
        size = size;
        /** @code3d.inspect show */
        get reading() { reads++; captureInspectData(body); return 7; }
      };
    }
    const a = create(11), b = create(17);
    function receiver() { receivers++; return a; }
    const first = receiver().reading;
    const second = b['reading'];
    const third = a?.reading;
    const absent: typeof a | undefined = undefined;
    absent?.reading;
    export default box(1, 1, 1);`);
  for (let repeat = 0; repeat < 2; repeat++) {
    assert.equal(
      width(defined(await inspect('receiver().reading', 12)).target[0]),
      11,
    );
    assert.equal(
      width(defined(await inspect("b['reading']", 4)).target[0]),
      17,
    );
    assert.equal(width(defined(await inspect('a?.reading', 4)).target[0]), 11);
    assert.equal(await inspect('absent?.reading', 9), undefined);
  }
});

test('published readonly measurement properties inspect line, arc and surface geometry', async () => {
  const inspect =
    await compile(`import {line, arc, rectangle, box} from '@code3d/core';
    const straight = line([3, 4, 0]);
    const curved = arc([10, 0, 0], [0, 10, 0], [-10, 0, 0]);
    const face = rectangle(4, 6);
    const solid = box(2, 3, 4);
    const a = straight.length;
    const b = curved.length;
    const c = face.area;
    const d = solid.area;
    const e = solid.edge(1).length;
    const f = solid.surface(1).area;
    export default solid;`);
  assert.equal(defined(await inspect('straight.length', 1)).kind, 'preview');
  for (const [text, value, point] of [
    ['straight.length', 5, false],
    ['curved.length', 10 * Math.PI, true],
    ['face.area', 24, true],
    ['solid.area', 52, true],
  ] as const) {
    const scene = defined(await inspect(text, text.lastIndexOf('.') + 1));
    const measurement = scene.target.find(item => item.kind === 'dimension');
    assert.equal(measurement?.kind, 'dimension');
    assert.ok(Math.abs(measurement!.value - value) < 1e-5);
    assert.equal('at' in measurement!, point);
  }
  for (const text of ['solid.edge(1).length', 'solid.surface(1).area']) {
    const scene = defined(await inspect(text, text.lastIndexOf('.') + 1));
    assert.ok(scene.target.some(item => item.kind === 'dimension'));
    assert.ok(scene.target.some(item => item.kind === 'anchor'));
  }
});

test('getter inspection preserves thrown reads and super/private receiver semantics', async () => {
  const inspect = await compile(
    `import {box, captureInspectData} from '@code3d/core';
    let reads = 0;
    function show(_args, context) {
      if (reads !== 2) throw new Error('Repeated getter');
      return {target: [context.data]};
    }
    class Base {
      #body = box(19, 2, 3);
      /** @code3d.inspect show */
      get reading() { reads++; captureInspectData(this.#body); return 5; }
    }
    class Derived extends Base {
      read() { return super.reading; }
      /** @code3d.inspect show */
      get broken() { reads++; captureInspectData(box(23, 2, 3)); throw new Error('Broken getter'); }
    }
    const model = new Derived();
    model.read();
    model.broken;`,
    /Broken getter/,
  );
  assert.equal(width(defined(await inspect('super.reading', 7)).target[0]), 19);
  assert.equal(width(defined(await inspect('model.broken', 7)).target[0]), 23);
});

test('property inspection keeps continued optional chains and writes intact', async () => {
  const inspect = await compile(`import {box} from '@code3d/core';
    let reads = 0, writes = 0, keys = 0;
    function show(_args, context) {
      if (reads !== 3 || writes !== 2 || keys !== 1) throw new Error('Changed evaluation');
      return {target: [box(context.return, 2, 3)]};
    }
    const value = {
      /** @code3d.inspect show */
      get reading() { reads++; return 13; },
      set reading(value: number) { writes++; }
    };
    const absent: typeof value | undefined = undefined;
    function key() { keys++; return 'reading' as const; }
    value?.reading.toFixed(2);
    value?.[key()].toFixed(2);
    value?.reading.real;
    absent?.reading.toFixed(2);
    absent?.[key()].toFixed(2);
    value.reading = 1;
    (value.reading) = 2;
    export default box(1, 1, 1);`);
  for (const text of [
    'value?.reading.toFixed',
    'value?.[key()]',
    'value?.reading.real',
  ])
    assert.equal(width(defined(await inspect(text, 9)).target[0]), 13);
  assert.equal(await inspect('absent?.reading', 10), undefined);
});

test('volume inspection retains cubic values and centroid positions for exposed solids', async () => {
  const inspect = await compile(`import {box} from '@code3d/core';
    const solid = box(2, 3, 4).originOffset(10, 20, 30);
    const changed = solid.expose({original: solid}).scaled(2).rotate(0, 0, 90);
    const first = solid.volume;
    const second = changed.original.volume;
    export default changed;`);
  for (const [text, volume, at, target] of [
    ['solid.volume', 24, [-10, -20, -30], 'model'],
    ['changed.original.volume', 192, [40, -20, -60], 'anchor'],
  ] as const) {
    const scene = defined(await inspect(text, text.lastIndexOf('.') + 1));
    const measurement = scene.target.find(item => item.kind === 'dimension');
    assert.ok(measurement && 'at' in measurement);
    assert.ok(Math.abs(measurement.value - volume) < 1e-6);
    at.forEach((coordinate, index) =>
      assert.ok(Math.abs(measurement.at[index] - coordinate) < 1e-6),
    );
    assert.equal(measurement.axisLabel, 'volume');
    assert.ok(scene.target.some(item => item.kind === target));
  }
});

test('wrap inspection keeps finite target topology and thicken focuses its source faces', async () => {
  const inspect =
    await compile(`import {rectangle,sphere,wrap,thicken} from '@code3d/core';
    const body=sphere(20);
    const profile=rectangle(8,6).originOffset(0,-25,0);
    const target=body.surface(1);
    const faces=wrap(profile,target);
    export default thicken(faces,1);`);
  const profiles = defined(await inspect('profile,target'));
  assert.equal(profiles.target.length, 1);
  assert.equal(profiles.ambient.length, 2);
  const target = defined(await inspect('target);'));
  assert.equal(target.target.length, 1);
  assert.equal(target.target[0].kind, 'anchor');
  assert.equal(target.ambient.length, 2);
  const thickness = defined(
    await inspect('thicken(faces,1)', 'thicken(faces,'.length),
  );
  assert.equal(thickness.target.length, 1);
  assert.equal(thickness.ambient.length, 1);
  const result = defined(await inspect('thicken(faces,1)'));
  assert.equal(result.target.length, 1);
  assert.equal(result.ambient.length, 0);
});
