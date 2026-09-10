import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp, readFile, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright-core';
import {runCli, startServe} from '../../../cli/test/process.ts';
import {reserveLocalPort} from './local-port.ts';

test(
  'CLI edits and observes solved sketches, ancestors, arguments and derived solids',
  {timeout: 180_000},
  async t => {
    assert.ok(process.env.CODE3D_TEST_URL);
    const browser = await chromium.connectOverCDP(
      process.env.CODE3D_CDP_URL ?? 'http://localhost:9222',
    );
    t.after(() => browser.close());
    const context = await browser.newContext({
      viewport: {width: 1440, height: 900},
    });
    t.after(() => context.close());
    await context.addInitScript(() => {
      Object.defineProperty(navigator.clipboard, 'writeText', {
        value: async () => {},
      });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.env.CODE3D_TEST_URL);
    await page.locator('#agents-button').click();
    const port = await reserveLocalPort(t);
    await page.getByLabel('Local port', {exact: true}).fill(String(port.port));
    await page
      .getByRole('button', {name: 'Add agent & copy prompt', exact: true})
      .click();
    const prompt = await page
      .getByLabel('Agent prompt', {exact: true})
      .inputValue();
    const config = JSON.parse(prompt.match(/```json\n([\s\S]*?)\n```/)![1]);
    const temp = await mkdtemp(join(tmpdir(), 'c3d-agent-sketch-'));
    t.after(() => rm(temp, {recursive: true, force: true}));
    const configFile = join(temp, 'project.c3d.json');
    await writeFile(configFile, JSON.stringify(config), {mode: 0o600});
    await port.release();
    await startServe(t, configFile);
    await page.locator('.agent-status[data-state="online"]').waitFor();
    await page.getByRole('button', {name: 'Close', exact: true}).click();
    const cli = async (request: unknown, code = 0) => {
      const result = await runCli(
        [configFile, '--output-dir', temp],
        JSON.stringify(request),
      );
      assert.equal(result.code, code, result.stdout + result.stderr);
      return JSON.parse(result.stdout);
    };
    const apply = (input: object, code = 0) =>
      cli({operation: 'apply', input}, code);
    const file = '/agent-sketch.ts';
    const source = `import {sketch, extrude} from '@code3d/core';
const base = sketch([['point', 1, [0, 0]], ['circle', 2, [1, 20]]]);
/** @code3d.arguments [4] */
function design(radius = 3) {
  const profile = base.derive([
    ['point', 1, base.point(1)],
    ['circle', 2, [1, radius]],
  ], {constraints: [['radius', 2, radius * 2]]});
  return profile;
}
export default design();
`;
    const cursor = {file, regex: '(derive\\()'};
    const first = await apply({
      files: [{path: file, version: null, content: source}],
      cursor: {...cursor, arguments: '[5]'},
      render: true,
      topology: true,
      type: true,
    });
    const observation = first.data.observation;
    assert.equal(observation.argumentSource, 'explicit');
    assert.equal(observation.models.length, 2);
    assert.equal(observation.models[0].key, 's0');
    assert.equal(observation.models[1].role, 'upstream');
    assert.equal(
      observation.models[0].references[observation.models[1].layerId],
      'base',
    );
    assert.equal(observation.topology.kind, 'sketch');
    assert.equal(observation.topology.counts.region, 1);
    const circle = observation.topology.items.find(
      (item: {kind: string}) => item.kind === 'circle',
    );
    assert.deepEqual(circle.authoredParameters, [5]);
    assert.ok(Math.abs(circle.geometry.radius - 10) < 1e-6);
    const alias = observation.topology.items.find(
      (item: {kind: string}) => item.kind === 'point',
    );
    assert.deepEqual(alias.alias, {
      layer: observation.models[1].layerId,
      id: 1,
    });
    assert.deepEqual(alias.position, [0, 0]);
    assert.ok(observation.type.type.includes('Sketch'));
    assert.equal(observation.render.projection, 'orthographic');
    assert.equal(observation.render.coordinates, 'sketch-local');
    assert.equal(observation.render.mode, 'modeling');
    const png = await readFile(first.artifacts[0].path);
    assert.equal(png.subarray(1, 4).toString(), 'PNG');
    assert.equal(png.readUInt32BE(16), 960);
    assert.equal(png.readUInt32BE(20), 720);
    await writeFile('/tmp/code3d-agent-sketch-render.png', png);
    assert.equal(
      await page.locator('.agent-render-host .sketch-editor').count(),
      0,
    );
    const snapshotId = observation.snapshotId;
    const paged = await apply({
      topology: {snapshotId, model: 's0', offset: 2, limit: 1},
    });
    assert.equal(paged.data.observation.topology.items[0].kind, 'constraint');
    assert.equal(paged.data.observation.topology.nextOffset, 3);
    const upstream = await apply({topology: {snapshotId, model: 's1'}});
    assert.equal(upstream.data.observation.topology.items[1].radius, 20);
    assert.equal(upstream.data.observation.topology.items[1].id, circle.id);
    assert.equal(
      (await apply({topology: {snapshotId, kind: 'edge'}}, 1)).error.code,
      'sketch_filter_unsupported',
    );
    assert.equal(
      (await apply({topology: {snapshotId}, render: {view: 'top'}}, 1)).error
        .code,
      'sketch_view_unsupported',
    );
    assert.equal(
      (await apply({topology: {snapshotId}, render: {mode: 'render'}}, 1)).error
        .code,
      'sketch_render_mode_unsupported',
    );
    const modeling = await apply({
      topology: {snapshotId},
      render: {mode: 'modeling'},
    });
    assert.equal(modeling.data.observation.render.mode, 'modeling');
    assert.deepEqual(await readFile(modeling.artifacts[0].path), png);
    const fallback = await apply({
      cursor: {file, regex: 'const (profile) ='},
      topology: true,
    });
    assert.equal(fallback.data.observation.argumentSource, 'jsdoc');
    assert.equal(
      fallback.data.observation.topology.items[1].authoredParameters[0],
      4,
    );
    assert.ok(
      Math.abs(fallback.data.observation.topology.items[1].radius - 8) < 1e-6,
    );

    const read = await cli({operation: 'fs.read', path: file});
    const solid = source.replace(
      'export default design();',
      'export default extrude(design().face(), 5);',
    );
    const three = await apply({
      files: [{path: file, version: read.data.version, content: solid}],
      cursor: {file, regex: '(extrude\\()'},
      render: {view: 'top', mode: 'render'},
      topology: true,
    });
    assert.equal(three.data.observation.render.projection, 'perspective');
    assert.equal(three.data.observation.render.mode, 'render');
    assert.ok(three.data.observation.topology.counts.surface > 0);
    assert.equal(
      (await apply({topology: {snapshotId}}, 1)).error.code,
      'snapshot_expired',
    );
    assert.equal(
      (
        await apply(
          {files: [{path: file, version: read.data.version, content: source}]},
          1,
        )
      ).error.code,
      'version_conflict',
    );

    // A failed downstream 3D operation must not block observation of its valid sketch.
    const next = await cli({operation: 'fs.read', path: file});
    const broken = solid.replace(
      'extrude(design().face(), 5)',
      'extrude(design().face(), 0)',
    );
    const scoped = await apply({
      files: [{path: file, version: next.data.version, content: broken}],
      cursor,
      topology: true,
      render: true,
    });
    assert.equal(scoped.data.observation.topology.kind, 'sketch');
    const failed3d = await apply(
      {cursor: {file, regex: '(extrude\\()'}, topology: true},
      1,
    );
    assert.equal(failed3d.error.code, 'model_failed');
    const latest = await cli({operation: 'fs.read', path: file});
    const failed = await apply(
      {
        files: [
          {
            path: file,
            version: latest.data.version,
            content: source.replace(
              "[['radius', 2, radius * 2]]",
              "[['radius', 2, -1]]",
            ),
          },
        ],
        cursor,
        render: true,
      },
      1,
    );
    assert.equal(failed.error.code, 'model_failed');
    assert.equal(failed.error.details.accepted, true);
    assert.equal(failed.error.details.saved, true);
    assert.equal(failed.artifacts, undefined);

    const openFile = '/open-sketch.ts';
    const open = await apply({
      files: [
        {
          path: openFile,
          version: null,
          content:
            "import {sketch} from '@code3d/core'; export default sketch([['point',1,[0,0]],['point',2,[10,0]],['point',3,[0,10]],['arc',4,[1,10,2,3,'ccw']],['line',5,[2,3]]]);",
        },
      ],
      cursor: {file: openFile, regex: '(sketch\\()'},
      topology: true,
      render: true,
    });
    const arc = open.data.observation.topology.items.find(
      (item: {kind: string}) => item.kind === 'arc',
    );
    assert.ok(Math.abs(arc.geometry.sweep - Math.PI / 2) < 1e-6);
    assert.equal(open.data.observation.topology.counts.region, 1);
    const openRead = await cli({operation: 'fs.read', path: openFile});
    const unfinished = await apply({
      files: [
        {
          path: openFile,
          version: openRead.data.version,
          content: openRead.data.content.replace(",['line',5,[2,3]]", ''),
        },
      ],
      cursor: {file: openFile, regex: '(sketch\\()'},
      topology: true,
      render: true,
    });
    assert.equal(unfinished.data.observation.topology.regions.available, false);
    assert.ok(unfinished.artifacts[0].path);
    const emptyFile = '/empty-sketch.ts';
    const empty = await apply({
      files: [
        {
          path: emptyFile,
          version: null,
          content:
            "import {sketch} from '@code3d/core'; export default sketch([]);",
        },
      ],
      cursor: {file: emptyFile, regex: '(sketch\\()'},
      topology: true,
      render: true,
    });
    assert.equal(empty.data.observation.topology.total, 0);
    assert.equal(empty.data.observation.topology.bounds, null);
    assert.equal(empty.data.observation.topology.counts.region, 0);
    assert.ok(empty.artifacts[0].path);
    assert.deepEqual(errors, []);
  },
);
