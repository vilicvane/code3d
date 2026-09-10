---
title: Working with files
description: Use browser storage or connect the App to a local project folder.
---

## Browser workspace

The default workspace is stored in your browser. You can create multiple
TypeScript and JSON files and import between them using ordinary relative imports:

```ts
import {makeBracket} from './bracket.ts';
```

Every source file can be opened and previewed. Export a value or function when
another module needs it; exporting is not required just to inspect a local
model.

Browser data belongs to that browser profile and site origin. Clearing site
data removes the browser workspace. Keep copies of work you care about.

## Install packages in browser storage

Right-click a folder or `package.json` in the file explorer and choose
**Install package**. Enter a browser-compatible npm package name, optionally
with a version or range, such as `just-range@4.2.0` or `@scope/package@^2`.
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
Installation continues in the background while you switch files, edit and save.
Up to 15 packages download concurrently per installation; unpacking runs one
package at a time alongside downloads. Verified cached archives are reused.
An interrupted installation is recovered before the next attempt. Once packages
and their lock are replaced successfully, retrying backup cleanup does not
repeat the installation.
The file explorer shows package progress separately from the model preview.
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

Try `/examples/patterns/post-array/model.ts` in the App's file explorer. This
bundled example has its own `package.json` and uses `just-range` from npm to
place a row of posts. Select the `postArray()` call to edit the count, spacing
and height in the parameter panel. The example is included in every browser
workspace; it does not depend on files from another browser profile.

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
such as `node_modules/.code3d/just-range@4.2.0/node_modules/just-range`.
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

## Local folder

Choose **Open folder** to connect the App to a real directory. An empty
directory receives the current workspace, including unopened files and binary
assets. An existing directory keeps its files and gains Code3D's managed examples.

Opening a folder reads only workspace metadata and the initial file. Imports,
assets, type definitions, and other files load when needed; independent filesystem
requests run in parallel. The App restores the file in the URL, or opens a root
`model.ts`, `index.ts`, or another root source file. If there is no root source,
select a file from the explorer. Unopened directories are listed when expanded,
and filename search discovers additional directory names on demand.

Edits in the App write directly to that directory. If you change a file in
another editor, choose **Reload folder** to read the changes. Automatic
external-file watching is not currently available.

Each connected directory gets its own workspace URL. Use **Reconnect folder**
when the browser requires fresh permission, or **Use browser storage** to
return the current tab to browser persistence.

Local folders require a browser with File System Access support and a secure
context. Browser storage remains available when folder access is unsupported.

## Modeling packages

You can start without installing packages. When the model’s package scope and its ancestors do
not declare `@code3d/core` (or there is no `package.json`), the App provides
built-in `@code3d/core`, `@code3d/screws` and `@code3d/materials`, with matching
editor types.
The built-in modeling packages remain available without declaring them.
Declaring your own modeling runtime requires those packages to be available in
the npm registry (browser storage) or already installed (local folders).

Declaring `@code3d/core` in `dependencies`, `devDependencies`, `peerDependencies`
or `optionalDependencies` switches the complete modeling runtime to your
project's installed packages. Install `@code3d/screws` or
`@code3d/materials` too if your model imports them. Missing declared packages produce an error; the App does not silently use
its built-in copies. Choose **Reload folder** after external dependency changes.

Other browser-compatible npm packages resolve from the project's `node_modules`
in either case. Running the same source directly in Node requires installing
the project dependencies; Node does not have the App's built-in package view.

For example, install a browser-compatible utility in your own project directory:

```bash
npm install just-range
```

Open that folder in the App (or choose **Reload folder** if it is already open),
then use the package in a TypeScript file:

```ts
import range from 'just-range';
import {box, group} from '@code3d/core';

const baseHeight = 4;
const postHeight = 10;
const base = box(50, baseHeight, 16).originOffset(0, baseHeight / 2, 0);
const posts = range(3).map(index =>
  box(6, postHeight, 6).originOffset((1 - index) * 16, -postHeight / 2, 0),
);

group([base, ...posts]);
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
until its project Worker ends. Reloading or closing the project releases that
Worker; ordinary edits preserve its expensive geometry caches.

## The examples directory

`/examples` is managed by Code3D. **Reset examples** restores it, and a
new bundled example revision refreshes it automatically. Keep your own work
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
See [current limitations](../../reference/limitations/).
