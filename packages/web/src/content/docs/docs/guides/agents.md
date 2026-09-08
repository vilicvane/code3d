---
title: Work with an agent
description: Connect a local agent to the open project through session-managed CLI commands.
---

Code3D lets an agent inspect and edit the same project you see. The App owns the
files, version checks, saving, execution, and feedback. The agent uses independent
CLI commands; a small local service keeps the browser connection open.

[Read this guide as Markdown](../agents.md).

## Connect from the current conversation

1. Open **Connect Agent**, choose a name and a local port, then select **Add agent
   & copy prompt**. Each agent has its own configuration, color, and port.
2. Give the prompt to your local agent. It saves the private JSON configuration
   wherever convenient and starts `serve` with Node.js 24 or newer:

   ```sh
   npx --yes @code3d/cli /absolute/path/to/project.c3d.json serve
   ```

3. Keep the Code3D project open. Allow the site's local-network connection when
   the browser asks. The page keeps retrying until connected, even if it opened
   before the service started.
4. In another command invocation, obtain live context:

   ```sh
   npx --yes @code3d/cli /absolute/path/to/project.c3d.json context
   ```

The initial and update prompts both contain the complete current configuration.
There is no tool registration or agent-conversation restart. All examples below
use `project.c3d.json`; substitute the absolute path you saved.

### Keep the service owned by the session

Run `serve` in the foreground through the agent host's managed process tool,
retaining its process handle and keeping stdin or a PTY open. It prints a JSON
`listening` event, then waits. Invoke other CLI commands separately while it runs.
Do not use `nohup`, a detached process, a system daemon, or plain shell `&`.

Closing the owning stdin/PTY or sending SIGINT, SIGTERM, or SIGHUP closes the
listener and releases the port. `serve` does not interpret terminal input.
A host that closes stdin immediately will also stop the service immediately.
The host must close its managed pipe/PTY or terminate the process when the agent
session ends: a CLI cannot detect the end of an abstract chat conversation when
its host leaves the process and handles alive. Use the host's documented session
cleanup mechanism; do not claim a detached process has this lifecycle.

Reuse an existing service with the same configuration. After changing the port
or configuration, stop only that service process and start it again with the
updated file. The current agent conversation continues.

### Connection and configuration

The JSON contains `version`, `port`, `origin`, `sessionId`, `agentId`, `name`, and
`key`. Keep it private and outside committed source; use a file readable only by
your account. Neither source code nor secrets belong in process command-line
arguments. The service binds only to `127.0.0.1`, checks the App's exact Origin,
and authenticates and encrypts traffic using the per-agent key.

The App suggests a port from 49152–65535; it is not reserved until `serve` starts.
Both the creation form and an existing agent row accept ports 1024–65535. If the
port is occupied or reserved by the OS, the service reports `port_in_use` without
silently changing it. Reuse the correct existing service, or choose another port
in the App and copy its updated prompt. Browsers and agents must share reachable
loopback networking; WSL, containers, or SSH sessions may need port forwarding.

App reloads and service restarts preserve agent identities, keys, and request
receipts. **Revoke** removes one agent's authorization; **Revoke all** removes all
agents for that project. These actions stop webpage retries, but do not own or
kill the local processes. Opening the project again restores remaining grants.
User and agent cursors are independent. Agents appear at their nearest visible
file or collapsed parent folder in the file tree.

During development the real CLI is globally linked; the public
`@code3d/cli@0.0.0` package is an empty placeholder. The unversioned `npx` command
is the same for development and release. A placeholder cannot run this workflow;
use the linked development package until a real release is published.

## Read context and project files

```sh
npx --yes @code3d/cli project.c3d.json context
npx --yes @code3d/cli project.c3d.json fs list /
npx --yes @code3d/cli project.c3d.json fs read /model.ts
npx --yes @code3d/cli project.c3d.json fs stat /model.ts
```

`context` returns `data.file` and `data.cursor` (or `null`). It does not run a
model or move any cursor. Read the returned file and its imports, retaining their
opaque versions. Paths address the project owned by the App, including browser
storage and connected directories. Do not edit another local copy of that project.
The private connection file and temporary apply JSON are ordinary local files.

Prefer the public [core modeling API](../../reference/core/). Compose basic
topology and modeling operations with meaningful names, explicit parameters, and
readable intermediate steps so people and agents can edit together. Consult the
[limitations](../../reference/limitations/) before choosing APIs. Use lower-level
geometry only when the core API cannot express the intended shape.

## Apply full source changes

Write the payload to a local JSON file:

```json
{
  "files": [
    {
      "path": "/model.ts",
      "version": "<version from fs read>",
      "content": "import {box} from '@code3d/core';\nexport default box(10, 6, 8);\n"
    }
  ],
  "cursor": {"file": "/model.ts", "regex": "(box\\(10, 6, 8\\))"}
}
```

Choose and retain a unique request ID **before** submitting a change:

```sh
npx --yes @code3d/cli project.c3d.json --request-id model-edit-001 apply --input /tmp/change.json
```

`--input -` reads JSON from stdin. Each file uses full UTF-8 content and its current
version. `version: null` creates a file that must not already exist;
`content: null` deletes the specified version. Rename with a delete/create batch.
Omitted files stay unchanged. A file is limited to 8 MiB; `.git` and `.code3d`
metadata are reserved, and the project must retain a source file. Binary reads
return artifacts.

The App checks paths, every file version, and an explicit cursor against the
resulting source before accepting the batch. A conflict rejects the batch;
reread the changed files and prepare a new request. User edits and external disk
changes participate in the same checks. Saving may fail after acceptance: inspect
`accepted`, `saved`, and per-file details, and use the App's **Retry saving** for
pending writes. A model error does not undo accepted source changes.

Default `apply` confirms acceptance and saving without observing the model.
It also supports cursor-only input, or no input to observe a retained cursor.

## Select an expression and inspect a function

```json
{
  "cursor": {
    "file": "/model.ts",
    "regex": "return ([^;]+);",
    "lines": [20, 40],
    "arguments": "[10, 5, 6]"
  },
  "render": true,
  "topology": true,
  "type": true
}
```

The complete regex match must be unique, with **exactly one capturing group**.
The capture selects the expression; an empty capture places a caret. Use `(?:...)`
for any other groups. An unmatched capture is invalid. Optional `lines` is an
inclusive, 1-based range; both the whole match and capture must fall inside it,
excluding the final line's newline. Regex anchors/lookarounds still see the full
source; overlapping matches count toward uniqueness. Default flags are `u`;
`i`, `m`, `s`, `u`, or `v` may be supplied in `flags`. Regex evaluation is bounded
in a separate worker. Returned offsets are UTF-16 with Monaco line/column positions.

The cursor matches source **after** this apply's file changes. Omitting it retains
your tracked agent cursor. If edits invalidate the selection, explicitly select
again. After a page reload, reread file versions and supply a new cursor before
observing. Agent decorations never take over the user's selection.

`cursor.arguments` is a TypeScript array-expression string evaluated in the
containing module's scope; imports, variables, and model objects are available.
Explicit arguments take priority over the function's JSDoc `@code3d.arguments`,
then ordinary execution. Omission does not reuse previous custom arguments;
`"[]"` explicitly calls with no arguments. This also works without JSDoc.

## Render, types, and topology

```sh
npx --yes @code3d/cli project.c3d.json --request-id inspect-001 apply --input /tmp/inspect.json --view front --topology --type
```

`--render` requests a 960×720 PNG. `--view` implies render and accepts `isometric`,
`front`, `back`, `left`, `right`, `top`, or `bottom`. JSON also supports
`"render": {"view": {"direction": [1, 1, 1], "up": [0, 1, 0]}}`. Direction points
from scene center toward the camera: +X right, +Y up, +Z front. The up vector must
not be parallel to direction. The scene is fitted with perspective projection;
only the agent's returned image changes, leaving the user's viewport in place.

`--type` returns the selected expression's static TypeScript type, signatures,
documentation, and up to 100 members with `membersTotal`. It can run without
model evaluation and combine with other outputs. `observation.type` is `null`
when no suitable syntax is selected.

`--topology` returns model summaries and B-rep geometry from the same engine and
observation as the rendering. Input and result geometry have different ID
namespaces. Use returned model bindings and `.edge(id)`, `.surface(id)`, or
`.vertex(id)` suffixes in their real source scope; do not invent bindings, reuse
result IDs for operation inputs, assume IDs survive rebuilds, or assume millimeters.

Summaries include source context, counts, named elements, and kernel-enclosure
bounds. Faces include available area, center, boundary edges, and analytic
properties; edges include length, endpoints, adjacency, and analytic properties;
vertices include coordinates and adjacent edges. Curved-face normals identify
the sample location and whether it lies inside the trimmed surface is unverified.
Unavailable geometry is labeled explicitly. Coordinates use the observation
scene, with `geometryToScene` and `storedOrigin` identifying frames.

For additional entries, submit a separate apply payload:

```json
{
  "topology": {
    "snapshotId": "<returned snapshot>",
    "model": "m0",
    "kind": "edge",
    "offset": 48,
    "limit": 100
  }
}
```

Use the returned `snapshotId`, model key, `nextOffset`, and optionally `ids`.
`limit` is 1–200. Defaults return up to 16 model summaries and 48 entries,
prioritizing operation inputs. Snapshot queries cannot also change source or the
cursor. Snapshots expire after another observation, source/project changes,
worker restart, reload, or five minutes; `snapshot_expired` requires a fresh observation.

Model execution has no 15-second limit. Applying new source stops the old compiler
worker and supersedes its observation. Transport deadlines are independent and do
not roll back changes. A stuck compilation can be replaced by applying new source.

## Results and recovery

Single commands emit one JSON result on stdout. The request ID is also written to
stderr before sending. Images and binary artifacts are written to new local files;
JSON returns their `path`, `name`, and `mimeType`. Open the image using the agent's
image-viewing tool. `--output-dir <directory>` chooses the parent artifact folder.
Exit codes are 0 for success, 1 for an App error, 2 for local input/startup errors,
and 3 for transport errors or output failure after an invocation.

| Failure                                          | What to do                                                                                                                                               |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `service_unavailable`                            | Run the supplied `recovery.command` with the current session's managed process tool, then retry with the original ID. No conversation restart is needed. |
| `app_disconnected`                               | The service is running. Keep the project open and allow local-network access; avoid repeatedly restarting a working service.                             |
| Timeout, connection lost, or incomplete response | Execution may have happened. Restore the connection and run `recovery.queryCommand` before another mutation.                                             |
| `port_in_use`                                    | Reuse the correct service or change the App port, copy updated configuration, and restart only the service.                                              |
| `version_conflict`                               | Read current files and prepare a new full-content change against their versions.                                                                         |

`error.details.delivery` describes **this attempt**: `not_sent` means it was not
connected/forwarded, while `unknown` means execution cannot be ruled out. Neither
value declares the historical state of an ID reused from an earlier attempt.
Transport errors include a structured recovery action and instructions. Prefer
`recovery.argv` / `queryArgv` when a process tool accepts argument arrays; displayed
`command` / `queryCommand` strings use POSIX-shell quoting.

```sh
npx --yes @code3d/cli project.c3d.json result model-edit-001
```

`result` queries the original request without rerunning it. Repeating identical
input with the same ID reuses its execution/receipt; different input with the
same ID returns `request_conflict`. Never generate a fresh mutation ID merely
because a response was lost. `pending`, `unknown`, or `result_interrupted` are not
proof a change failed. If the App closed before recording the final outcome,
inspect current files before preparing any new mutation.

Receipts survive reload and service restart. Each grant retains up to 4096 receipts
and 64 MiB of responses; capacity exhaustion rejects new requests instead of
forgetting IDs and reexecuting them. Revocation deletes that grant and its receipts;
it does not undo accepted changes. The CLI's default timeout is 120 seconds
(`--timeout <ms>` changes it); the local bridge exchange deadline is 115 seconds.
Query or retry the original ID when longer-running work completes.
