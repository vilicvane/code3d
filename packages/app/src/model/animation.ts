import {action, makeObservable, observableRef, runInAction} from 'mobx';

type AnimationClock = Readonly<{
  now(): number;
  request(callback: () => void): number;
  cancel(frame: number): void;
}>;

/** A single execution lane, with time measured from the last accepted frame. */
export class ModelAnimation {
  time = 0;
  playing = false;
  pending = false;
  private generation = 0;
  private frame?: number;
  private resetPending = false;
  private startedAt = 0;
  private startedTime = 0;

  private readonly evaluate: (time: number) => Promise<boolean>;
  private readonly clock: AnimationClock;

  constructor(
    evaluate: (time: number) => Promise<boolean>,
    clock: AnimationClock = {
      now: () => performance.now(),
      request: callback => requestAnimationFrame(callback),
      cancel: frame => cancelAnimationFrame(frame),
    },
  ) {
    this.evaluate = evaluate;
    this.clock = clock;
    makeObservable(this, {
      time: observableRef,
      playing: observableRef,
      pending: observableRef,
      play: action,
      pause: action,
      reset: action,
      stop: action,
    });
  }

  play(): void {
    if (this.playing || this.pending) return;
    this.playing = true;
    this.startedAt = this.clock.now();
    this.startedTime = this.time;
    this.schedule();
  }

  pause(): void {
    this.playing = false;
    if (this.frame !== undefined) this.clock.cancel(this.frame);
    this.frame = undefined;
  }

  reset(): void {
    this.pause();
    if (this.pending) this.resetPending = true;
    else void this.advance(0);
  }

  /** Source changes invalidate pending playback; a new file starts at zero. */
  stop(resetTime = false): void {
    this.pause();
    this.generation++;
    this.resetPending = false;
    if (resetTime) this.time = 0;
  }

  private schedule(): void {
    this.frame = this.clock.request(() => {
      this.frame = undefined;
      void this.advance(
        this.startedTime + (this.clock.now() - this.startedAt) / 1000,
      );
    });
  }

  private async advance(time: number): Promise<void> {
    const generation = this.generation;
    runInAction(() => {
      this.pending = true;
    });
    try {
      const accepted = await this.evaluate(time);
      runInAction(() => {
        if (generation !== this.generation) return;
        if (accepted) this.time = time;
        else this.pause();
      });
    } catch {
      // The evaluation owner presents the diagnostic and keeps its last good view.
      if (generation === this.generation) this.pause();
    } finally {
      runInAction(() => {
        this.pending = false;
        if (this.resetPending) {
          this.resetPending = false;
          void this.advance(0);
        } else if (this.playing) this.schedule();
      });
    }
  }
}
