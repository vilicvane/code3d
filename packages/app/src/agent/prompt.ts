import type {AgentConfig} from '@code3d/agent';

const docsUrl =
  import.meta.env.VITE_CODE3D_DOCS_URL || 'https://www.code3d.org/docs/';

export function agentPrompt(config: AgentConfig, initial: boolean): string {
  return `${initial ? 'Work on' : 'Continue working on'} the open Code3D project as ${config.name}.

Read the required workflow before starting: ${new URL('agents.md', docsUrl.endsWith('/') ? docsUrl : docsUrl + '/')}

Save this private connection configuration to a local file you choose (replace this agent's previous config if any):

\`\`\`json
${JSON.stringify(config, null, 2)}
\`\`\``;
}
