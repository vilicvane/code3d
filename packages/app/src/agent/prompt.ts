import type {AgentConfig} from '@code3d/agent';

export function agentPrompt(config: AgentConfig, initial: boolean): string {
  return `${initial ? 'Work on' : 'Continue working on'} the project open in Code3D as ${config.name}. The App owns the project files; use its tools to read and modify them.

Save this complete private configuration to a JSON file wherever convenient (for example project.c3d.json). Keep its secret private. If you already have a configuration for agentId ${config.agentId}, replace it with this one, including its current port.

\`\`\`json
${JSON.stringify(config, null, 2)}
\`\`\`

Register a local MCP server in your agent client's supported configuration. Use Node.js 24+ and this launch command:

\`\`\`sh
npx --yes @code3d/cli /absolute/path/to/project.c3d.json mcp
\`\`\`

For clients with an mcpServers JSON configuration, the entry is:

\`\`\`json
${JSON.stringify({mcpServers: {[`code3d-${config.agentId}`]: {command: 'npx', args: ['--yes', '@code3d/cli', '/absolute/path/to/project.c3d.json', 'mcp']}}}, null, 2)}
\`\`\`

Replace the example absolute path with the file you saved. Your MCP client starts and manages this stdio process. Register or reload it using the client's supported mechanism; merely starting a background command does not add tools to the current conversation. Do not start a second server on the same port. If you update the port or configuration, restart the registered server with the updated file.

The server listens only on 127.0.0.1:${config.port}. The Code3D page keeps retrying the connection; leave it open and allow its local-network permission if the browser asks. It can connect before or after the server starts. Revoke or End session stops its retries. Port conflicts are reported instead of silently picking another port; change the port in Code3D and copy the updated prompt if necessary.

Read the Code3D documentation before choosing modeling APIs:
- Documentation: https://www.code3d.org/docs/
- Modeling API: https://www.code3d.org/docs/reference/core/
- Current limitations: https://www.code3d.org/docs/reference/limitations/

Prefer the public @code3d/core API. Compose basic topology and modeling operations with meaningful names, explicit parameters and readable intermediate steps so people and agents can continue editing together. Use lower-level geometry only when the core API cannot express the shape, preserving the modeling intent in the source.

Get live context through the MCP tools, rather than assuming this prompt contains the current code:

1. Call context with {}. It returns data.file and data.cursor (or null), without moving any cursor or running a model.
2. Call fs_list with {"path":"/"}, then fs_read with {"path": <data.file>}. Read imports as needed and keep each returned file version.
3. Call apply with {"requestId": <a new unique ID you choose>, "cursor": <data.cursor>, "render": true, "topology": true}. If there is no user selection, choose a target from the source you read. The tool returns the image directly alongside JSON and topology. Reread context/source if the selection no longer matches.

For each apply, choose and keep requestId BEFORE calling. After a timeout, cancellation or lost response, call result with {"requestId": <the original ID>}, or retry exactly the same apply with that ID. Never submit a fresh mutation ID merely because a response was lost. Check accepted/saved in errors: model errors do not undo source changes; save errors may leave accepted pending content. result_interrupted means the App closed before recording the outcome, so inspect the files before another mutation.

Modify project files only through apply. Each files item is {path, version, content}: full new UTF-8 content and the version from fs_read. version:null creates an absent file; content:null deletes the specified version. Rename with a delete/create batch. The App checks the whole batch before accepting it; conflicts require rereading. Do not edit another local copy of the project.

apply also accepts cursor {file, regex, lines?, flags?, arguments?}. The complete regex match must be unique in the optional 1-based inclusive lines range, with exactly one capture group selecting the target (empty capture = caret). Use noncapturing groups for other grouping. Match against the source after submitted file changes. Agent and user cursors are independent. Omit cursor to retain your tracked position; select again if it is invalidated.

cursor.arguments is a TypeScript array-expression string for inspecting inside a function, including module imports/variables/model objects. Explicit arguments override JSDoc @code3d.arguments. Omission falls back to JSDoc and then ordinary execution; previous custom arguments are not reused. "[]" means a zero-argument call.

Default apply output confirms acceptance and saving without observing. Add render:true and/or topology:true for model feedback, including cursor-only apply. The App uses the same engine for user and agent observations. Use type:true for the selected expression's static TypeScript type, signatures, docs and up to 100 members; this does not execute the model and can be combined with other outputs. type may be null when no type-bearing syntax is selected.

For a render view, use render:{view:"front"} (also back, left, right, top, bottom, isometric), or render:{view:{direction:[1,1,1],up:[0,1,0]}}. Direction points from the observed scene center toward the camera; +X is right, +Y is top, +Z is front. The optional up vector controls roll and must not be parallel to direction. The scene is automatically fitted with perspective projection. Views affect only your returned image; they do not move the user's camera.

Topology distinguishes operation-input IDs from result geometry. IDs belong to their model and snapshot; do not invent bindings or assume millimeters. Page using topology:{snapshotId,model,kind,ids?,offset?,limit?}, with the returned IDs. Snapshot queries cannot also change files/cursor; snapshots expire after another observation, source changes or five minutes.

Model execution and topology inspection have no 15-second limit. Applying new source terminates the previous compilation and supersedes its observation. Transport/client timeouts and cancellations do not roll back accepted changes. Grants and receipts survive App reloads and reconnect when reopened; after reload, reread versions and supply a new cursor before observing.

While this MCP server is running, the same private configuration also supports ordinary CLI operations: npx --yes @code3d/cli <config-file> context, fs list /, fs read <path>, apply --input <json-file> --render --topology --type, and result <requestId>. CLI images are written to local artifact files; MCP images are returned directly. CLI calls also require the local server and the App connection.`;
}
