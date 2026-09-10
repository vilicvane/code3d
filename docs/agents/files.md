# Project files and dependencies

[Start here](../agents.md) · Read this before multi-file changes, rename/delete operations, dependency installation, or resolving version and saving issues.

## Read context and project files

```sh
echo '{"operation":"context"}' | npx --yes @code3d/cli project.c3d.json
echo '{"operation":"fs.list","path":"/"}' | npx --yes @code3d/cli project.c3d.json
echo '{"operation":"fs.read","path":"/model.ts"}' | npx --yes @code3d/cli project.c3d.json
echo '{"operation":"fs.stat","path":"/model.ts"}' | npx --yes @code3d/cli project.c3d.json
```

`context` returns `data.file` and `data.cursor` (or `null`). Both are `null`
when no file is open in the App. It does not run a
model or move any cursor. Read the returned file and its imports, retaining their
opaque versions. Paths address the project owned by the App, including browser
storage and connected directories. Do not edit another local copy of that project.
Opening a file in the App keeps its read version valid; content or disk changes
still require rereading before applying edits.
The private connection file and temporary apply JSON are ordinary local files.

## Apply full source changes

Write the payload to a local JSON file:

```json
{
  "operation": "apply",
  "input": {
    "files": [
      {
        "path": "/model.ts",
        "version": "<version from fs.read>",
        "content": "import {box} from '@code3d/core';\nexport default box(10, 6, 8);\n"
      }
    ],
    "cursor": {
      "file": "/model.ts",
      "regex": "(box\\(10, 6, 8\\))"
    }
  }
}
```

Choose and retain a unique request ID **before** submitting a change:

```sh
npx --yes @code3d/cli project.c3d.json --request-id model-edit-001 < /tmp/change.json
```

Each file uses full UTF-8 content and its current
version. `version: null` creates a file that must not already exist;
`content: null` deletes the specified version. Rename with a delete/create batch.
Omitted files stay unchanged. A file is limited to 8 MiB; `.git` and `.code3d`
metadata are reserved. A project may contain no source files; open text files
stay synchronized when an agent edits them. Binary reads
return artifacts.

The App checks paths, every file version, and an explicit cursor against the
resulting source before accepting the batch. A conflict rejects the batch;
reread the changed files and prepare a new request. User edits and external disk
changes participate in the same checks. Saving may fail after acceptance: inspect
`accepted`, `saved`, and per-file details, and use the App's **Retry saving** for
pending writes. A model error does not undo accepted source changes.

Default `apply` confirms acceptance and saving without observing the model.
It also supports cursor-only input, or observation fields without a cursor to observe the retained cursor. Use `"input": {}` for an apply with no changes or outputs.

## Install project dependencies

For a **Browser storage** project, use `apply` to edit the relevant `package.json`,
then request `"render": true` or `"topology": true` for a model in that package scope. The App
prepares and installs the dependencies before evaluating the model. The CLI has
no separate install or update command.

Read the model and locate its nearest ancestor `package.json` with `fs.list`,
`fs.stat` and `fs.read`. Preserve the existing manifest fields and dependencies,
and use its current file version in `apply`. If there is no manifest, create one
beside the model using `version: null`; a child manifest defines a separate package
scope. These paths belong to the App project, independently of where the local
CLI configuration and input JSON are saved.

For example, to create `/package.json` beside the `/model.ts` from the source-change
example above, save this payload as `/tmp/add-dependency.json`:

```json
{
  "operation": "apply",
  "input": {
    "files": [
      {
        "path": "/package.json",
        "version": null,
        "content": "{\n  \"private\": true,\n  \"type\": \"module\",\n  \"dependencies\": {\n    \"just-range\": \"4.2.0\"\n  }\n}\n"
      }
    ],
    "cursor": {
      "file": "/model.ts",
      "regex": "(box\\(10, 6, 8\\))"
    },
    "render": true
  }
}
```

```sh
npx --yes @code3d/cli project.c3d.json --request-id dependency-edit-001 < /tmp/add-dependency.json
```

If the manifest already exists, merge the dependency into its full contents and
replace `null` with its read version. Adapt the cursor to an observable expression
in your actual model. An explicit cursor ensures preparation uses the intended
package scope; omitting it retains the agent's previous modeling cursor, even if
the most recent `fs.read` or `fs.list` visited another scope.

A plain `apply` response confirms file acceptance and saving, **not installation
completion**. The App may compile in the background, but `"render": true` or `"topology": true`
lets the requesting agent wait for preparation and model feedback. Check the
complete result: successful observation confirms preparation and evaluation;
errors describe installation or subsequent model failures. An observation error
can still include `error.details.accepted: true` and `saved: true`; those file
changes remain accepted. Inspect the error before deciding whether to fix the
manifest or the model. After a transport timeout, query the original request ID
with `result` before sending another change.

The App maintains `code3d-lock.json` and `node_modules` beside each browser
manifest. Ordinary preparation reuses locked versions. To refresh versions within
unchanged dependency ranges, use **Update dependencies** on the manifest in the
App; there is no agent command for that action yet. Choose browser-compatible
packages; see [package installation and modeling package rules](../../packages/web/src/content/docs/docs/getting-started/files.md#install-packages-in-browser-storage).

For an **Open folder** project, installation remains external, managed by the
project's own package manager in the connected local directory. Changing its
manifest through `apply` does not make the App install packages, and the CLI
cannot perform that installation. Browser storage has no local project directory
in which an agent can run `npm install`.

## Related reading

Use [source selection](cursor.md) to choose the model to observe, [observation](observation.md) to verify it, and [recovery](recovery.md) after an uncertain result.
