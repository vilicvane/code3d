import {
  AgentError,
  boolean,
  decodeBase64,
  identifier,
  object,
  positiveInteger,
  projectPath,
  string,
} from './validation.js';

export type FileChange = Readonly<{
  path: string;
  /** null requires absence (creation); other values must match the current file. */
  version: string | null;
  /** null deletes the file; otherwise this is the complete new content. */
  content: string | null;
}>;

export type AgentCursor = Readonly<{
  file: string;
  regex: string;
  lines?: readonly [number, number];
  flags?: string;
  arguments?: string;
}>;

export type ApplyInput = Readonly<{
  files?: readonly FileChange[];
  cursor?: AgentCursor;
  render?: boolean;
  topology?: boolean | TopologyOutputOptions;
}>;

export type TopologyOutputOptions = Readonly<{
  snapshotId?: string;
  model?: string;
  kind?: 'vertex' | 'edge' | 'surface';
  ids?: readonly (number | readonly [number, number, ...number[]])[];
  offset?: number;
  limit?: number;
}>;

function topologyOptions(value: unknown): boolean | TopologyOutputOptions {
  if (typeof value === 'boolean') return value;
  const data = object(
    value,
    ['snapshotId', 'model', 'kind', 'ids', 'offset', 'limit'],
    'Topology output',
  );
  if (
    data.kind !== undefined &&
    !['vertex', 'edge', 'surface'].includes(data.kind as string)
  )
    throw new AgentError(
      'invalid_input',
      'Topology kind must be vertex, edge or surface.',
    );
  let ids: (number | readonly [number, number, ...number[]])[] | undefined;
  if (data.ids !== undefined) {
    if (
      !data.kind ||
      !Array.isArray(data.ids) ||
      data.ids.length < 1 ||
      data.ids.length > 200
    )
      throw new AgentError(
        'invalid_input',
        'Topology IDs require a kind and an array of 1 to 200 IDs.',
      );
    ids = data.ids.map(value => {
      if (!Array.isArray(value)) return positiveInteger(value, 'Topology ID');
      if (value.length < 2 || value.length > 32)
        throw new AgentError(
          'invalid_input',
          'A topology path contains 2 to 32 positive integers.',
        );
      return value.map(part =>
        positiveInteger(part, 'Topology path component'),
      ) as [number, number, ...number[]];
    });
  }
  const offset =
    data.offset === undefined
      ? undefined
      : data.offset === 0
        ? 0
        : positiveInteger(data.offset, 'Topology offset');
  const limit =
    data.limit === undefined
      ? undefined
      : positiveInteger(data.limit, 'Topology limit');
  if (limit !== undefined && limit > 200)
    throw new AgentError('invalid_input', 'Topology limit is at most 200.');
  return {
    ...(data.snapshotId === undefined
      ? {}
      : {snapshotId: identifier(data.snapshotId, 'Snapshot ID')}),
    ...(data.model === undefined
      ? {}
      : {model: string(data.model, 'Topology model')}),
    ...(data.kind === undefined
      ? {}
      : {kind: data.kind as 'vertex' | 'edge' | 'surface'}),
    ...(ids === undefined ? {} : {ids}),
    ...(offset === undefined ? {} : {offset}),
    ...(limit === undefined ? {} : {limit}),
  };
}

export type AgentRequest =
  | Readonly<{operation: 'fs.list' | 'fs.read' | 'fs.stat'; path: string}>
  | Readonly<{operation: 'apply'; input: ApplyInput}>
  | Readonly<{operation: 'result'; requestId: string}>;

export type Artifact = Readonly<{
  name: string;
  mimeType: string;
  base64: string;
}>;
export type AgentResponse =
  | Readonly<{ok: true; data: unknown; artifacts?: readonly Artifact[]}>
  | Readonly<{
      ok: false;
      error: Readonly<{code: string; message: string; details?: unknown}>;
    }>;

export function failure(
  code: string,
  message: string,
  details?: unknown,
): AgentResponse {
  return {
    ok: false,
    error: {code, message, ...(details === undefined ? {} : {details})},
  };
}

export function parseApplyInput(value: unknown): ApplyInput {
  const input = object(
    value,
    ['files', 'cursor', 'render', 'topology'],
    'Apply input',
  );
  let files: FileChange[] | undefined;
  if (input.files !== undefined) {
    if (!Array.isArray(input.files))
      throw new AgentError('invalid_input', 'files must be an array.');
    const paths = new Set<string>();
    files = input.files.map(value => {
      const change = object(
        value,
        ['path', 'version', 'content'],
        'File change',
      );
      const path = projectPath(change.path);
      if (path === '/' || paths.has(path))
        throw new AgentError(
          'invalid_input',
          'Each changed file must have a distinct non-root path.',
        );
      paths.add(path);
      const version =
        change.version === null ? null : string(change.version, 'File version');
      const content =
        change.content === null
          ? null
          : string(change.content, 'File content', true);
      if (version === null && content === null)
        throw new AgentError(
          'invalid_input',
          'Deleting a file requires its current version.',
        );
      return {path, version, content};
    });
  }
  let cursor: AgentCursor | undefined;
  if (input.cursor !== undefined) {
    const source = object(
      input.cursor,
      ['file', 'regex', 'lines', 'flags', 'arguments'],
      'Cursor',
    );
    let lines: readonly [number, number] | undefined;
    if (source.lines !== undefined) {
      if (!Array.isArray(source.lines) || source.lines.length !== 2)
        throw new AgentError(
          'invalid_input',
          'Cursor lines must contain a start and end line.',
        );
      lines = [
        positiveInteger(source.lines[0], 'Start line'),
        positiveInteger(source.lines[1], 'End line'),
      ];
      if (lines[1] < lines[0])
        throw new AgentError('invalid_input', 'Cursor line range is reversed.');
    }
    cursor = {
      file: projectPath(source.file),
      regex: string(source.regex, 'Cursor regex'),
      ...(lines === undefined ? {} : {lines}),
      ...(source.flags === undefined
        ? {}
        : {flags: string(source.flags, 'Regex flags', true)}),
      ...(source.arguments === undefined
        ? {}
        : {arguments: string(source.arguments, 'Function arguments')}),
    };
  }
  const topology =
    input.topology === undefined ? undefined : topologyOptions(input.topology);
  if (
    typeof topology === 'object' &&
    topology.snapshotId &&
    (files?.length || cursor)
  )
    throw new AgentError(
      'invalid_input',
      'Paging an existing snapshot cannot also change files or cursor.',
    );
  return {
    ...(files === undefined ? {} : {files}),
    ...(cursor === undefined ? {} : {cursor}),
    ...(input.render === undefined
      ? {}
      : {render: boolean(input.render, 'render')}),
    ...(topology === undefined ? {} : {topology}),
  };
}

export function parseRequest(value: unknown): AgentRequest {
  const request = object(
    value,
    ['operation', 'path', 'input', 'requestId'],
    'Request',
  );
  switch (request.operation) {
    case 'fs.list':
    case 'fs.read':
    case 'fs.stat':
      object(value, ['operation', 'path'], 'File request');
      return {operation: request.operation, path: projectPath(request.path)};
    case 'apply':
      object(value, ['operation', 'input'], 'Apply request');
      return {operation: 'apply', input: parseApplyInput(request.input)};
    case 'result':
      object(value, ['operation', 'requestId'], 'Result request');
      return {
        operation: 'result',
        requestId: identifier(request.requestId, 'Request ID'),
      };
    default:
      throw new AgentError('invalid_input', 'Unknown agent operation.');
  }
}

export function parseResponse(value: unknown): AgentResponse {
  const response = object(
    value,
    ['ok', 'data', 'artifacts', 'error'],
    'Response',
  );
  if (response.ok === false) {
    object(value, ['ok', 'error'], 'Error response');
    const error = object(
      response.error,
      ['code', 'message', 'details'],
      'Response error',
    );
    return failure(
      string(error.code, 'Error code'),
      string(error.message, 'Error message'),
      error.details,
    );
  }
  if (response.ok !== true || !Object.hasOwn(response, 'data'))
    throw new AgentError(
      'invalid_response',
      'Response must contain a success value and data or an error.',
    );
  object(value, ['ok', 'data', 'artifacts'], 'Success response');
  let artifacts: Artifact[] | undefined;
  if (response.artifacts !== undefined) {
    if (!Array.isArray(response.artifacts))
      throw new AgentError('invalid_response', 'Artifacts must be an array.');
    artifacts = response.artifacts.map(value => {
      const artifact = object(
        value,
        ['name', 'mimeType', 'base64'],
        'Artifact',
      );
      decodeBase64(artifact.base64, 'Artifact data');
      return {
        name: string(artifact.name, 'Artifact name'),
        mimeType: string(artifact.mimeType, 'Artifact MIME type'),
        base64: artifact.base64 as string,
      };
    });
  }
  return {ok: true, data: response.data, ...(artifacts ? {artifacts} : {})};
}
