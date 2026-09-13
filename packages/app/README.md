# @code3d/app

Code3D's browser modeling workspace: a TypeScript editor, project file explorer,
3D and sketch views, visual editing tools, and local agent collaboration. This
private package builds the App served at the website's `/app/` path.

For using the product, start with [working in the App](../web/src/content/docs/docs/getting-started/app.md)
or [collaborating with agents](../web/src/content/docs/docs/guides/agents.mdx).
Agents editing a model through the App should read the [Markdown entry](../../docs/agents.md).
To develop Code3D itself, use the [development guide](../../.agents/docs/development.md)
and [architecture overview](../../.agents/docs/architecture/overview.md).

## Run locally

From the repository root:

```sh
npm install
npm run dev
```

The main checkout serves the App at `http://localhost:3133/`. Development
worktrees reserve another port through the project's
[worktree workflow](../../.agents/skills/worktree-development/SKILL.md) and pass it
explicitly to Vite. Each checkout has its own dependencies and cache.

The App can use Browser storage or a user-authorized local directory. Its file
service owns full-source writes, version checks, and persistence for both user
and agent edits. Model preparation resolves project dependencies before compiling
source. The [file guide](../web/src/content/docs/docs/getting-started/files.md)
explains the storage and package rules.

In Vite development, `latest` requests for publishable `@code3d/*` packages use
this checkout's package builds. Rebuild packages after changing their source.
Explicit versions keep normal resolution; production uses published packages.
See [package environment and resolution](../../.agents/docs/architecture/runtime.md#包环境与模块解析)
for the shared Browser storage and local-folder rules.

Each opened source file has its own cached build. The App can show its last
successful cached preview while checking current files in the background.
Compilation and model execution use separate Workers, so terminating a stuck
model preserves compiler state. Use **Refresh files and dependencies** in the
explorer to pick up manual edits inside an unchanged installed package.
Right-click empty space in the explorer and choose **Clear build cache** to
discard this workspace's in-memory and saved builds and rebuild the active file.
Geometry, downloaded resources, and other workspaces' build caches are retained.
Cancelling also interrupts a cache read waiting for another tab to release storage.
A later build may still need to wait for that tab if it needs disk records.
Cache writes run in the background and continue after a model is cancelled or
its execution Worker is replaced. Closing a project drains queued writes;
reloading or closing the whole page can lose cache entries that have not reached
storage yet. This does not change how project source files are saved.

Performance preferences are available from **Settings** in the top bar.
They are saved for this browser and shared across projects and tabs; see the
[settings guide](../web/src/content/docs/docs/getting-started/app.md#performance-settings).

## Source map

Read [project and runtime](../../.agents/docs/architecture/runtime.md),
[source and interaction tools](../../.agents/docs/architecture/tooling.md), or
[sketch architecture](../../.agents/docs/architecture/sketch.md) for the relevant
contracts before following the implementation links below.

| Responsibility                                        | Start here                                                              |
| ----------------------------------------------------- | ----------------------------------------------------------------------- |
| Application composition                               | [main.ts](src/main.ts)                                                  |
| Editor and source selection                           | [editor.ts](src/editor.ts), [source edits](src/source-edit-diff.ts)     |
| Project files and package installation                | [Project services](src/project/)                                        |
| Compilation, execution and observations               | [Model runtime](src/model/)                                             |
| 3D rendering and viewport interaction                 | [viewport.ts](src/viewport.ts), [rendering](src/rendering/)             |
| Sketch and source editing tools                       | [Tools](src/tools/)                                                     |
| Agent grants, requests, cursors, following and images | [Agent integration](src/agent/)                                         |
| App prompts and modal lifecycle                       | [Dialog API](src/ui/dialog.ts)                                          |
| App performance preferences                           | [State](src/app-settings.ts), [settings dialog](src/ui/app-settings.ts) |
| UI components                                         | [UI](src/ui/)                                                           |
| Executable models and website samples                 | [Examples](examples/), [sample catalog](render-samples/catalog.ts)      |

Public model authoring belongs to [Core](../core/README.md). Shared connection,
encryption, and request receipts belong to [Agent](../agent/README.md); the local
Node process belongs to [CLI](../cli/README.md). App owns operation validation and
execution against its current project. Its [Agent connections](src/agent/connections.ts)
own grants, connection lifetimes and reactive presence/follow state; native UI
components consume that state through MobX and dispose their own subscriptions.

## Verify and build

```sh
npm run build:packages
npm test --workspace @code3d/app
npm run build --workspace @code3d/app
```

[Browser tests](test/browser/) cover real editor, storage, agent CLI and viewport
interactions; [unit tests](test/) cover independent project and model logic.
Follow the shared [test conventions and Chrome setup](../../.agents/docs/development.md#测试与格式)
and choose checks appropriate to the changed behavior.

Build App before [the website](../web/README.md), which copies `dist/` into its
combined static output. To test copied agent prompts locally, set
`VITE_CODE3D_DOCS_URL` in ignored `.env.development.local` to the running website's
`/docs/` URL. Both the HTML introduction and linked Markdown instructions must be
served when checking the connection flow.

## Runnable examples

The [shared catalog](render-samples/catalog.ts) registers the sources under
[examples](examples/), grouped by modeling topic. The App, website and docs use
these files directly. Start with [the desktop stand](examples/projects/phone-stand.ts)
or [the practical model guide](../web/src/content/docs/docs/guides/practical-models.mdx).
The default browser project imports the canonical stand function and needs no install.
Basic examples are named for their teaching goal; project parts are imported, not copied.
The text example uses Google Fonts; local fonts appear only as a commented alternative.

Every example has native geometry tests and an App open/edit/Undo test. Run
`npm run test:run --workspace @code3d/app` for native tests,
`npm run test:examples:packages --workspace @code3d/app` for clean npm consumers,
and `CODE3D_TEST_URL=http://127.0.0.1:<reserved-port>/ npm run test:examples:browser
--workspace @code3d/app` against the task server and host Chrome. The independent CI
workflow runs every example asynchronously; website and npm publication workflows
build and publish without waiting for that test run.
