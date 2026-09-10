# @code3d/app

Code3D's browser modeling workspace: a TypeScript editor, project file explorer,
3D and sketch views, visual editing tools, and local agent collaboration. This
private package builds the App served at the website's `/app/` path.

For using the product, start with [working in the App](../web/src/content/docs/docs/getting-started/app.md)
or [collaborating with agents](../web/src/content/docs/docs/guides/agents.md).
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

## Source map

Read [project and runtime](../../.agents/docs/architecture/runtime.md),
[source and interaction tools](../../.agents/docs/architecture/tooling.md), or
[sketch architecture](../../.agents/docs/architecture/sketch.md) for the relevant
contracts before following the implementation links below.

| Responsibility                                        | Start here                                                          |
| ----------------------------------------------------- | ------------------------------------------------------------------- |
| Application composition                               | [main.ts](src/main.ts)                                              |
| Editor and source selection                           | [editor.ts](src/editor.ts), [source edits](src/source-edit-diff.ts) |
| Project files and package installation                | [Project services](src/project/)                                    |
| Compilation, execution and observations               | [Model runtime](src/model/)                                         |
| 3D rendering and viewport interaction                 | [viewport.ts](src/viewport.ts), [rendering](src/rendering/)         |
| Sketch and source editing tools                       | [Tools](src/tools/)                                                 |
| Agent grants, requests, cursors, following and images | [Agent integration](src/agent/)                                     |
| UI components                                         | [UI](src/ui/)                                                       |
| Executable models and website samples                 | [Examples](examples/), [sample catalog](render-samples/catalog.ts)  |

Public model authoring belongs to [Core](../core/README.md). Shared connection,
encryption, and request receipts belong to [Agent](../agent/README.md); the local
Node process belongs to [CLI](../cli/README.md). App owns operation validation and
execution against its current project.

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
