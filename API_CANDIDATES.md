# code3d API candidates

This file preserves the alternatives considered for the public API and records
which one, if any, has been selected. Unselected alternatives are not
compatibility commitments or implementation requirements.

The examples use `offset(x, y, z)` as the relation adjustment primitive rather
than axis-specific method names. A stable call shape gives source tooling one
callee and three addressable parameter slots for inspection and editing.

## Candidate A: constrained combinators

Status: preserved alternative.

`Model` and `Anchor` are both fundamental abstractions. A model is not reduced
to an anchor; it happens to be usable as one through its intrinsic local
reference. Anchors derived from a model, such as `bottom`, continue to refer to
that model within a composition scope.

Boolean operations are standalone combinators. Their `where` clause binds each
operand within that composition and returns one or more constraints:

```ts
const base = union(plate, boss).where((plate, boss) =>
  boss.bottom.on(plate.top),
);
```

An anchor relation returns a constraint, not the model that owns the anchor:

```text
primitive()        -> Model (also usable as Anchor)
model.bottom       -> Anchor
anchor.on(anchor)  -> Constraint
union(...).where() -> Model (also usable as Anchor)
```

Composition-local bindings distinguish repeated uses of the same model without
making `Occurrence` part of the author-facing API:

```ts
const base = union(plate, boss, boss).where((plate, leftBoss, rightBoss) => [
  leftBoss.bottom.on(plate.top).offset(-24, 0, 0),
  rightBoss.bottom.on(plate.top).offset(24, 0, 0),
]);
```

The constraint vocabulary may grow from anchor-specific readable relations,
such as `on`, `at`, and `alignedWith`, toward typed point, axis, plane, distance,
and angle constraints. Relation chaining modifies the constraint expression;
it does not return or mutate an owning model.

### Unresolved

- Whether `where` is the right spelling and whether its callback should always
  be required.
- The exact intrinsic anchor exposed by each model.
- Whether common relations such as `on` fully determine a transform or leave
  degrees of freedom for further constraints and GUI manipulation.
- How under-constrained and conflicting systems are represented and diagnosed.
- How far the initial implementation should go beyond directly solvable rigid
  relations toward a general constraint solver.

## Candidate B: related model copies

Status: selected for the first prototype slice.

`relate` is a core immutable operation on `Model`. It creates a new model value
that reuses the source geometry, has its own model identity, and carries the
constraints returned for that new value:

```ts
const leftBoss = boss.relate(left =>
  left.bottom.on(plate.top).offset(-24, 0, 0),
);

const rightBoss = boss.relate(right =>
  right.bottom.on(plate.top).offset(24, 0, 0),
);

const base = union([plate, leftBoss, rightBoss]);
```

The callback parameter denotes the newly created copy, not the source model.
Anchor relations still return constraints; `relate` is the operation that
returns a model:

```text
model.relate(constraints) -> Model
anchor.on(anchor)         -> Constraint
union(models)             -> Model
cut(models)               -> Model
```

`relate` does not solve or assign an absolute transform. Constraints are stored
across the immutable model values that introduce them. An operation or renderer
collects the relevant dependency closure, solves and validates the combined
constraint system when concrete geometry is required, and leaves every source
model unchanged.

Because constraints travel with their related model values, the same relation
can remain useful across multiple operations:

```ts
const mountedBoss = boss.relate(boss => boss.bottom.on(plate.top));
const body = union([plate, mountedBoss]);

const hole = drill.relate(hole => hole.axis.alignedWith(mountedBoss.axis));
const result = cut([body, hole]);
```

Composition is an internal runtime solve context in this candidate, not a
separate author-facing value.

The first implementation treats `on()` as an exact relation between complete
local frames, so one relation determines a rigid transform. It supports
canonical model-origin, center, top, bottom, and axis anchors; `top` and
`bottom` are currently derived from the local bounds rather than persistent
topological face identity. More general partial constraints remain open.
Calling `relate()` on an already related model retains its constraints and
appends the new ones; all constraints on that value must resolve to the same
rigid transform.

### Unresolved

- How a Boolean result retains operand anchors and constraint provenance for
  later operations without making its geometry context-dependent.
- The semantics of passing the exact same related model value to an operation
  more than once, as opposed to creating multiple values with `relate`.
