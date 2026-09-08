/** Shared cancellation requires isolation for both the App document and its Workers. */
export const appIsolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export function appIsolationRules(path: string): string {
  return `${path}\n${Object.entries(appIsolationHeaders)
    .map(([name, value]) => `  ${name}: ${value}`)
    .join('\n')}\n`;
}
