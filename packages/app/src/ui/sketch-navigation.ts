import {action, computed, makeObservable, observableRef} from 'mobx';
import type {SketchPosition} from '@code3d/core/tooling';
import {gridStep} from '../grid-scale';

export type SketchPose = Readonly<{center: SketchPosition; scale: number}>;

type AnimationClock = Readonly<{
  now(): number;
  requestFrame(callback: (time: number) => void): number;
  cancelFrame(id: number): void;
  reducedMotion(): boolean;
}>;

const browserClock: AnimationClock = {
  now: () => performance.now(),
  requestFrame: callback => requestAnimationFrame(callback),
  cancelFrame: id => cancelAnimationFrame(id),
  reducedMotion: () =>
    window.matchMedia('(prefers-reduced-motion: reduce)').matches,
};

/** Session-local views belong to sketch executions, independently of geometry revisions. */
export class SketchNavigation {
  private current: SketchPose = {center: [0, 0], scale: 6};
  private activeKey?: string;
  private readonly views = new Map<string, SketchPose>();
  private transition?: Readonly<{
    from: SketchPose;
    to: SketchPose;
    startedAt: number;
  }>;
  private frame?: number;

  constructor(private readonly clock: AnimationClock = browserClock) {
    makeObservable<this, 'current' | 'activeKey' | 'advance'>(this, {
      current: observableRef,
      activeKey: observableRef,
      pose: computed,
      gridStep: computed,
      activate: action,
      hide: action,
      reset: action,
      fit: action,
      interrupt: action,
      zoom: action,
      pan: action,
      advance: action,
    });
  }

  get pose(): SketchPose {
    return this.current;
  }

  get gridStep(): number | undefined {
    return this.activeKey === undefined
      ? undefined
      : gridStep(this.current.scale);
  }

  activate(key: string, initial: SketchPose): void {
    if (key === this.activeKey) return;
    const animate = this.activeKey !== undefined;
    this.remember();
    this.stop();
    this.activeKey = key;
    this.moveTo(this.views.get(key) ?? initial, animate);
  }

  hide(): void {
    this.remember();
    this.stop();
    this.activeKey = undefined;
  }

  reset(): void {
    this.hide();
    this.views.clear();
    this.current = {center: [0, 0], scale: 6};
  }

  fit(pose: SketchPose): void {
    this.stop();
    this.moveTo(pose, true);
  }

  /** Input takes over the last displayed pose, without jumping to the destination. */
  interrupt(): void {
    this.stop();
  }

  zoom(factor: number, anchor: SketchPosition): void {
    this.interrupt();
    const {center, scale} = this.current;
    this.current = {
      center: [
        anchor[0] + (center[0] - anchor[0]) / factor,
        anchor[1] + (center[1] - anchor[1]) / factor,
      ],
      scale: scale * factor,
    };
  }

  pan(center: SketchPosition): void {
    this.interrupt();
    this.current = {center, scale: this.current.scale};
  }

  private remember(): void {
    if (this.activeKey !== undefined)
      this.views.set(this.activeKey, this.transition?.to ?? this.current);
  }

  private stop(): void {
    if (this.frame !== undefined) this.clock.cancelFrame(this.frame);
    this.frame = undefined;
    this.transition = undefined;
  }

  private moveTo(to: SketchPose, animate: boolean): void {
    const from = this.current;
    if (
      !animate ||
      this.clock.reducedMotion() ||
      (from.center[0] === to.center[0] &&
        from.center[1] === to.center[1] &&
        from.scale === to.scale)
    ) {
      this.current = to;
      return;
    }
    this.transition = {from, to, startedAt: this.clock.now()};
    this.frame = this.clock.requestFrame(time => this.advance(time));
  }

  private advance(time: number): void {
    this.frame = undefined;
    const {from, to, startedAt} = this.transition!;
    const t = this.clock.reducedMotion()
      ? 1
      : Math.min((time - startedAt) / 300, 1);
    const eased = t * t * (3 - 2 * t);
    if (t === 1) {
      this.current = to;
      this.transition = undefined;
    } else {
      this.current = {
        center: [
          from.center[0] + (to.center[0] - from.center[0]) * eased,
          from.center[1] + (to.center[1] - from.center[1]) * eased,
        ],
        scale: from.scale * Math.exp(Math.log(to.scale / from.scale) * eased),
      };
      this.frame = this.clock.requestFrame(next => this.advance(next));
    }
  }
}
