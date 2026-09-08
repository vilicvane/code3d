import type {Artifact, StoredReceipt} from '@code3d/agent';

export type RenderAgent = Readonly<{id: string; name: string; color: number}>;
export type AgentRender = Readonly<{
  id: string;
  agent: RenderAgent;
  capturedAt: string;
  image: Artifact;
}>;

/** A bounded projection of durable receipts; source and topology never enter the UI history. */
export class AgentRenderHistory {
  private frames: readonly AgentRender[] = [];
  private readonly listeners = new Set<() => void>();
  private notifying = false;

  get items(): readonly AgentRender[] {
    return this.frames;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  record(agent: RenderAgent, receipt: StoredReceipt): void {
    const response = receipt.response;
    if (!response?.ok) return;
    const data = response.data as
      | {
          observation?: {render?: {capturedAt?: string}};
        }
      | undefined;
    const capturedAt = data?.observation?.render?.capturedAt;
    // Older receipts have no capture timestamp: snapshot creation time is not render time.
    if (
      typeof capturedAt !== 'string' ||
      !Number.isFinite(Date.parse(capturedAt))
    )
      return;
    const image = response.artifacts?.find(
      image => image.name === 'render.png' && image.mimeType === 'image/png',
    );
    if (!image) return;
    const id = JSON.stringify([agent.id, receipt.requestId]);
    if (this.frames.some(frame => frame.id === id)) return;
    this.frames = [...this.frames, {id, agent, capturedAt, image}]
      .sort(
        (a, b) =>
          Date.parse(a.capturedAt) - Date.parse(b.capturedAt) ||
          a.id.localeCompare(b.id),
      )
      .slice(-100);
    this.changed();
  }

  remove(agentId: string): void {
    this.frames = this.frames.filter(frame => frame.agent.id !== agentId);
    this.changed();
  }

  clear(): void {
    this.frames = [];
    this.changed();
  }

  private changed(): void {
    if (this.notifying) return;
    this.notifying = true;
    // Presentation runs outside the receipt write, and restored batches render once.
    queueMicrotask(() => {
      this.notifying = false;
      for (const listener of this.listeners) listener();
    });
  }
}
