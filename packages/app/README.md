# @code3d/app

Code3D's browser modeling workspace: a TypeScript editor, project file explorer,
3D and sketch views, visual editing tools, and local agent collaboration. This
private package builds the App served at the website's `/app/` path.

For using the product, start with [working in the App](../web/src/content/docs/docs/getting-started/app.md)
or [collaborating with agents](../web/src/content/docs/docs/guides/agents.mdx).
Agents editing a model through the App should read the [Markdown entry](../../docs/agents.md).
To develop Code3D itself, use the [development guide](../../.agents/docs/development.md)
and [architecture overview](../../.agents/docs/architecture/overview.md).

Models can declare `input('Width', 40, {min: 4, max: 100, step: 1})` to expose
numeric fields and sliders in **Inputs**. Select an input call in the editor to
expand the panel and highlight its field; Tab focuses and selects the value.
Valid numbers update the model as you type, and sliders preview throughout the
drag. Reset restores source defaults; values are local to the current file session.
Try the [inputs example](examples/inputs.ts).
The [robot arm](examples/assemblies/robot-arm.ts) uses five live sliders for base
yaw, shoulder, elbow, wrist and gripper opening; nested groups carry downstream
parts around each joint. Bored links sit in alternating layers, with clearance
around the hinge pins and shoulder support.

Models can read `timeOffset()` to animate an assembly. Play, Pause and Reset
controls appear below the viewport; see [animation playback](../web/src/content/docs/docs/getting-started/app.md#play-an-assembly-animation)
and the [rotating arm example](examples/constraints/animation.ts).

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

The App can use named browser projects or a user-authorized local directory.
The explorer's location menu creates, switches and deletes browser projects;
each keeps its own files, installed packages, build cache and agent identity.
The **New browser project** form combines the project name with a **Create examples**
checkbox, selected by default. Creating with it selected adds bundled examples and
the default model; clearing it starts an empty project. Empty local folders ask
whether to add examples when first opened. You can add them later with **Create examples**
in the explorer's context menu. The first default browser project includes both automatically.
The location menu lists projects under **Browser projects** and highlights the
current project. Click a project name to switch to it, or open its arrow for
**Open**, **Copy to local folder and open**, **Reset** and **Delete**.
**Open** saves and switches just like clicking the project name.
Every project has these actions, including projects that are not open. Resetting
or deleting another project keeps the current page and unsaved edits in place.
Copying saves the current project and opens the local folder only after the copy
succeeds. Background operations wait for other tabs using the target project to close.
**Open folder** and **New browser project** appear below the project list,
in that order and separated from it by a divider. **Open folder** keeps the same
name when a local project is open. Use the toolbar's **Refresh files and dependencies**
to reread the project and rebuild the current model.
The App's file service owns full-source writes, version checks, and persistence for both user
and agent edits. Model preparation resolves project dependencies before compiling
source. The [file guide](../web/src/content/docs/docs/getting-started/files.md)
explains the storage and package rules.

In Vite development, `latest` requests for publishable `@code3d/*` packages use
this checkout's package builds. Rebuild packages after changing their source.
Explicit versions keep normal resolution; production uses published packages.
See [package environment and resolution](../../.agents/docs/architecture/runtime.md#包环境与模块解析)
for the shared Browser storage and local-folder rules.

After an App update, projects with their own Code3D packages may use different
modeling package versions from the App. The **Packages** area at the
bottom of the file explorer brings together download and installation progress,
installation errors with **Retry**, and version recovery. A **Code3D version
mismatch** warning offers **Update Code3D packages** for Browser storage or
**Refresh** for local folders. Builds, rendering and cache restoration continue;
actual compilation or execution failures are still reported normally. The editor
also shows warnings at related imports or source locations. Expand **Details**
for installed and App versions, package files and recovery instructions. Success notices disappear
independently after three seconds.
For Browser storage, **Update Code3D packages** preserves `latest` declarations,
including npm aliases, and resolves them again. Fixed older declarations change
to the App versions before installation. Local folders show the owning
package files and an npm command: keep `latest`, change outdated fixed versions
or ranges first, then run `npm update` in each manifest's directory
and choose **Refresh**. By default, this updates dependencies and their lock
while preserving `package.json` declarations; other package managers use their own update
command. Built-in packages need no manual upgrade. If `latest` installs packages newer than the App,
reload the App to check for a newer release; an unresolved mismatch stays visible
without pinning `latest` to an older version.
Clearing the build cache does not upgrade installed packages; see the
[upgrade guide](../web/src/content/docs/docs/getting-started/files.md#after-a-code3d-update).

Open **Settings → Cache** to set the **Disk cache threshold (ms)**, which defaults
to 1 ms. It accepts fractional values; 0 removes the computation-time threshold.
Changes apply to new computations from the next model execution, preserving
existing caches. Faster results still use memory; downloads and compiled build
artifacts keep their own cache policies.

Each opened source file has its own cached build. The App can show its last
successful cached preview while checking current files in the background.
Compilation and model execution use separate Workers, so terminating a stuck
model preserves compiler state. Use **Refresh files and dependencies** in the
explorer to pick up manual edits inside an unchanged installed package.
Right-click empty space in the explorer and choose **Clear build cache** to
discard this workspace's in-memory and saved builds and rebuild the active file.
Geometry, downloaded resources, and other workspaces' build caches are retained.
Google Font selections are saved with their complete CSS and decoded subsets,
so ordinary builds and page reloads reuse them without a CSS request, even after
HTTP expiry. Models use `await googleFont(...)` or `await font(...)`: fonts load
at runtime, including when a saved module first executes. Compilation does not
fetch fonts. First use and evicted caches still require network access.
Cancelling also interrupts a cache read waiting for another tab to release storage.
A later build may still need to wait for that tab if it needs disk records.
Cache writes run in the background and continue after a model is cancelled or
its execution Worker is replaced. Closing a project drains queued writes;
reloading or closing the whole page can lose cache entries that have not reached
storage yet. This does not change how project source files are saved.

Performance preferences are available from **Settings** in the top bar.
They are saved for this browser and shared across projects and tabs; see the
[settings guide](../web/src/content/docs/docs/getting-started/app.md#performance-settings).

The viewport's **Render** mode includes an upper-right **Render scene** menu for Studio,
Side light, and Soft light. All three keep the same dark background; their lighting
and reflections also apply to viewport PNG exports. Modeling retains its original
scene; the render choice is saved in this browser and restored after reloading. See the
[App guide](../web/src/content/docs/docs/getting-started/app.md#move-through-a-model).
Render also uses shadows and ambient occlusion to distinguish surface turns,
recesses, and contact areas without adding outlines or changing model materials.

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
| Browser project names and lifecycle                   | [Browser projects](src/project/browser-projects.ts)                     |
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
`test:browser` runs the bounded-parallel regular lane,
`test:browser:exclusive` runs timing-, input-focus-, storage- and resource-sensitive files
serially, `test:browser:isolated` owns a separate browser for OPFS identity and
agent directory workflow cases,
and `test:browser:full` adds that lane and the separately managed example suite.
Every run records per-file timings under the ignored App `.cache` directory.
CI assigns example shards by measured runtime, including the standalone checks
on the final shard.

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
--workspace @code3d/app` against the task server and existing host Chrome.
Local tests only close their own browser connections and contexts; CI owns one
headless browser for the command. The independent CI
workflow runs every example asynchronously; website and npm publication workflows
build and publish without waiting for that test run.

Browser example tests and image rendering consume the current packed public
packages. Run `npm run build:packages` and `npm run pack:packages` from the
repository root first. Their temporary manifests and locks preserve real npm
installation and integrity checks without requiring publication; see the
[development and validation guide](../../.agents/docs/development.md#测试与格式).
