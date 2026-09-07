# @code3d/cli

`c3d` is the Node.js 24+ command-line client for Code3D agent sessions. It reads
and modifies the project through the App, using the shared encrypted protocol.
It never writes local copies of the project's source files.

Open **Agents** in the App, enter the relay address, and choose **Add agent & copy
prompt**. Each agent receives its own configuration. The App handles browser
storage and connected directories. The [stateless relay](../relay/README.md) runs
as a separate Node service; no production deployment or npm publication is part
of this branch. Implementation and scope are tracked in
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

The development App includes absolute paths to its Node executable and the CLI
in both initial and update prompts. Agents can run that command from any working
directory in the same environment as the dev server, using the CLI from the
matching checkout. The developer prepares the build; agents do not clone or build
Code3D. Production builds use the installed `c3d` command and contain no local
development paths.

```sh
npm run build:packages
node packages/cli/bld/main.js --help
npm test --workspace @code3d/cli
```

For a global development command, run `npm link --workspace @code3d/cli` from the
repository root, then invoke `c3d` directly. The link points to that checkout;
rebuild after CLI changes. A single global link can target only one checkout,
so generated development prompts use the explicit local path.

The package installs a `c3d` executable through npm's `bin` field. It has not been
published as part of this development stage. CLI integration tests launch real
processes against a loopback encrypted endpoint.
