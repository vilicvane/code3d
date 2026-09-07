import type {AgentConfig} from '@code3d/agent';

export function agentPrompt(config: AgentConfig, initial: boolean): string {
  const cli =
    'Run `npx --yes @code3d/cli <config-file> <operation>` with Node.js 24+. npx obtains the CLI when needed.\n';
  const guide = `Read the Code3D documentation before choosing modeling APIs:
- Documentation: https://www.code3d.org/docs/
- Modeling API: https://www.code3d.org/docs/reference/core/
- Current limitations: https://www.code3d.org/docs/reference/limitations/

Prefer the public @code3d/core API when modeling. Build models by composing basic topology and modeling operations. Use meaningful names, explicit parameters and readable intermediate steps so people and agents can understand the construction and continue editing it together. Use lower-level geometry only when the core API cannot express the required shape; preserve the modeling intent in the source.

Use --type to get the static TypeScript type at your selected expression, including call signatures and up to 100 members (membersTotal reports the full count). It does not execute the model and works on non-model values. Combine it with --render/--topology when useful. observation.type is null when the cursor has no type-bearing syntax. These are static source types; temporary cursor.arguments do not change them.

Use --view isometric|front|back|left|right|top|bottom to render from a named direction (it implies --render). For a custom view, put render: {view: {direction: [1, 1, 1], up: [0, 1, 0]}} in the apply JSON. direction points from the observed scene center toward the camera; +X is right, +Y is top, +Z is front. Vectors are in the current observation scene, not a model's unrelated local frame. The image automatically fits the selected scene using perspective projection. up sets image roll and must not be parallel to direction. Omitted views use isometric. View options affect only the agent screenshot and can also be used when rendering a retained topology snapshot.

Model execution and topology inspection have no 15-second deadline. Editing project files terminates the previous compilation and supersedes its observation, so correct a stuck model through apply; request transport timeouts do not mean the App rolled back the change.

Get the current context through the CLI. The examples use ./project.c3d.json; replace it with your configuration filename.

1. Read the App's current file and user selection, then explore the project:
\`\`\`sh
npx --yes @code3d/cli ./project.c3d.json context
npx --yes @code3d/cli ./project.c3d.json fs list /
\`\`\`
context returns data.file and data.cursor (or null). It reads the current UI state without moving either cursor or running the model. This is live context, so fetch it when starting the task instead of relying on an old prompt.

2. Read data.file with fs read. For example, if data.file is /model.ts:
\`\`\`sh
npx --yes @code3d/cli ./project.c3d.json fs read /model.ts
\`\`\`
Use the returned content to understand the model and its imports, and keep the returned version for any modification.

3. To observe the user's selected target, create a local inspect.json containing {"cursor": <the data.cursor object returned by context>}, then run:
\`\`\`sh
npx --yes @code3d/cli ./project.c3d.json apply --input inspect.json --render --topology
\`\`\`
If data.cursor is null, or another target better fits the task, choose your own one-capture regex from the source you read. Inspect the returned image path and topology; an error response contains the model diagnostic. Reread context/source if a cursor no longer matches.
`;
  if (!initial)
    return `Continue the Code3D task using your existing configuration for ${config.name} (agentId ${config.agentId}).\n\n${cli}\n${guide}`;
  return `Work on the project open in Code3D through the c3d CLI (Node.js 24+). The App owns the project files.\n\n${cli}\nSave this complete private configuration to a JSON file wherever convenient; use its filename explicitly for every command. You are ${config.name}.\n\n\`\`\`json\n${JSON.stringify(config, null, 2)}\n\`\`\`\n
${guide}

Modify project files only through \`npx --yes @code3d/cli <config-file> apply --input <json-file|->\`. Each files entry is {path, version, content}: send the full new UTF-8 content with the version returned by fs read. version:null creates an absent file; content:null deletes an existing version. Rename using a delete/create batch. The App checks the whole batch before accepting it; conflicts require re-reading. Never edit a separate local copy of the project.

apply accepts optional cursor {file, regex, lines?, flags?, arguments?}. Full regex match must be unique within the optional 1-based inclusive lines range, with exactly one capture group selecting the target (empty capture = caret). Match against the source after any submitted changes. Use noncapturing groups for other grouping. Agent cursors are independent from the user's cursor. Omit cursor to retain your own tracked position; an invalidated position must be selected again.

Use cursor.arguments as a TypeScript array-expression string to inspect inside a function, including module variables/imports/model objects. Explicit arguments override JSDoc @code3d.arguments. Omission falls back to JSDoc, then ordinary execution; it does not reuse previous custom arguments. "[]" means a zero-argument call.

Add --render and/or --topology for model feedback, including cursor-only apply. Default output confirms acceptance and saving without running an observation. The same engine selects and renders models for the user and agent. Render images are written as local artifacts; JSON reports paths. Topology distinguishes operation-input IDs from result geometry. IDs and selectors belong to their model and snapshot; do not invent variable bindings or assume millimeters. Expand topology with input.topology {snapshotId, model, kind, ids?, offset?, limit?}, using the returned model key and snapshot ID; pages cannot also change files or cursor. A snapshot can expire after another observation, a source change or five minutes.

Keep the requestId printed before each request. If transport fails, use \`npx --yes @code3d/cli <config-file> result <requestId>\` or retry identical input with --request-id <requestId>; never submit a fresh mutation ID merely because a response was lost. Check accepted/saved in error details: a model error does not undo saved source, and a save error may leave accepted pending content. Keep the project open while working. Its grants and request receipts persist across reloads and reconnect automatically when reopened; only revocation or ending the session invalidates this configuration. After a reload, re-read file versions and supply a new cursor before observing. result_interrupted means the App closed without recording the outcome: inspect the files, and never assume the change did not happen.`;
}
