import {
  action,
  computed,
  makeObservable,
  observableRef,
  reaction,
  runInAction,
  type IReactionDisposer,
} from 'mobx';
import {
  sketchPointResolver,
  type SketchConstraint,
  type SketchPointAddress,
  type SketchPosition,
  type SketchSnapshot,
} from '@code3d/core/tooling';
import type {SketchDragPreview} from '../model/sketch-drag';
import {
  endpointPosition,
  sameSketchPoint,
  sketchSnapLineConstraints,
  sketchSnapPointConstraints,
  sketchSnapTargets,
  snapSketchPointer,
  type SketchInputGeometry,
  type SketchPoint,
  type SketchSnap,
  type SketchSnapContext,
} from './sketch-snap';

type MoveRequest = Readonly<{
  snap: SketchSnap;
  position: SketchPosition;
  mergeTarget?: SketchPointAddress;
  constraints: readonly SketchConstraint<SketchPointAddress>[];
}>;

export type SketchMoveSolve = (
  id: number,
  position: SketchPosition,
  previous?: SketchDragPreview,
  mergeTarget?: SketchPointAddress,
  constraints?: readonly SketchConstraint<SketchPointAddress>[],
) => Promise<SketchDragPreview>;

/** One gesture owns its input, accepted request and latest valid result.
 * Snap geometry stays at gesture start; solved previews are numeric seeds only. */
export class SketchMoveSession {
  readonly kind = 'move';
  preview?: SketchDragPreview;
  error?: string;
  pending = false;
  released = false;
  private pointer?: SketchPosition;
  private frozen?: MoveRequest;
  private disposed = false;
  private latest?: MoveRequest;
  private completed?: MoveRequest;
  private completion?: Promise<void>;
  private readonly geometry: SketchInputGeometry;
  private readonly targets: Pick<
    SketchSnapContext,
    'points' | 'features' | 'curves'
  >;
  private readonly line?: number;
  private readonly stop: IReactionDisposer;

  constructor(
    readonly target: SketchPoint,
    readonly parameter: 'point' | 'radius',
    private readonly start: SketchPosition,
    layers: readonly SketchSnapshot[],
    referenceable: ReadonlySet<string>,
    private readonly settings: () => Pick<
      SketchSnapContext,
      'enabled' | 'scale' | 'gridStep'
    >,
    private readonly solve: SketchMoveSolve,
  ) {
    const resolve = sketchPointResolver(layers);
    const incident =
      parameter === 'point'
        ? layers
            .at(-1)!
            .entities.filter(
              entity =>
                entity.kind === 'line' &&
                entity.points.some(point =>
                  sameSketchPoint(resolve(point), resolve(target)),
                ),
            )
        : [];
    const line =
      incident.length === 1 && incident[0].kind === 'line'
        ? incident[0]
        : undefined;
    this.line = line?.id;
    const other = line?.points.find(
      point => !sameSketchPoint(resolve(point), resolve(target)),
    );
    const origin =
      other &&
      layers
        .find(layer => layer.id === other.layer)!
        .entities.find(entity => entity.id === other.id);
    this.geometry =
      origin?.kind === 'point'
        ? {kind: 'polar', origin: origin.position, line: true}
        : {kind: 'cartesian'};
    this.targets =
      parameter === 'point'
        ? sketchSnapTargets(layers, target, referenceable)
        : {points: [], features: [], curves: []};
    makeObservable<this, 'pointer' | 'frozen' | 'request'>(this, {
      pointer: observableRef,
      frozen: observableRef,
      released: observableRef,
      preview: observableRef,
      error: observableRef,
      pending: observableRef,
      request: computed,
      snap: computed,
      move: action,
      release: action,
      dispose: action,
    });
    this.stop = reaction(
      () => this.request,
      request => {
        if (request) this.enqueue(request);
      },
    );
  }

  get snap(): SketchSnap | undefined {
    return this.request?.snap;
  }

  private get request(): MoveRequest | undefined {
    if (this.released) return this.frozen;
    if (!this.pointer) return;
    const snap = snapSketchPointer(
      [
        this.target.position[0] + this.pointer[0] - this.start[0],
        this.target.position[1] + this.pointer[1] - this.start[1],
      ],
      this.geometry,
      {...this.targets, ...this.settings()},
    );
    return {
      snap,
      position: endpointPosition(snap.endpoint),
      mergeTarget:
        this.parameter === 'point' && 'point' in snap.endpoint
          ? snap.endpoint.point
          : undefined,
      constraints:
        this.parameter === 'point'
          ? [
              ...sketchSnapPointConstraints(snap.endpoint, this.target),
              ...(this.line === undefined
                ? []
                : sketchSnapLineConstraints(snap.endpoint, this.line)),
            ]
          : [],
    };
  }

  move(pointer: SketchPosition): void {
    if (this.released || this.disposed) return;
    if (
      (this.pointer ?? this.start).every(
        (coordinate, axis) => coordinate === pointer[axis],
      )
    )
      return;
    this.pointer = pointer;
  }

  release(pointer: SketchPosition): Promise<void> {
    if (this.disposed || this.released)
      return this.completion ?? Promise.resolve();
    // A click remains selection even if the canvas moved or resized since
    // pointerdown. Only pointer movement can begin a geometry edit.
    if (this.pointer) this.move(pointer);
    this.frozen = this.request;
    this.released = true;
    this.stop();
    // Release runs in the pointer event's action, before its reactions flush.
    // Queue exactly the frozen input so Alt from this event is authoritative.
    if (this.frozen) this.enqueue(this.frozen);
    return this.completion ?? Promise.resolve();
  }

  dispose(): void {
    this.disposed = true;
    this.stop();
    this.latest = undefined;
    this.pending = false;
  }

  private enqueue(request: MoveRequest): void {
    if (this.disposed || request === this.latest) return;
    this.latest = request;
    this.pending = true;
    if (this.completion) return;
    let complete!: () => void;
    let fail!: (error: unknown) => void;
    this.completion = new Promise<void>((resolve, reject) => {
      complete = resolve;
      fail = reject;
    });
    void this.drain().then(complete, fail);
  }

  private async drain(): Promise<void> {
    try {
      while (!this.disposed && this.latest !== this.completed) {
        const request = this.latest!;
        try {
          const preview = await this.solve(
            this.target.id,
            request.position,
            this.preview,
            request.mergeTarget,
            request.constraints,
          );
          if (this.disposed) return;
          if (request !== this.latest) continue;
          runInAction(() => {
            this.preview = preview;
            this.error = undefined;
          });
        } catch (error) {
          if (this.disposed) return;
          if (request !== this.latest) continue;
          runInAction(() => {
            this.error = error instanceof Error ? error.message : String(error);
          });
        }
        this.completed = request;
      }
    } finally {
      // Relinquish the drain before its promise settles: a request arriving in
      // the next microtask must be able to start a fresh drain immediately.
      runInAction(() => {
        this.completion = undefined;
        this.pending = false;
      });
    }
  }
}
