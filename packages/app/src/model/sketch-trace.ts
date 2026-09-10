import type * as CoreTooling from '@code3d/core/tooling';
import type {
  Sketch,
  SketchSnapshot,
  SourceRef,
  Transform,
} from '@code3d/core/tooling';
import type {SketchGeometryData} from './sketch-drag';
import type {SketchSourceSites} from './sketch-source';

export type CompiledSketch = SketchSnapshot &
  Readonly<{
    evaluationId?: string;
    callRef?: SourceRef;
    definitionRef?: SourceRef;
    references: Readonly<Record<string, string>>;
    data: readonly SketchGeometryData[];
    /** Same geometry evaluation can be used by several immutable spatial values. */
    geometryId: string;
    frameNodeId: string;
    context: readonly Readonly<{nodeId: string; transform: Transform}>[];
  }>;

type SketchTrace = {
  id: string;
  evaluationId?: string;
  callRef?: SourceRef;
  definitionRef?: SourceRef;
  references: Map<Sketch, string>;
  geometryId?: string;
};

/** Source identity is evaluation-local; authored entity IDs remain layer-local. */
export class SketchTraceRegistry {
  private readonly values = new Map<Sketch, SketchTrace>();
  private readonly completedCalls = new Set<Sketch>();
  private readonly bindings = new Map<string, Set<Sketch>>();
  private calls: SketchSourceSites = new Map();

  constructor(private readonly runtime: typeof CoreTooling) {}

  begin(calls: SketchSourceSites): void {
    this.clear();
    this.calls = calls;
  }

  clear(): void {
    this.values.clear();
    this.completedCalls.clear();
    this.bindings.clear();
    this.calls = new Map();
  }

  get size(): number {
    return this.values.size;
  }

  frames() {
    return [...this.values.keys()].map(value =>
      this.runtime.sketchFrame(value),
    );
  }

  constraintErrorSource(
    error: unknown,
    location: SourceRef,
  ): SourceRef | undefined {
    if (!(error instanceof this.runtime.SketchConstraintError)) return;
    const constraints = this.calls.get(sourceKey(location))?.constraints;
    if (!constraints) return;
    const refs = error.constraints.flatMap(index =>
      constraints.elements[index] ? [constraints.elements[index]] : [],
    );
    return refs.length
      ? {
          ...refs[0],
          start: Math.min(...refs.map(ref => ref.start)),
          end: Math.max(...refs.map(ref => ref.end)),
        }
      : constraints.sourceRef;
  }

  identity(value: Sketch): string {
    let trace = this.values.get(value);
    if (!trace) {
      trace = {
        id: `sketch:untraced:${this.values.size}`,
        references: new Map(),
      };
      this.values.set(value, trace);
      const {base} = this.runtime.sketchDefinition(value);
      if (base) this.identity(base);
      const source = this.runtime.sketchSource(value);
      if (source) this.identity(source);
    }
    return trace.id;
  }

  bind(value: unknown, location: SourceRef): void {
    if (!this.runtime.isSketch(value)) return;
    const key = sourceKey(location);
    const values = this.bindings.get(key) ?? new Set();
    values.add(value);
    this.bindings.set(key, values);
    this.identity(value);
  }

  call(
    value: unknown,
    id: string,
    location: SourceRef,
    argument: unknown,
    options: unknown,
    receiver: unknown,
  ): void {
    if (!this.runtime.isSketch(value) || this.completedCalls.has(value)) return;
    this.completedCalls.add(value);
    const source = this.runtime.sketchSource(value);
    if (source) {
      this.identity(source);
      const original = this.values.get(source)!;
      this.values.set(value, {
        ...original,
        id: `sketch:${id}`,
        geometryId: original.geometryId ?? original.id,
      });
      return;
    }
    const definition = this.runtime.sketchDefinition(value);
    const call = this.calls.get(sourceKey(location));
    const editable =
      call &&
      definition.input === argument &&
      definition.inputOptions === options;
    const trace: SketchTrace = {
      id: `sketch:${id}`,
      evaluationId: id,
      callRef: location,
      definitionRef: editable ? call.definitionRef : undefined,
      references: new Map(),
    };
    this.values.set(value, trace);
    const ancestors = new Set<Sketch>();
    for (
      let base = definition.base;
      base;
      base = this.runtime.sketchDefinition(base).base
    ) {
      ancestors.add(base);
      this.identity(base);
    }
    if (!call) return;
    // Only use stable lexical bindings whose observed value is unambiguous.
    for (const {name, binding} of call.bindings) {
      const values = this.bindings.get(binding);
      if (values?.size !== 1) continue;
      const upstream = [...values][0];
      const ancestor = [...ancestors].find(
        base =>
          this.runtime.sketchDefinition(base) ===
          this.runtime.sketchDefinition(upstream),
      );
      if (ancestor) trace.references.set(ancestor, name);
    }
    // The evaluated receiver proves a stable name denotes the actual base,
    // including function parameters and repeated factory executions. A written
    // binding is not safe: argument evaluation itself can reassign it.
    if (definition.base === receiver && call.receiver) {
      trace.references.set(definition.base!, call.receiver);
    }
  }

  snapshots(): ReadonlyMap<string, CompiledSketch> {
    return new Map(
      [...this.values].map(([value, trace]) => [
        trace.id,
        {
          ...this.runtime.snapshotSketch(value, sketch =>
            this.identity(sketch),
          ),
          definitionRef: trace.definitionRef,
          evaluationId: trace.evaluationId,
          callRef: trace.callRef,
          references: Object.fromEntries(
            [...trace.references].map(([value, name]) => [
              this.identity(value),
              name,
            ]),
          ),
          geometryId: trace.geometryId ?? trace.id,
          frameNodeId: this.runtime.sketchFrame(value).nodeId,
          context: this.runtime.sketchFrame(value).context(),
          data: this.runtime
            .sketchDefinition(value)
            .entries.flatMap<SketchGeometryData>(([kind, id, data]) =>
              kind === 'point' && Array.isArray(data)
                ? [{id, parameters: data}]
                : kind === 'circle' || kind === 'arc'
                  ? [{id, parameters: [data[1]]}]
                  : [],
            ),
        },
      ]),
    );
  }
}

function sourceKey(ref: SourceRef): string {
  return `${ref.file}:${ref.start}:${ref.end}`;
}
