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

Third-party package imports in App are not yet generally available.
See [current limitations](../../reference/limitations/).
