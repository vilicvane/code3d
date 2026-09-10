import type {AgentConfig} from '@code3d/agent';

const docsUrl =
  import.meta.env.VITE_CODE3D_DOCS_URL || 'https://www.code3d.org/docs/';

export function agentPrompt(config: AgentConfig, initial: boolean): string {
  return `${initial ? 'Work on' : 'Continue working on'} the open Code3D project as ${config.name}. Read the agent guide first: ${new URL('agents.md', docsUrl.endsWith('/') ? docsUrl : docsUrl + '/')}

Save this private JSON to a file you choose (replace the existing config for this agent, if any):

\`\`\`json
${JSON.stringify(config, null, 2)}
\`\`\`

Using Node.js 24+, start the following with your current session's managed process tool, keeping stdin or a PTY open until the session ends:

\`\`\`sh
npx --yes @code3d/cli /absolute/path/to/project.c3d.json serve
\`\`\`

Use your saved file's path. Reuse a running service with this configuration; restart only that process if the configuration changed. Do not detach it, use nohup, or restart the agent session. Keep the Code3D page open and allow its local-network connection.

Get live context with a separate command:

\`\`\`sh
echo '{"operation":"context"}' | npx --yes @code3d/cli /absolute/path/to/project.c3d.json
\`\`\`

Read and modify the App project only through this CLI. Follow the guide for file versions, apply, readable core API modeling, rendering and recovery after an uncertain result.`;
}
