import type {AgentConfig, AgentCursor} from '@code3d/agent';
import type {SourceRef} from '@code3d/core/tooling';

/** Capture source and selection at the click, before any clipboard or session awaits. */
export function promptCursor(source: string, ref: SourceRef): AgentCursor {
  const start =
    ref.start === 0 ? 0 : source.lastIndexOf('\n', ref.start - 1) + 1;
  const newline = source.indexOf('\n', ref.end);
  let end = newline < 0 ? source.length : newline;
  if (end > ref.end && source[end - 1] === '\r') end--;
  const escape = (value: string) =>
    value
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replaceAll('\r', '\\r')
      .replaceAll('\n', '\\n');
  return {
    file: ref.file,
    flags: 'mu',
    lines: [
      source.slice(0, start).split('\n').length,
      source.slice(0, end).split('\n').length,
    ],
    regex:
      '^' +
      escape(source.slice(start, ref.start)) +
      '(' +
      escape(source.slice(ref.start, ref.end)) +
      ')' +
      escape(source.slice(ref.end, end)) +
      '$',
  };
}

export function agentPrompt(
  config: AgentConfig,
  initial: boolean,
  task: string,
  cursor?: AgentCursor,
): string {
  const cli =
    __CODE3D_CLI_COMMAND__ === 'c3d'
      ? 'Use the installed `c3d` executable (Node.js 24+).\n'
      : 'Use the existing development CLI in the same environment as the App dev server. In every command, replace `c3d` with the following command; it works from any directory (POSIX shell, or PowerShell on Windows):\n```sh\n' +
        __CODE3D_CLI_COMMAND__ +
        '\n```\n';
  const context = cursor
    ? '\nPinned observation at prompt-copy time (re-read if the source has since changed):\n```json\n' +
      JSON.stringify({cursor}, null, 2) +
      '\n```\n'
    : '';
  if (!initial)
    return `Continue the Code3D task using your existing configuration for ${config.name} (agentId ${config.agentId}).\n\n${cli}\nTask:\n${task.trim()}\n${context}`;
  return `Work on the project open in Code3D through the c3d CLI (Node.js 24+). The App owns the project files.\n\n${cli}\nSave this complete private configuration to a JSON file wherever convenient; use its filename explicitly for every command. You are ${config.name}.\n\n\`\`\`json\n${JSON.stringify(config, null, 2)}\n\`\`\`\n
Use \`c3d <config-file> fs list /\`, \`fs read /model.ts\`, and \`fs stat /model.ts\` to inspect the App's current project.

Modify project files only through \`c3d <config-file> apply --input <json-file|->\`. Each files entry is {path, version, content}: send the full new UTF-8 content with the version returned by fs read. version:null creates an absent file; content:null deletes an existing version. Rename using a delete/create batch. The App checks the whole batch before accepting it; conflicts require re-reading. Never edit a separate local copy of the project.

apply accepts optional cursor {file, regex, lines?, flags?, arguments?}. Full regex match must be unique within the optional 1-based inclusive lines range, with exactly one capture group selecting the target (empty capture = caret). Match against the source after any submitted changes. Use noncapturing groups for other grouping. Agent cursors are independent from the user's cursor. Omit cursor to retain your own tracked position; an invalidated position must be selected again.

Use cursor.arguments as a TypeScript array-expression string to inspect inside a function, including module variables/imports/model objects. Explicit arguments override JSDoc @code3d.arguments. Omission falls back to JSDoc, then ordinary execution; it does not reuse previous custom arguments. "[]" means a zero-argument call.

Add --render and/or --topology for model feedback, including cursor-only apply. Default output confirms acceptance and saving without running an observation. The same engine selects and renders models for the user and agent. Render images are written as local artifacts; JSON reports paths. Topology distinguishes operation-input IDs from result geometry. IDs and selectors belong to their model and snapshot; do not invent variable bindings or assume millimeters. Expand topology with input.topology {snapshotId, model, kind, ids?, offset?, limit?}, using the returned model key and snapshot ID; pages cannot also change files or cursor. A snapshot can expire after another observation, a source change or five minutes.

Keep the requestId printed before each request. If transport fails, use \`c3d <config-file> result <requestId>\` or retry identical input with --request-id <requestId>; never submit a fresh mutation ID merely because a response was lost. Check accepted/saved in error details: a model error does not undo saved source, and a save error may leave accepted pending content. Keep the App open; refreshing or switching projects ends these grants.\n\nTask:\n${task.trim()}\n${context}`;
}
