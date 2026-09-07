# @code3d/cli

`c3d` is the Node.js 24+ command-line client for Code3D agent sessions. It reads
and modifies the project through the App, using the shared encrypted protocol.
It never writes local copies of the project's source files.

Open **Agents** in the App, enter the relay address, and choose **Add agent & copy
prompt**. Each agent receives its own configuration. The App handles browser
storage and connected directories. The [stateless relay](../relay/README.md) runs
as a separate Node service. The 0.0.0 package is an empty placeholder;
the actual CLI is used through a local development link. Implementation and scope are tracked in
[issue #50](https://github.com/vilicvane/code3d/issues/50).

## Usage

Save the complete JSON configuration supplied by the App to a file of your
choice. It contains a stable agent identity, relay route and content key;
keep it private and give each agent its own configuration. There is no `connect`
or configuration initialization command.

```sh
c3d project.json fs list /
c3d project.json fs read /model.ts
c3d project.json fs stat /model.ts
c3d project.json apply --input changes.json
c3d project.json apply --input - --render --topology < inspection.json
c3d project.json --request-id edit-42 apply --input changes.json
c3d project.json result edit-42
```

`apply` takes JSON from `--input <file>` or `--input -` (stdin). Omitting input
sends an empty apply. `--render` and `--topology` request observation outputs;
their absence leaves any corresponding JSON input option unchanged. --topology
preserves paging/filter options supplied in the input JSON. By default
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

## Output and retries

Each invocation writes one JSON result to stdout. Request metadata goes to
stderr so the ID is available before a response, including if the process is
interrupted. Help and version output are plain text. Exit codes are:

| Code | Meaning                                                                  |
| ---- | ------------------------------------------------------------------------ |
| `0`  | App returned success, or help/version was shown                          |
| `1`  | App returned an operation error                                          |
| `2`  | Usage, configuration or input error before sending                       |
| `3`  | Request outcome or local result handling failed; inspect the returned ID |

Use `--timeout <ms>` to change the 120-second request deadline. A timeout or relay
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
to `@0.0.0` or `@latest`. CLI integration tests launch real processes against a
loopback encrypted endpoint.
