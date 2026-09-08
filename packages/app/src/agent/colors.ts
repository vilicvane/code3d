/** Indices correspond to the shared agent-color-* palette in style.css. */
export function randomAgentColor(): number {
  return Math.floor(Math.random() * 6);
}
