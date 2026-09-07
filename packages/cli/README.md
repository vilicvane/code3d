# @code3d/cli

`c3d` provides a local MCP server and command-line tools for Code3D, using Node.js
24+. The browser App owns project files, version checks, saves, model execution
and receipts. The local process bridges MCP/CLI requests to the open App through
an authenticated, encrypted loopback connection. No public relay, account or
server deployment is needed.

## Connect an agent

1. Open **Connect Agent** in the App. Choose a name and local port, then **Add
   agent & copy prompt**. A random port in 49152–65535 is suggested; each agent
   has its own persisted port, identity and secret.
2. Give the prompt to your local agent. It saves the complete private JSON
   configuration wherever convenient and registers this stdio MCP command in
   its client's supported configuration:

   ```sh
   npx --yes @code3d/cli /absolute/path/to/project.c3d.json mcp
   ```

   For clients with `mcpServers` configuration:

   ```json
   {
     "mcpServers": {
       "code3d-modeling": {
         "command": "npx",
         "args": [
           "--yes",
           "@code3d/cli",
           "/absolute/path/to/project.c3d.json",
           "mcp"
         ]
       }
     }
   }
   ```

3. The MCP client starts and manages the process. Allow the Code3D page's local
   network permission if the browser asks. The App retries automatically before
   the process starts, after a disconnect, and when the project is reopened.

Register or reload MCP through the client's supported mechanism; starting a
background process alone does not attach tools to an existing conversation.
The MCP process exits on stdin EOF, SIGINT or SIGTERM and releases its listening
port. Do not launch multiple instances for the same agent. A port conflict is
reported as `port_in_use`; the service never silently chooses another port.

To change an existing agent's port, edit its **Port** field in the App. The App
persists it, closes the old connection/retry, and copies an updated prompt. Have
the agent replace its saved configuration and restart the registered MCP server.
Other agents continue independently. Revoke stops this grant's connections and
requests; End session revokes all agents in the current project. Accepted file
changes still finish saving. Switching projects disconnects the old project;
returning to it restores its own grants and receipts.

An HTTPS App connects to `ws://127.0.0.1:<port>` with its exact Origin. Current
Chrome can require local-network permission; a denied permission prevents the
connection before it reaches the process. Allow it in the site's permissions
and the App's retry will connect. The browser and MCP process must share a
reachable loopback interface. WSL/containers/remote SSH setups need their local
port forwarding; an agent on another machine cannot use the browser's loopback.

The registry's `0.0.0` package remains an empty placeholder. A real development
CLI must be globally linked as described below; it is not yet published. The
copied prompt uses the same unversioned npx command in both environments.

## MCP tools

| Tool      | Input                                                     | Purpose                                           |
| --------- | --------------------------------------------------------- | ------------------------------------------------- |
| `context` | `{}`                                                      | Read the current App file and user selection      |
| `fs_list` | `{path}`                                                  | List a project directory                          |
| `fs_read` | `{path}`                                                  | Read current content and file version             |
| `fs_stat` | `{path}`                                                  | Read file/directory metadata                      |
| `apply`   | `{requestId, files?, cursor?, render?, topology?, type?}` | Submit files and/or an independent agent cursor   |
| `result`  | `{requestId}`                                             | Recover an earlier result without executing again |

Start with `context`, then `fs_read` using `data.file`. Use its returned version
for changes. To observe the user's selection, call `apply` with a new ID,
`cursor: data.cursor`, `render: true` and `topology: true`.

**Choose the apply requestId before calling the tool.** This required field
allows recovery even when the MCP client times out, cancels or closes before it
receives a result. Query `result` or retry identical input with the same ID;
never create a fresh mutation merely because a response was lost. A cancellation
ends the wait, not an already accepted file change.

Tool content includes a JSON text result with `requestId`, `ok`, and `data` or
`error`. Render artifacts are native MCP image content; other binary artifacts
are embedded resources. JSON includes artifact names/MIME types, not duplicate
binary payloads. Standard Base64 is used on MCP, while the App's encrypted wire
contract uses base64url. Operation errors set MCP `isError: true` and retain the
domain code and accepted/saved details. No project result is persisted locally.

## Command-line operations

While the MCP process is running and the App is connected, ordinary CLI calls
use the same local bridge, identity and receipts. Save the complete App-provided
configuration to a private file; there is no connect/init command.

```sh
c3d project.json context
c3d project.json fs list /
c3d project.json fs read /model.ts
c3d project.json fs stat /model.ts
c3d project.json apply --input changes.json
c3d project.json apply --input - --render --topology < inspection.json
c3d project.json apply --input inspection.json --view top --type
c3d project.json --request-id edit-42 apply --input changes.json
c3d project.json result edit-42
```

Start with `context` to get the App's current `data.file` and `data.cursor`.
Read that file with `fs read`, then save `{cursor: <returned cursor>}` to a local
inspection JSON and submit it with `apply --input ... --render --topology`.
The context query does not move either cursor or run the model. Choose your own
regex from the source when the current user target does not fit the task.

For modeling APIs, use the [Code3D documentation](https://www.code3d.org/docs/)
and [Modeling API reference](https://www.code3d.org/docs/reference/core/).

`apply` takes JSON from `--input <file>` or `--input -` (stdin). Omitting input
sends an empty apply. `--render`, `--topology` and `--type` request observation outputs;
their absence leaves any corresponding JSON input option unchanged. `--render`
preserves JSON view options and `--topology` preserves paging/filter options. By default
no observation output is requested. See the [protocol](../agent/README.md) for
the full configuration and input schema.

For example, create a file and select an expression in the resulting source:

```json
{
  "files": [
    {
      "path": "/model.ts",
      "version": null,
      "content": "import {box} from '@code3d/core';\nexport const model = box(10, 10, 10);\n"
    }
  ],
  "cursor": {"file": "/model.ts", "regex": "model = (box\\(10, 10, 10\\))"}
}
```

Replacing or deleting an existing file requires the version returned by the App.
Cursor-only input is valid. A cursor regex must have exactly one capture and a
unique full match, optionally within a 1-based inclusive `lines` range. The App
performs source-dependent preflight before accepting the batch. Explicit cursor
`arguments` is a TypeScript array-expression string such as `"[10, 5]"`; omit it
to use JSDoc arguments or the ordinary execution context.

`--view isometric|front|back|left|right|top|bottom` implies rendering and overrides
the JSON view. For a custom direction, submit `"render": {"view": {"direction":
[1, 1, 1], "up": [0, 1, 0]}}`; `--render` retains this configuration. Directions
point from the observation's center toward the camera: +X right, +Y top, +Z front.
The image uses perspective projection and automatically fits the observed scene.
The user's camera stays unchanged. Omitted views use isometric.

`--type` queries Monaco's static TypeScript type at the agent selection, without
running the model. `observation.type` includes the source range, type, signatures,
documentation and members, or null when no type-bearing syntax is selected.
Calls expose result types; function names expose callable signatures. The first
100 members are listed along with `membersTotal`; select a specific member to
inspect it further. This also works when the model throws or loops at runtime.
Temporary `cursor.arguments` values do not change static types.

Model execution and topology no longer stop at 15 seconds. Editing source in
the App or through `apply` terminates the previous compilation. An in-flight
agent observation returns `observation_superseded` with its accepted/saved
outcome, and new observations can proceed. The CLI and local transport deadlines
still apply; after transport timeout, query the request receipt or edit the
source to replace a stuck model rather than resubmitting a mutation blindly.

## Output and retries

Agent configurations and request receipts persist in the App for each project.
Opening that project reconnects automatically; revoking the agent or ending the
session invalidates its configuration. After reopening, read fresh file versions
and supply a cursor before requesting an observation. `result_interrupted` means
the App closed before recording the outcome: inspect the files before deciding
on a new change. Retrying the same request ID never executes it again.

Each invocation writes one JSON result to stdout. Request metadata goes to
stderr so the ID is available before a response, including if the process is
interrupted. Help and version output are plain text. Exit codes are:

| Code | Meaning                                                                  |
| ---- | ------------------------------------------------------------------------ |
| `0`  | App returned success, or help/version was shown                          |
| `1`  | App returned an operation error                                          |
| `2`  | Usage, configuration or input error before sending                       |
| `3`  | Request outcome or local result handling failed; inspect the returned ID |

Use `--timeout <ms>` to change the 120-second request deadline. A timeout or transport
error does **not** mean a change was rejected. Use `result <original-request-id>`
or resubmit the same input with `--request-id <original-request-id>`; never assume
it is safe to create another mutation merely because the response was lost.

Returned artifacts are decoded into a fresh `c3d-*` directory inside the system
temporary directory, or under `--output-dir <directory>`. JSON reports their
absolute paths, names and MIME types, without flooding stdout with image data.
Artifact labels never control filesystem paths. If local artifact saving fails,
the error includes `remoteResult` without binary data, preserving the App's
reported outcome; query the original request to retrieve its artifacts again.

## Observation pages

`--render` returns a 960×720 PNG from the same compiler, source-selection and
image-export path as the GUI. `--topology` returns kernel geometry, actual numeric
or path IDs, measurements and incidence. Input models for fillet, chamfer, shell
and topology references are distinguished from result models. `selector` is a
member suffix; combine it only with a valid receiver in scope. Reported binding
names include source locations and do not guarantee visibility from another scope.

The first page includes up to 16 model summaries and 48 topology entries from the
selected model (prefer the operation input when present). Select a model by its
returned key, and page or filter with:

```json
{
  "topology": {
    "snapshotId": "<returned-snapshot-id>",
    "model": "m0",
    "kind": "edge",
    "offset": 48,
    "limit": 48
  }
}
```

Use `ids` instead of or alongside paging to request specific IDs, for example
`[1, [2, 3]]`. Limits are 1–200 entries. An existing snapshot page cannot also
change source or cursor. The latest observation snapshot is kept in the App for
up to five minutes; another observation, project edit, worker restart or page
reload can invalidate it. `snapshot_expired` requires a new observation.

Positions and directions are in the observation scene; `geometryToScene` maps
retained geometry into that scene, and `storedOrigin` identifies its origin
reference. Units are model units. Bounds are kernel enclosures; curved-face
normals are labeled samples on the underlying surface with unchecked membership
in the trimmed face. Unavailable kernel measurements are explicit, never inferred
from tessellation.

## Repository development

Initial and update prompts use the same command in every environment:
`npx --yes @code3d/cli <config-file> <operation>`. The prompt contains no local
paths or instructions to build Code3D. The developer prepares and links the CLI:

```sh
npm run build:packages
npm link --workspace @code3d/cli
npx --yes @code3d/cli --version
npm test --workspace @code3d/cli
```

The unversioned package name lets npx use a local or globally linked development
version. It may fetch registry metadata first to discover the `c3d` executable.
The global link points to one checkout at a time; relink when switching the
development checkout and rebuild after CLI changes. npm's global prefix must be
writable when creating the link.

The 0.0.0 placeholder contains only package metadata, a notice, the license and a
minimal `c3d` entry that reports the CLI is not released and exits with status 1.
It contains no implementation or dependencies. A linked development CLI reports
its own version instead. A fresh environment without the link will run the
placeholder until an actual release is published; do not pin development commands
to `@0.0.0` or `@latest`. Integration tests launch actual MCP stdio clients and CLI processes, authenticate
real WebSockets, reject replay/reflection/foreign origins, and recover App
receipts after the local process restarts.
