import assert from 'node:assert/strict';
import {after, before, beforeEach, test, type TestContext} from 'node:test';
import {setImmediate} from 'node:timers/promises';
import {locks} from 'node:worker_threads';
import {reaction} from 'mobx';
import {createAppTestServer} from './vite-test-server.ts';

let server: Awaited<ReturnType<typeof createAppTestServer>>;
let api: typeof import('../src/project/browser-projects.ts');
const deletedDatabases: string[] = [];
let deletionError: Error | undefined;
let deletionWait: Promise<void> | undefined;
const originalIndexedDB = Object.getOwnPropertyDescriptor(
  globalThis,
  'indexedDB',
);

before(async () => {
  server = await createAppTestServer();
  api = await server.ssrLoadModule('/src/project/browser-projects.ts');
  Object.defineProperty(globalThis, 'indexedDB', {
    configurable: true,
    value: {
      deleteDatabase(name: string) {
        deletedDatabases.push(name);
        const request = {
          error: deletionError,
          onsuccess: () => {},
          onerror: () => {},
        };
        void Promise.resolve(deletionWait).then(() => {
          if (request.error) request.onerror();
          else request.onsuccess();
        });
        return request;
      },
    },
  });
});

beforeEach(() => {
  deletedDatabases.length = 0;
  deletionError = undefined;
  deletionWait = undefined;
});

after(async () => {
  if (originalIndexedDB)
    Object.defineProperty(globalThis, 'indexedDB', originalIndexedDB);
  else Reflect.deleteProperty(globalThis, 'indexedDB');
  await server?.close();
});

function browser(t: TestContext) {
  const values = new Map<string, string>();
  const pages: {
    events: EventTarget;
    projects: InstanceType<typeof api.BrowserProjects>;
  }[] = [];
  let writeError: Error | undefined;
  t.after(() => {
    for (const page of pages) page.projects.dispose();
  });
  return {
    values,
    failWrites(error: Error) {
      writeError = error;
    },
    page() {
      const events = new EventTarget();
      const projects = new api.BrowserProjects(
        {
          getItem: key => values.get(key) ?? null,
          setItem(key, value) {
            if (writeError) throw writeError;
            values.set(key, value);
            for (const page of pages) {
              if (page.events === events) continue;
              queueMicrotask(() => {
                page.events.dispatchEvent(
                  Object.assign(new Event('storage'), {key}),
                );
              });
            }
          },
        },
        events,
        locks,
      );
      pages.push({events, projects});
      return {events, projects};
    },
  };
}

test('existing browser storage keeps its database and workspace identity', async t => {
  const origin = browser(t);
  const {projects} = origin.page();
  assert.deepEqual(projects.projects, [
    {id: 'browser', name: 'Default project', template: 'examples'},
  ]);
  assert.equal(origin.values.size, 0);
  const project = await projects.open();
  assert.equal(project.id, 'browser');
  assert.equal(api.browserProjectDatabaseName(project.id), 'code3d-project-v1');
  assert.equal(api.browserProjectWorkspaceId(project.id), 'browser');
  assert.equal(origin.values.size, 1);
});

test('concurrent creation preserves both projects and updates observed lists in other tabs', async t => {
  const origin = browser(t);
  const first = origin.page().projects;
  const second = origin.page().projects;
  const observer = origin.page().projects;
  const observed: string[][] = [];
  const stop = reaction(
    () => observer.projects.map(project => project.name),
    names => observed.push(names),
  );
  t.after(stop);
  const [one, two] = await Promise.all([
    first.create(' One '),
    second.create('Two'),
  ]);
  await setImmediate();
  assert.notEqual(one.id, two.id);
  assert.equal(one.name, 'One');
  assert.equal(
    api.browserProjectDatabaseName(one.id),
    `code3d-project-${one.id}`,
  );
  assert.equal(api.browserProjectWorkspaceId(one.id), `browser:${one.id}`);
  for (const manager of [first, second, observer])
    assert.deepEqual(
      manager.projects.map(project => project.name),
      ['Default project', 'One', 'Two'],
    );
  assert.deepEqual(observed.at(-1), ['Default project', 'One', 'Two']);
  await assert.rejects(first.create('   '), /Enter a project name/);
});

test('creation choices survive navigation and remain specific to each project', async t => {
  const origin = browser(t);
  const {projects} = origin.page();
  const populated = await projects.create('With examples', true);
  const empty = await projects.create('Empty', false);
  const reopened = origin.page().projects;
  assert.equal((await reopened.open(populated.id)).template, 'examples');
  assert.equal(
    (await origin.page().projects.open(empty.id)).template,
    undefined,
  );
  assert.equal(projects.projects[0]!.template, 'examples');
});

test('opening remembers the selected project and stale links fall back to that selection', async t => {
  const origin = browser(t);
  const first = origin.page().projects;
  const project = await first.create('Remembered');
  assert.deepEqual(await first.open(project.id), project);
  assert.deepEqual(await origin.page().projects.open(), project);
  assert.deepEqual(
    await origin.page().projects.open('deleted-project'),
    project,
  );
});

test('reset clears only the selected database and preserves its catalog entry', async t => {
  const {projects} = browser(t).page();
  const project = await projects.create('Keep this name');
  await projects.reset(project.id);
  assert.deepEqual(deletedDatabases, [
    api.browserProjectDatabaseName(project.id),
  ]);
  assert.deepEqual(projects.projects, [
    {id: 'browser', name: 'Default project', template: 'examples'},
    project,
  ]);
  assert.deepEqual(await projects.open(project.id), project);
});

test('exclusive background operations keep the active project and block target openers', async t => {
  const origin = browser(t);
  const {projects} = origin.page();
  const active = await projects.open();
  const target = await projects.create('Background project', false);
  let finishOperation!: () => void;
  const operationWait = new Promise<void>(resolve => {
    finishOperation = resolve;
  });
  let beginOperation!: () => void;
  const operationStarted = new Promise<void>(resolve => {
    beginOperation = resolve;
  });
  const operation = projects.runExclusive(target.id, async selected => {
    assert.deepEqual(selected, target);
    beginOperation();
    await operationWait;
    return 'copied';
  });
  await operationStarted;
  // Managing another project neither changes recent selection nor blocks this one.
  assert.deepEqual(await origin.page().projects.open(), active);
  let targetOpened = false;
  const opening = origin
    .page()
    .projects.open(target.id)
    .then(project => {
      targetOpened = true;
      return project;
    });
  await setImmediate();
  assert.equal(targetOpened, false);
  finishOperation();
  assert.equal(await operation, 'copied');
  assert.deepEqual(await opening, target);
  assert.deepEqual(deletedDatabases, []);
});

test('reset persists the starter choice before background initialization and retains its lease', async t => {
  const origin = browser(t);
  const {projects} = origin.page();
  const active = await projects.open();
  const target = await projects.create('Originally empty', false);
  let finishInitialization!: () => void;
  const initializationWait = new Promise<void>(resolve => {
    finishInitialization = resolve;
  });
  let beginInitialization!: () => void;
  const initializationStarted = new Promise<void>(resolve => {
    beginInitialization = resolve;
  });
  const reset = projects.reset(target.id, async project => {
    assert.equal(project.template, 'examples');
    assert.deepEqual(deletedDatabases, [
      api.browserProjectDatabaseName(target.id),
    ]);
    assert.equal(
      projects.projects.find(project => project.id === target.id)?.template,
      'examples',
    );
    beginInitialization();
    await initializationWait;
    throw new Error('Seed interrupted');
  });
  const rejected = assert.rejects(reset, /Seed interrupted/);
  await initializationStarted;
  let opened = false;
  const opening = origin
    .page()
    .projects.open(target.id)
    .then(project => {
      opened = true;
      return project;
    });
  await setImmediate();
  assert.equal(opened, false);
  assert.deepEqual(projects.projects[0], active);
  finishInitialization();
  await rejected;
  assert.deepEqual(await opening, {...target, template: 'examples'});
});

test('exclusive operations reject removed projects and page closure cancels a queued operation', async t => {
  const origin = browser(t);
  const owner = origin.page().projects;
  const target = await owner.create('In use');
  await owner.open(target.id);
  const manager = origin.page().projects;
  let ran = false;
  await assert.rejects(
    manager.runExclusive('removed', async () => {
      ran = true;
    }),
    /no longer exists/,
  );
  const waiting = manager.runExclusive(target.id, async () => {
    ran = true;
  });
  const rejected = assert.rejects(waiting, {name: 'AbortError'});
  await setImmediate();
  manager.dispose();
  await rejected;
  assert.equal(ran, false);
  assert.deepEqual(deletedDatabases, []);
});

test('deletion retains unrelated projects and deletes only the requested database', async t => {
  const {projects} = browser(t).page();
  const kept = await projects.create('Keep');
  const removed = await projects.create('Remove');
  await projects.remove(removed.id);
  assert.deepEqual(deletedDatabases, [
    api.browserProjectDatabaseName(removed.id),
  ]);
  assert.deepEqual(projects.projects, [
    {id: 'browser', name: 'Default project', template: 'examples'},
    kept,
  ]);
  await projects.remove(removed.id);
  assert.equal(deletedDatabases.length, 1);
});

test('deleting the final project creates a fresh identity that old links cannot revive', async t => {
  const {projects} = browser(t).page();
  await projects.remove('browser');
  assert.deepEqual(deletedDatabases, ['code3d-project-v1']);
  assert.equal(projects.projects.length, 1);
  const replacement = projects.projects[0]!;
  assert.notEqual(replacement.id, 'browser');
  assert.equal(replacement.name, 'Default project');
  assert.equal(replacement.template, undefined);
  assert.deepEqual(await projects.open('browser'), replacement);
  assert.notEqual(
    api.browserProjectDatabaseName(replacement.id),
    'code3d-project-v1',
  );
});

test('leaving while reset deletes files preserves the requested starter seed', async t => {
  const origin = browser(t);
  const projects = origin.page().projects;
  const empty = await projects.create('Reset empty project', false);
  let finishDeletion!: () => void;
  deletionWait = new Promise<void>(resolve => {
    finishDeletion = resolve;
  });
  let initialized = false;
  const reset = projects.reset(empty.id, async () => {
    initialized = true;
  });
  const rejected = assert.rejects(reset, {name: 'AbortError'});
  while (deletedDatabases.length === 0) await setImmediate();
  assert.equal(
    origin.page().projects.projects.find(project => project.id === empty.id)
      ?.template,
    'examples',
  );
  projects.dispose();
  finishDeletion();
  await rejected;
  assert.equal(initialized, false);
  const reopened = await origin.page().projects.open(empty.id);
  assert.equal(reopened.template, 'examples');
});

test('failed database deletion keeps the project available', async t => {
  const {projects} = browser(t).page();
  const project = await projects.create('Keep after failure');
  deletionError = new Error('Storage denied');
  await assert.rejects(projects.remove(project.id), /Storage denied/);
  assert.ok(projects.projects.some(entry => entry.id === project.id));
  await assert.rejects(projects.reset(project.id), /Storage denied/);
  assert.deepEqual(await projects.open(project.id), project);
});

test('failed project state cleanup keeps the directory entry so deletion can be retried', async t => {
  const {projects} = browser(t).page();
  const removed = await projects.create('Retry deletion');
  let attempts = 0;
  const cleanup = async () => {
    attempts++;
    assert.deepEqual(deletedDatabases, []);
    assert.ok(projects.projects.some(project => project.id === removed.id));
    if (attempts === 1) throw new Error('Cache cleanup failed');
  };
  await assert.rejects(
    projects.remove(removed.id, cleanup),
    /Cache cleanup failed/,
  );
  assert.ok(projects.projects.some(project => project.id === removed.id));
  await projects.remove(removed.id, cleanup);
  assert.equal(attempts, 2);
  assert.deepEqual(deletedDatabases, [
    api.browserProjectDatabaseName(removed.id),
  ]);
  assert.deepEqual(projects.projects, [
    {id: 'browser', name: 'Default project', template: 'examples'},
  ]);
});

test('project state cleanup finishes under the exclusive lease before another page can open', async t => {
  const origin = browser(t);
  const remover = origin.page().projects;
  const kept = await remover.create('Remaining project');
  let finishCleanup!: () => void;
  const cleanupWait = new Promise<void>(resolve => {
    finishCleanup = resolve;
  });
  let beginCleanup!: () => void;
  const cleanupStarted = new Promise<void>(resolve => {
    beginCleanup = resolve;
  });
  const removal = remover.remove('browser', async () => {
    assert.deepEqual(deletedDatabases, []);
    beginCleanup();
    await cleanupWait;
  });
  await cleanupStarted;
  let opened = false;
  const opening = origin
    .page()
    .projects.open('browser')
    .then(project => {
      opened = true;
      return project;
    });
  await setImmediate();
  assert.equal(opened, false);
  assert.ok(remover.projects.some(project => project.id === 'browser'));
  finishCleanup();
  await removal;
  assert.deepEqual(await opening, kept);
});

test('leaving during project cleanup cancels deletion before removing its files or catalog entry', async t => {
  const origin = browser(t);
  const remover = origin.page().projects;
  let finishCleanup!: () => void;
  const cleanupWait = new Promise<void>(resolve => {
    finishCleanup = resolve;
  });
  let beginCleanup!: () => void;
  const cleanupStarted = new Promise<void>(resolve => {
    beginCleanup = resolve;
  });
  const removal = remover.remove('browser', async () => {
    beginCleanup();
    await cleanupWait;
  });
  const rejected = assert.rejects(removal, {name: 'AbortError'});
  await cleanupStarted;
  remover.dispose();
  finishCleanup();
  await rejected;
  assert.deepEqual(deletedDatabases, []);
  assert.deepEqual(remover.projects, [
    {id: 'browser', name: 'Default project', template: 'examples'},
  ]);
  const nextPage = origin.page().projects;
  assert.deepEqual(nextPage.projects, remover.projects);
  assert.deepEqual(await nextPage.open('browser'), remover.projects[0]);
});

test('deletion waits for all project tabs while other projects remain usable', async t => {
  const origin = browser(t);
  const first = origin.page().projects;
  const second = origin.page().projects;
  const remover = origin.page().projects;
  await Promise.all([first.open('browser'), second.open('browser')]);
  let removed = false;
  const removal = remover.remove('browser').then(() => {
    removed = true;
  });
  const other = await remover.create('Other project');
  assert.deepEqual(await origin.page().projects.open(other.id), other);
  assert.equal(removed, false);
  assert.deepEqual(deletedDatabases, []);
  first.dispose();
  await setImmediate();
  assert.equal(removed, false);
  second.dispose();
  await removal;
  assert.deepEqual(deletedDatabases, ['code3d-project-v1']);
  assert.deepEqual(remover.projects, [other]);
});

test('an opener queued behind deletion rechecks the catalog before taking a project lease', async t => {
  const origin = browser(t);
  const remover = origin.page().projects;
  const kept = await remover.create('Remaining project');
  let finishDeletion!: () => void;
  deletionWait = new Promise(resolve => {
    finishDeletion = resolve;
  });
  const removal = remover.remove('browser');
  await setImmediate();
  assert.deepEqual(deletedDatabases, ['code3d-project-v1']);
  const opener = origin.page().projects;
  const opening = opener.open('browser');
  await setImmediate();
  finishDeletion();
  await removal;
  assert.deepEqual(await opening, kept);
  assert.deepEqual(opener.projects, [kept]);
});

test('page closure cancels a queued open and releases an active project lease', async t => {
  const origin = browser(t);
  const active = origin.page();
  await active.projects.open();
  const remover = origin.page().projects;
  const removal = remover.remove('browser');
  await setImmediate();
  const queued = origin.page();
  const opening = queued.projects.open('browser');
  const rejected = assert.rejects(opening, {name: 'AbortError'});
  await setImmediate();
  queued.events.dispatchEvent(new Event('pagehide'));
  await rejected;
  active.events.dispatchEvent(new Event('pagehide'));
  await removal;
  assert.deepEqual(deletedDatabases, ['code3d-project-v1']);
});

test('failed directory persistence does not publish a project that was not saved', async t => {
  const origin = browser(t);
  const {projects} = origin.page();
  origin.failWrites(new Error('Quota exceeded'));
  await assert.rejects(projects.create('Not saved'), /Quota exceeded/);
  assert.deepEqual(projects.projects, [
    {id: 'browser', name: 'Default project', template: 'examples'},
  ]);
  assert.equal(origin.values.size, 0);
});
