---
title: Working with files
description: Create and switch browser projects or connect the App to a local project folder.
---

## Browser workspace

The App starts with **Default project** in browser storage, with a default model
and bundled examples ready to try. Existing browser files remain in that project.
Each browser project has its own files, installed
packages, build cache and agent connections. You can create multiple TypeScript
and JSON files and import between them using ordinary relative imports:

```ts
import {makeBracket} from './bracket.ts';
```

Every source file can be opened and previewed. Export a value or function when
another module needs it; exporting is not required just to inspect a local
model.

Browser data belongs to that browser profile and site origin. Clearing site
data removes all browser projects. Keep copies of work you care about.

## Create, switch and delete browser projects

Click the project name in the explorer header to open the location menu. The
**Browser projects** list highlights the current project. Click a project name to
switch to it. Each project's arrow opens a submenu starting with **Open**,
followed by its copy, reset and delete actions, including projects that are not open.
**Open** saves and switches just like clicking the project name.
You can also hover over a project row or
focus its name and press **Right arrow** to open these actions.
**Open folder** and **New browser project** appear below the list, in that order
and separated from it by a divider. **Open folder** keeps the same name in a local project.
Use the toolbar's **Refresh files and dependencies** to reread files and dependencies
and rebuild the current model.
Choose **New browser project** and enter a name. The same form has a **Create examples**
checkbox, selected by default: leave it checked to include the default model and
bundled `/examples` folder, or clear it to start with an empty project. Choose
**Create project** to open the new project without another prompt.
You can add examples later with **Create examples** in the explorer's context menu.
A new project does not copy the current project's files.

Choose another project from the list in the same menu to open it. The App
saves the current project before reloading into the selected project. If saving fails, it stays in
the current project and shows the error. Each project keeps its own workspace
URL, so separate tabs can open different projects. Switching clears the previous
file selection.

To remove a browser project, open its arrow, then choose
**Delete**. Check the project name in the confirmation, then choose **Delete project**.
Deletion permanently removes that project's files, installed packages, build cache
and agent connection settings. Deleting the current project also discards its
unsaved edits and opens another browser project. Deleting another project keeps
the current page and unsaved edits in place. Deleting the last browser project
creates a fresh, empty **Default project**. If another tab has the target project
open, deletion waits and asks you to close that tab. Other projects and App
settings are preserved.

## Prompts and confirmations

Create files and folders directly in the project tree using the toolbar or
context menu. The new file name is selected without its extension. Press
**Enter** to create it, or **Escape** to cancel without writing anything. A name
such as `src/utils/model.ts` creates missing parent folders too. Invalid names
remain editable, with an explanation below the tree.

Files with errors have red names in the tree and open tabs; files with only
warnings use yellow. The badge shows the total number of errors and warnings,
with separate counts in its tooltip. Parent folders show a red or yellow dot
for diagnostics below them, with errors taking priority. These include editor
and runtime diagnostics with a known source file; hints and information do not
add to the badge.

Agent activity dots remain separate, to the right of diagnostics and cut markers.
They keep each agent's color; up to three dots are shown, followed by `+N` for
additional agents. The tooltip lists every agent. Folders collect activity from
their descendants whether collapsed or expanded. Expanded folders and their
files both keep their activity dots.
Clearing diagnostics leaves agent activity visible.

While dependencies are loading, syntax errors remain visible; dependency-based
type checks appear once the language environment is ready. Temporary missing-module
errors from incomplete loading are not shown. Package loading failures still
appear in the package or model status.

Package installation, deletion, and example resets use dialogs inside the App. Input errors appear below the field so you can correct the name
without losing your text. Choose **Cancel**, press **Escape**, or click outside
the dialog to dismiss it. Deletion and example replacement require explicit
confirmation; **Cancel** receives the initial focus.

Folder selection and access permissions use your browser's system dialogs.

## Install packages in browser storage

Right-click a folder or `package.json` in the file explorer and choose
**Install package**. Enter a browser-compatible npm package name, optionally
with a version or range, such as `@ctrl/tinycolor@4.2.0` or `@scope/package@^2`.
A name without a version uses `latest`; the lock records the resolved version.

If the selected folder has no `package.json`, Code3D creates one in that folder
with the requested package and `"@code3d/core": "latest"`.
An existing manifest keeps its other settings and dependencies; installing a
package updates its existing dependency field or adds it to `dependencies`.
Ordinary folders create their own scope even when a parent has a manifest.
Inside `node_modules`, the command searches upward for the owning project
manifest outside the installed dependencies, leaving package contents read-only.
The dialog shows the target directory before installation. Right-click empty
space in the explorer to install in the workspace root.

Right-click a project's `package.json` and choose **Update dependencies** to
resolve its dependency graph again without using the existing lock. The command
keeps the manifest's version constraints: `latest` follows that npm tag, ranges
select compatible versions, and exact versions stay pinned. It updates that
folder's dependencies and lock without changing other subprojects. Verified
archive downloads can be reused. If the update fails, the previous installation
and lock remain available. This action is not shown for read-only manifests
inside `node_modules`.

Models without a manifest continue using the App's built-in modeling packages,
with no installation required. Opening a model with a manifest also installs
changed dependencies or restores its existing lock before compilation.
Package metadata is prefetched concurrently and shared across dependencies during
each resolution. Locked packages keep their selected versions; **Update dependencies**
checks the registry again using the ranges in your manifest.

Installation continues in the background while you switch files, edit and save.
After installation, open package files and locks refresh automatically. Tabs for
removed package versions close; your editable files and other folders stay intact.
Up to 15 packages download concurrently per installation; unpacking runs one
package at a time alongside downloads. Verified cached archives are reused.
Requests for the same folder run in order. A failed request does not discard
an update queued for a corrected manifest.
An interrupted installation is recovered before the next attempt. Once packages
and their lock are replaced successfully, retrying backup cleanup does not
repeat the installation.
The **Packages** area at the bottom of the file explorer shows downloads,
installation progress, errors with **Retry**, and package version issues.
Success messages disappear after three seconds, including when you have switched
to another file. Ongoing downloads and errors remain visible; each folder's
status clears independently.
Only a model needing unfinished dependencies waits for them. Source edits reuse
prepared dependencies. Changing the manifest or lock, or removing an installation,
causes it to be checked again.
Deleting `code3d-lock.json` makes the next model run resolve dependencies again,
so `latest` or version ranges can select newer versions. Existing archive cache
entries are reused when their integrity matches; installation still unpacks the
resolved packages and writes a new lock. Opening a manifest, text file or already
installed package source alone does not trigger installation.
If a model is active when you delete its lock in the explorer, the resulting
preview update can start that resolution immediately.
Package failures appear in that status area with the requested package name.
Correct or remove the dependency in `package.json` and reopen your model to
retry; successful preparation clears the earlier error.

Ordinary model edits reuse loaded types and the modeling engine. **Preparing
project** appears when opening a project for the first time, loading new
dependencies, or refreshing changed packages, configuration or external files.
Changing a dimension or expression does not repeat that preparation.

Try `/examples/npm/model.ts` in the App's file explorer. This
bundled example has its own `package.json` and uses `@ctrl/tinycolor` from npm to
lighten a box's material color. Use F12 on `TinyColor` to inspect its declarations.
If you skipped examples when creating the project, choose **Create examples** in
the explorer's context menu first. The example uses the current project's files.
In a local project, run `npm install` inside `examples/npm`,
then choose **Refresh files and dependencies** in the toolbar before running this example.

```json
{
  "private": true,
  "type": "module",
  "dependencies": {
    "d3-delaunay": "6.0.4",
    "@types/d3-delaunay": "6.0.4"
  }
}
```

For example, this model uses the installed algorithm package:

```ts
import {box} from '@code3d/core';
import {Delaunay} from 'd3-delaunay';

const mesh = Delaunay.from([
  [0, 0],
  [20, 0],
  [0, 20],
]);
export default box(mesh.points.length, 10, 5);
```

`code3d-lock.json` and `node_modules` sit beside the manifest. The lock records
exact package versions and archive integrity; it is a Code3D file, not an npm
`package-lock.json`. Reopening or running an unchanged project keeps the locked
versions. Cached, verified archives can restore a missing installation without
resolving versions again. A failed download or installation preserves the
previous installation and lock.

Packages are linked from `node_modules/<package>` to a version-specific directory
such as `node_modules/.code3d/@ctrl+tinycolor@4.2.0/node_modules/@ctrl/tinycolor`.
Scoped packages use readable names such as `@scope+name@1.0.0` in this store.
The explorer and editor show filesystem names; URL escaping such as `%40` for
`@` is only used when representing a path in a URL.

Copying a project directory in the explorer preserves its `package.json` and
lock, and skips `node_modules`, `.code3d` and `.git` directories. Opening the
copied model restores its locked packages. Moving a directory keeps all its
contents, including installed packages.

A subdirectory can have its own `package.json` and lock. For example,
`/examples/panel/package.json` controls `/examples/panel/model.ts`; another
example can install a different version of the same library. Scopes install
when reached. Ordinary ancestor `node_modules` lookup still applies. Browser
installs support npm versions, ranges and aliases, with dependencies and root
dev dependencies. npm workspaces, dependency overrides, local/Git dependencies,
private registry authentication and install scripts are not supported.

The editor, model compiler and assets read the same installed package files.
Use **Go to Definition** (F12 or Ctrl/Cmd+Click) to open package declarations.
When several definitions appear in Peek, double-click a result to open its
file in a tab. Package file links can also be reopened or refreshed directly.
Packages that publish declaration maps and their original TypeScript sources
can take you directly to those sources. Installed files and generated locks
open read-only; they are not executable model files. JSON files remain editable
project files and do not run as models.

Opening a package's original source for reference does not add it to your
project's type checking or error counts. Hover and further definition navigation
remain available. Imported declarations still provide types; the App skips
checking declaration-file internals by default. If your code directly imports
an implementation source file, that file becomes a dependency and is checked
normally. Actual errors remain visible even in read-only files.

Model errors appear in the editor when a source location is available. Hover
**Model error** to read the error, or click it to jump to that location.
Runtime initialization errors link to the relevant Core import when available.
Errors without a source location remain in the status details. File operation
errors appear in the project explorer; errors do not open a global floating bar.

## Reset browser storage

Open the location menu in the explorer header, open the arrow beside the browser
project you want to reset, then choose **Reset**. Check the project name
in the confirmation. After confirmation, the App removes that project's files and
installed dependencies, and restores the default model and bundled examples
without asking again whether to create examples.
Resetting the current project reloads the page and discards its unsaved edits.
Resetting another project keeps the current page and unsaved edits in place.
Copy any files you want to keep to a local folder first; the reset cannot be undone.

Other browser projects, local folders and App settings are preserved. The target
project's build cache is cleared; shared geometry and download caches are retained. If another tab
still has the browser project open, the reset waits and asks you to close that
tab. Browser project actions are also available while working in a local folder.

## Local folder

To copy a browser project to disk, open the location menu in the explorer header,
open that project's arrow, and choose **Copy to local folder and open**, then select
an empty folder. You do not need to open the browser project first.
The App saves your current project before copying. When copying a project that
is not open in this tab, close other tabs using that project when prompted so the
copy can proceed.
The App copies project files, binary resources, configuration, empty directories,
and examples. It excludes `node_modules`, `.code3d` internal data, and
`code3d-lock.json` at every level. Install dependencies locally as needed.
After copying succeeds, the App opens the local project. When copying the current
project, it keeps the current file selected if that file was copied. The original
browser project remains available. Cancellation, failure or edits made during
copying keep the current project open; a failed copy may leave partial files in the target.

Click the project name in the explorer header and choose **Open folder** to connect
the App to a real directory. To switch local projects, click the current folder name
and choose **Open folder**.
The selected directory keeps its own files. When opening an empty directory,
the App shows a **Create examples** prompt.
Accept to add the bundled `/examples` folder, or cancel to keep the directory empty.
The choice is remembered for that project, so reloading does not ask again.
You can add examples later through the explorer's context menu.
Nonempty directories open without this prompt and do not receive examples automatically.
The **Open folder** command never copies files from the previous project or browser storage.
Only the App's own `.code3d` metadata is ignored when checking whether a directory is empty.
Create your own files in the explorer.

Opening a folder reads only workspace metadata and the initial file. Imports,
assets, type definitions, and other files load when needed; independent filesystem
requests run in parallel. The App restores the file in the URL, or opens a root
`model.ts`, `index.ts`, or another root source file. If there is no root source,
select a file from the explorer. Unopened directories are listed when expanded,
and filename search discovers additional directory names on demand.

Edits in the App write directly to that directory. When available, browser file
change events synchronize opened files and source dependencies. Otherwise, the
App checks modification times and sizes while the page is visible. Checks run
at least 5 seconds apart, waiting 50 times the scan duration when that is longer,
and immediately when you return to the page. Changed source files update the
editor and rebuild the model; deleted files close their tabs. Unsaved edits are
kept. **Refresh files and dependencies** forces those source files to be reread
even if their timestamps and sizes are unchanged. It also discards cached file
reads and rebuilds from the current entry, rereading the source, configuration,
dependencies, and local resources required by that entry, as when reopening
the page. It refreshes the directory listing too. Unused files load when needed; refresh does not read
the entire directory into memory.

Each connected directory gets its own workspace URL. Click the storage location
in the explorer header to choose **Open folder**, **Reconnect folder** when the
browser requires fresh permission, or select a project name from the list
to return to that browser project. These workspace switches clear the previous file selection.

Local folders require a browser with File System Access support and a secure
context. Browser storage remains available when folder access is unsupported.

## Modeling packages

You can start without installing packages. When the model’s package scope and its ancestors do
not declare `@code3d/core` (or there is no `package.json`), the App provides
built-in `@code3d/core`, `@code3d/layout`, `@code3d/screws`, `@code3d/gears` and `@code3d/materials`, with matching
editor types.
The built-in modeling packages remain available without declaring them.
Declaring your own modeling runtime requires those packages to be available in
the npm registry (browser storage) or already installed (local folders).

Declaring `@code3d/core` in `dependencies`, `devDependencies`, `peerDependencies`
or `optionalDependencies` switches the complete modeling runtime to your
project's installed packages. Install `@code3d/layout`, `@code3d/screws`, `@code3d/gears` or
`@code3d/materials` too if your model imports them. Missing declared packages produce an error; the App does not silently use
its built-in copies. Choose **Refresh files and dependencies** in the toolbar
after external dependency changes.

Other browser-compatible npm packages resolve from the project's `node_modules`
in either case. Running the same source directly in Node requires installing
the project dependencies; Node does not have the App's built-in package view.

For example, install a browser-compatible utility in your own project directory:

```bash
npm install @ctrl/tinycolor
```

Open that folder in the App (or choose **Refresh files and dependencies** in the toolbar if it is already open),
then use the package in a TypeScript file:

```ts
import {box} from '@code3d/core';
import {TinyColor} from '@ctrl/tinycolor';

const color = new TinyColor('#2898d5').lighten(15).toHexString();
export default box(24, 16, 12).fillet(2).material(color);
```

The App reads installed package code and declarations for execution and editor
types. Local folders use your own package manager; the App does not run `npm install`
in a local folder. A package working in Node alone
does not make it browser-compatible; Node built-ins and native addons are not
available. Use ordinary npm installations; pnpm and workspace symbolic-link
layouts have not been validated for browser directory handles.

Dynamic `import()` specifiers must be string literals, such as
`await import('./bracket.ts')`. For project assets, use
`new URL('./dimensions.json', import.meta.url)`. Unsupported imports produce a
source diagnostic.

Source edits reuse the current project's modeling kernel and dependency caches.
Each distinct compiled source version remains in the browser's module cache
until its execution Worker ends. Reloading or closing the project releases that
Worker; ordinary edits preserve its expensive geometry caches. Persistent build
outputs can be reused by the next Worker.

## Cached previews

Each source file you open has its own cached build, including files without a
renderable model. When you return to a file or reload the App, its last successful
cached preview can appear while current files are checked in the background.
Files using the same dependency environment share the cached package build.
The modeling engine still needs to initialize and execute the restored code.

A current error does not discard an existing successful preview. The error is
shown for the current source; editing tools and export wait for a matching
current result. Cancelling a stuck model preserves the compiler's reusable work.
Cancelling also interrupts a cache read waiting for another tab to release storage.
A later build may still need to wait for that tab if it needs disk records.
Completed cache records are saved in the background, including after a model is
cancelled, so older builds can be reused when you undo edits. Closing a project
finishes its queued cache writes. Reloading or closing the entire page can lose
cache entries that have not been saved yet; project source files use their own
save process. Cache entries may be evicted to stay within the storage budget,
and clearing site data removes them.

Package upgrades and development workspace rebuilds invalidate affected builds.
If you manually change files inside an installed npm package without changing
its version, click **Refresh files and dependencies** in the explorer header.
This refreshes the build inputs; use **Update dependencies** on `package.json`
to ask the package manager to resolve package versions again.

To rebuild from scratch, right-click empty space in the explorer (the workspace
root) and choose **Clear build cache**. This clears the current workspace's saved
source and dependency builds, resets the compiler, and rebuilds the active file.
Your files, installed packages, geometry cache, and downloaded fonts are kept.
Build caches belonging to other workspaces are also kept.

Google Fonts are cached with all their character subsets after a successful
download. Edits, project refreshes and page reloads can reuse the same fonts
without requesting Google CSS, while those caches remain available.
Models await `googleFont(...)` or `font(...)` when they need a font. Fonts load
while running the model, including the first execution of a saved module.
Compiling and saving a module does not download its fonts. First use and fonts
removed by cache eviction require network access.

## After a Code3D update

During the prototype, projects with their own Code3D modeling packages must use
the versions required by the current App. Before running a model, the App checks
the selected installed packages. The **Packages** area at the bottom of the file
explorer shows **Code3D version mismatch**, with **Update Code3D packages** for
Browser storage or **Refresh** for a local folder. Expand **Details** to see each
affected package's **Installed** and **Required** versions, open its `package.json`,
and read the update instructions. **Details** also provides **Refresh** for
Browser storage, **Reload app**, and **Clear build cache**. This status shares
the explorer's package progress and error area, leaving the model view clear.
If your packages are newer than the open App, try **Details → Reload app** first.

For **Browser storage**, choose **Update Code3D packages** in the Packages area.
Existing `latest` declarations stay `latest`, including aliases such as
`npm:@code3d/core@latest`; the command resolves them again instead of reusing
the old lock. Fixed older Code3D declarations change to the App's required
versions. It installs the newly resolved dependencies and rebuilds the model.
Existing dependency sections, other dependency declarations and your source files are preserved.
The ordinary **Update dependencies** command still follows your existing ranges,
so it cannot upgrade a dependency pinned to an older version.

For a **local folder**, expand **Details**, use **Open package.json**, and work
in that manifest's directory:

- Keep `latest` declarations and use your package manager's update command to
  resolve them again. With npm, for example, run `npm update --save=false @code3d/core`;
  use the dependency's alias name if it has one. Merely running `npm install`
  can reuse the older version recorded in the lock.
- For a fixed older version, change the declaration to the required version,
  then run your package manager's install command, such as `npm install`.

Return to the App and choose **Refresh** after installation. The App does not
run a package manager on your computer. For a nested project, follow the path
shown in **Details** rather than editing an unrelated root manifest.

If resolving `latest` installs packages newer than this App, keep `latest` and
try **Details → Reload app**. If the versions still do not match, the status
remains; the App does not pin `latest` to an older version to hide it.

If another library brings in an incompatible Code3D package, **Details** names
that library. Upgrade it, or the project dependency that brings it in, to a
release using the required Code3D version; changing
only a top-level Code3D dependency may leave the library's nested copy unchanged.
For an imported package missing from your dependency declarations, add the
required version to the indicated manifest. These cases show manual guidance
instead of an automatic update button.

Projects using the App's built-in modeling packages already use matching
versions. In development, `latest` still uses this checkout's package builds.

Builds are automatically invalidated when the App or package inputs change.
If problems remain after the versions match, use **Clear build cache** from the
explorer's empty-space menu, or from the version status's **Details** section.
This rebuilds the active model while keeping source files, installed packages,
geometry caches and other projects. Clearing the cache does **not** fix an
installed package version mismatch, and you do not need to reset the project.

## The examples directory

The bundled `/examples` folder is managed by Code3D. Right-click that folder and choose
**Reset examples** to restore it. A new bundled revision refreshes managed examples
automatically without another creation prompt; existing user-owned examples are
left alone unless explicitly reset.
If there is no `/examples` folder, right-click the empty space in the explorer and choose
**Create examples** to add it later. Keep your own work
in `/model.ts` or another directory outside `/examples`.

## Run Code3D locally

Use Node.js 24 and npm:

```bash
git clone https://github.com/vilicvane/code3d.git
cd code3d
npm install
npm run dev
```

Open the local URL shown in the terminal. The repository builds the modeling
packages before starting the App.

The App is a browser runtime, not a general Node.js environment.
See [current limitations](limitations.md).
