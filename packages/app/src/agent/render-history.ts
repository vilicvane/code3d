import {action, computed, makeObservable, observableRef} from 'mobx';
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
  constructor() {
    makeObservable<this, 'frames'>(this, {
      frames: observableRef,
      items: computed,
      record: action,
      remove: action,
      clear: action,
    });
  }

  get items(): readonly AgentRender[] {
    return this.frames;
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
  }

  remove(agentId: string): void {
    this.frames = this.frames.filter(frame => frame.agent.id !== agentId);
  }

  clear(): void {
    this.frames = [];
  }
}
