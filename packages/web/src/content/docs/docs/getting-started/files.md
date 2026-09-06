---
title: Working with files
description: Use browser storage or connect the App to a local project folder.
---

## Browser workspace

The default workspace is stored in your browser. You can create multiple
TypeScript files and import between them using ordinary relative imports:

```ts
import {makeBracket} from './bracket.ts';
```

Every source file can be opened and previewed. Export a value or function when
another module needs it; exporting is not required just to inspect a local
model.

Browser data belongs to that browser profile and site origin. Clearing site
data removes the browser workspace. Keep copies of work you care about.

## Local folder

Choose **Open folder** to connect the App to a real directory. An empty
directory receives the current workspace. An existing TypeScript project is
opened as it is, along with Code3D's managed examples.

Edits in the App write directly to that directory. If you change a file in
another editor, choose **Reload folder** to read the changes. Automatic
external-file watching is not currently available.

Each connected directory gets its own workspace URL. Use **Reconnect folder**
when the browser requires fresh permission, or **Use browser storage** to
return the current tab to browser persistence.

Local folders require a browser with File System Access support and a secure
context. Browser storage remains available when folder access is unsupported.

## Modeling packages

You can start without installing packages. When the root `package.json` does
not declare `@code3d/core` (or there is no `package.json`), the App provides
built-in `@code3d/core` and `@code3d/screws`, with matching editor types.
This does not install packages or write dependency metadata into your folder.

Declaring `@code3d/core` in `dependencies`, `devDependencies`, `peerDependencies`
or `optionalDependencies` switches the complete modeling runtime to your
project's installed packages. Install `@code3d/screws` too if your model imports
it. Missing declared packages produce an error; the App does not silently use
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

const base = box(50, 4, 16);
const posts = range(3).map(index =>
  box(6, 10, 6).relate(part => part.on(base.up).offset((index - 1) * 16, 0, 0)),
);

group([base, ...posts]);
```

The App reads installed package code and declarations for execution and editor
types. It does not run `npm install` for you. A package working in Node alone
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
