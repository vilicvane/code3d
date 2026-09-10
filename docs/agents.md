# Work in Code3D

You are working on the project open in the user's Code3D App. Read this entry
first; use the topic directory below when a task needs more detail.

## Working agreement

- Read and modify project files through the CLI. The App owns source, versions,
  saving, compilation and observation. Your connection config and temporary JSON
  payloads are local files; the App project can live entirely in browser storage.
- Read a file before replacing it, retain its returned version, and send its full
  new content. Use a stable request ID for each change. After an uncertain result,
  query that ID before submitting another change.
- Prefer readable models built from the public Code3D core API: name intermediate
  geometry, compose operations and preserve useful parameters. See the shared
  [Core README](../packages/core/README.md) when choosing APIs.
- An accepted or saved edit can still fail to compile or render. Read the whole
  response and inspect the returned image before reporting the modeling result.

## Connect

Save the complete private JSON supplied in the user's prompt to a configuration
file outside committed source. Use its absolute path in place of `project.c3d.json`
throughout these examples. Node.js 24+ is required.

Start the service using your current session's managed process tool, keeping its
stdin or PTY open and retaining the process handle:

```sh
npx --yes @code3d/cli /absolute/path/to/project.c3d.json serve
```

Wait for the JSON `listening` event. Reuse a service with the same config; restart
only that service if its config changes. Keep the App open and allow local-network
access when the browser asks. Run requests separately while the service remains
active. The session must close its managed pipe/PTY or stop the process on exit;
do not detach it, use `nohup`, or restart the agent conversation. See
[connection](agents/connection.md) if the host or port needs attention.

## Read, change, observe

First obtain the current file and user selection, then read the relevant files:

```sh
echo '{"operation":"context"}' | npx --yes @code3d/cli project.c3d.json
echo '{"operation":"fs.list","path":"/"}' | npx --yes @code3d/cli project.c3d.json
echo '{"operation":"fs.read","path":"/model.ts"}' | npx --yes @code3d/cli project.c3d.json
```

Use the file returned by `context`, or choose one from the listing if no file is
open; `/model.ts` is an example. Read its imports as needed. Paths are absolute
within the App project. Reading context does not adopt the user's selection as
your agent cursor.

For a simple replacement of that file, write `/tmp/change.json` with the version
from `fs.read` and the complete intended source:

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
    },
    "render": true
  }
}
```

The cursor regex matches the resulting source. Its complete match must be unique,
and exactly one capturing group identifies your selection. This selects the box
for observation; it does not take over the user's editor cursor.

```sh
npx --yes @code3d/cli project.c3d.json --request-id model-edit-001 < /tmp/change.json
```

Use a new ID for a new edit. The CLI reads one JSON document until EOF and returns
one JSON result. An `apply` without output options confirms acceptance and saving;
`render: true` also requests a 960×720 Modeling image. Open the returned artifact
`path` with your image-viewing tool. Add `topology: true` or `type: true` when the
task needs geometric or TypeScript evidence.

If the response is lost, restore the connection and query the original ID:

```sh
echo '{"operation":"result","requestId":"model-edit-001"}' | npx --yes @code3d/cli project.c3d.json
```

Do not assume the change failed. Follow the response's recovery instructions and
the [recovery guide](agents/recovery.md). For version conflicts, reread the affected
files and prepare a new edit against their current versions.

## Complete topic directory

| Read when you need to…                                                | Document                                                    |
| --------------------------------------------------------------------- | ----------------------------------------------------------- |
| Start, reconnect or reconfigure the service; choose CLI options       | [Connection and request transport](agents/connection.md)    |
| Read/create/replace/delete files, rename them or install dependencies | [Project files and dependencies](agents/files.md)           |
| Select an exact expression or inspect a function with arguments       | [Source selection and function arguments](agents/cursor.md) |
| Plan readable models and find the appropriate package/API             | [Modeling workflow](agents/modeling.md)                     |
| Choose render modes/views, inspect types or page B-rep topology       | [Rendering, types and topology](agents/observation.md)      |
| Edit sketches and interpret solved geometry, layers and constraints   | [Sketch modeling and observation](agents/sketches.md)       |
| Interpret failures, recover an unknown outcome or retry safely        | [Results and recovery](agents/recovery.md)                  |

## Package documentation

These READMEs serve both people and agents. Each introduces its package and links
to types, implementation and examples for deeper reading.

| Package                                          | Purpose                                        |
| ------------------------------------------------ | ---------------------------------------------- |
| [Core](../packages/core/README.md)               | Modeling API, geometry, relations and sketches |
| [Materials](../packages/materials/README.md)     | Reusable Three.js material presets             |
| [Screws](../packages/screws/README.md)           | Standard fasteners and matching hole tools     |
| [CLI](../packages/cli/README.md)                 | Command-line JSON transport and local service  |
| [Agent](../packages/agent/README.md)             | Shared client, encryption and App endpoint     |
| [App](../packages/app/README.md)                 | Editor, project storage and visualization      |
| [OpenCascade](../packages/opencascade/README.md) | Native geometry runtime and bindings           |
| [Solver](../packages/solver/README.md)           | Independent rigid-body constraint solver       |
| [Website](../packages/web/README.md)             | Website, documentation and publication         |
