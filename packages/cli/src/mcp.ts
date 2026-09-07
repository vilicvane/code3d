import {randomUUID} from 'node:crypto';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import type {CallToolResult} from '@modelcontextprotocol/sdk/types.js';
import {z} from 'zod';
import {
  AgentClient,
  AgentError,
  maxMessageBytes,
  parseRequest,
  renderViewNames,
  type AgentConfig,
  type AgentResponse,
} from '@code3d/agent';
import {createLocalBridge} from './bridge.js';

const requestId = z
  .string()
  .regex(/^[a-zA-Z0-9_-]{1,128}$/)
  .describe(
    'Unique operation ID chosen before calling. Reuse it only for identical retries; query result after an uncertain outcome.',
  );
const path = z
  .string()
  .describe('Absolute path in the project owned by the Code3D App.');
const vector = z.tuple([z.number(), z.number(), z.number()]);
const topologyId = z.union([
  z.number().int().positive(),
  z.array(z.number().int().positive()).min(2).max(32),
]);
const applySchema = z
  .object({
    requestId,
    files: z
      .array(
        z
          .object({
            path,
            version: z.string().nullable(),
            content: z.string().nullable(),
          })
          .strict(),
      )
      .optional()
      .describe(
        'Full file replacements. version:null creates; content:null deletes. Read current versions first.',
      ),
    cursor: z
      .object({
        file: path,
        regex: z.string(),
        lines: z
          .tuple([z.number().int().positive(), z.number().int().positive()])
          .optional(),
        flags: z.string().optional(),
        arguments: z.string().optional(),
      })
      .strict()
      .optional()
      .describe(
        'Exactly one capturing group selects the target; complete regex match must be unique in the optional inclusive line range. arguments is a TypeScript array expression; omission falls back to JSDoc.',
      ),
    render: z
      .union([
        z.boolean(),
        z
          .object({
            view: z
              .union([
                z.enum(renderViewNames),
                z.object({direction: vector, up: vector.optional()}).strict(),
              ])
              .optional(),
          })
          .strict(),
      ])
      .optional()
      .describe(
        'Return an image directly. Named or custom view changes only the agent image.',
      ),
    type: z
      .boolean()
      .optional()
      .describe(
        'Return the selected expression’s static TypeScript type without executing the model.',
      ),
    topology: z
      .union([
        z.boolean(),
        z
          .object({
            snapshotId: z.string().optional(),
            model: z.string().optional(),
            kind: z.enum(['vertex', 'edge', 'surface']).optional(),
            ids: z.array(topologyId).min(1).max(200).optional(),
            offset: z.number().int().nonnegative().optional(),
            limit: z.number().int().min(1).max(200).optional(),
          })
          .strict(),
      ])
      .optional(),
  })
  .strict();

/** MCP carries model-visible images; the domain response and receipt remain unchanged. */
export function mcpResult(id: string, response: AgentResponse): CallToolResult {
  const artifacts = response.ok ? response.artifacts : undefined;
  const result = response.ok
    ? {
        requestId: id,
        ok: true,
        data: response.data,
        ...(artifacts
          ? {artifacts: artifacts.map(({name, mimeType}) => ({name, mimeType}))}
          : {}),
      }
    : {requestId: id, ...response};
  const content: CallToolResult['content'] = [
    {type: 'text', text: JSON.stringify(result)},
  ];
  for (const [index, artifact] of (artifacts ?? []).entries()) {
    const data = Buffer.from(artifact.base64, 'base64url').toString('base64');
    if (['image/png', 'image/jpeg', 'image/webp'].includes(artifact.mimeType))
      content.push({type: 'image', data, mimeType: artifact.mimeType});
    else
      content.push({
        type: 'resource',
        resource: {
          uri: `code3d://artifacts/${id}/${index}`,
          mimeType: artifact.mimeType,
          blob: data,
        },
      });
  }
  return {content, ...(response.ok ? {} : {isError: true})};
}

export async function runMcp(
  config: AgentConfig,
  version: string,
): Promise<void> {
  const bridge = await createLocalBridge(config);
  const client = await AgentClient.create(config);
  const server = new McpServer(
    {name: 'code3d', version},
    {
      instructions: `You are ${config.name}. The Code3D App owns the project. Start with context, then fs_read. Modify files only through apply using full contents and current versions. Supply your own stable requestId for every apply, and query result after an uncertain response. Keep the App open and permit its local-network connection. Prefer public @code3d/core topology and modeling APIs; read https://www.code3d.org/docs/reference/core/.`,
    },
  );
  const invoke = async (
    request: unknown,
    signal: AbortSignal,
    id: string = randomUUID(),
  ): Promise<CallToolResult> => {
    try {
      const result = await client.request(parseRequest(request), {
        requestId: id,
        signal,
      });
      return mcpResult(result.requestId, result.response);
    } catch (error) {
      return mcpResult(id, {
        ok: false,
        error: {
          code: error instanceof AgentError ? error.code : 'tool_failed',
          message:
            error instanceof AgentError
              ? error.message
              : 'Code3D tool failed. The result is not confirmed; query its request ID before another mutation.',
        },
      });
    }
  };
  server.registerTool(
    'context',
    {
      description:
        'Read the current App file and user selection without moving cursors or running a model. Start here, then read the returned file.',
      inputSchema: z.object({}).strict(),
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (_, extra) => invoke({operation: 'context'}, extra.signal),
  );
  for (const operation of ['list', 'read', 'stat'] as const)
    server.registerTool(
      `fs_${operation}`,
      {
        description: `${operation === 'list' ? 'List files in a project directory.' : operation === 'read' ? 'Read a project file, including its current content and version for apply.' : 'Read project file or directory metadata.'} Paths belong to the App project, not the local machine.`,
        inputSchema: z.object({path}).strict(),
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async (args, extra) =>
        invoke({operation: `fs.${operation}`, path: args.path}, extra.signal),
    );
  server.registerTool(
    'apply',
    {
      description:
        'Atomically check and accept full file contents and/or move your independent cursor. Default confirms saving; optional render returns images, topology returns model structure, and type returns static types. A model error does not undo accepted files. Keep requestId for recovery; retry only identical input with the same ID.',
      inputSchema: applySchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({requestId, ...input}, extra) =>
      invoke({operation: 'apply', input}, extra.signal, requestId),
  );
  server.registerTool(
    'result',
    {
      description:
        'Recover a previous request without executing it again. pending or unknown is not evidence that a file change did not happen.',
      inputSchema: z.object({requestId}).strict(),
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args, extra) =>
      invoke({operation: 'result', requestId: args.requestId}, extra.signal),
  );
  const transport = new StdioServerTransport(process.stdin, process.stdout, {
    maxBufferSize: maxMessageBytes + 64 * 1024,
  });
  let finish!: () => void;
  const finished = new Promise<void>(resolve => {
    finish = resolve;
  });
  server.server.onclose = finish;
  server.server.onerror = () => {
    process.stderr.write('Code3D MCP protocol error.\n');
  };
  process.once('SIGINT', finish);
  process.once('SIGTERM', finish);
  process.stdin.once('end', finish);
  try {
    await server.connect(transport);
    process.stderr.write(
      `Code3D MCP listening on 127.0.0.1:${config.port}; waiting for the App.\n`,
    );
    if (process.stdin.readableEnded) finish();
    await finished;
  } finally {
    process.off('SIGINT', finish);
    process.off('SIGTERM', finish);
    process.stdin.off('end', finish);
    await server.close();
    await bridge.close();
    process.stdin.pause();
  }
}
