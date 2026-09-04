# R-024 Cache OpenCascade operation results

## Request

- Reuse OpenCascade results across repeated model evaluations without adding
  operation-specific caches or restricting ordinary JavaScript/TypeScript
  authoring.
- Treat a complete kernel operation as the cache boundary: its operation
  identity, scalar arguments, and input artifact identities determine an
  opaque output artifact.
- Let unchanged linear prefixes reuse every prior artifact, while the same
  mechanism also reuses unchanged branches and shared inputs.

## Confirmed direction

- Keep source evaluation and runtime tracing fresh on every compile. Only
  OpenCascade-backed geometry and queries are reusable; source refs, runtime
  node IDs, operation IDs, parameters, names, and colors are not cached.
- Give every cached geometry result a content-derived identity. Downstream
  operation keys refer to these identities rather than transient OpenCascade
  pointers or hashes.
- Cache complete operation results at a stable code3d/Replicad boundary, not
  individual stateful Embind calls such as builder construction, `Add`,
  `Build`, `Shape`, or `Modified`.
- Preserve value semantics and explicit ownership. A cache owns its retained
  OpenCascade values; each model evaluation receives independently disposable
  handles or copies.
- Include the topology information needed by downstream code3d operations in
  the opaque cached result. Cache hits and misses must produce identical public
  edge IDs and operation-context geometry.
- Bound retained kernel resources and delete evicted values. Installing a new
  OpenCascade instance invalidates values owned by the previous instance.

## Adjustable implementation choices

The implementation should follow evidence rather than freeze unverified
mechanics. Cache-key encoding, entry limits, exact operation grouping, mesh
reuse, instrumentation, and whether a later cache survives worker replacement
remain adjustable as long as the confirmed direction and observable semantics
above are preserved.

Unexpected local implementation constraints may be resolved within that
direction. A change to the cache boundary, source-evaluation semantics,
OpenCascade ownership model, or general operation-level reuse direction
requires renewed design discussion.

## Verification

- Repeated evaluation of the same representative model produces equivalent
  snapshots and source/runtime metadata while avoiding repeated expensive
  kernel work.
- Changing an upstream operation invalidates only the affected result and its
  downstream dependants; independent and unchanged prefixes remain reusable.
- Boolean, edge-modification, transformation, primitive, region, topology, and
  meshing paths retain their current behavior on cache hits.
- Cache eviction and OpenCascade replacement release retained shapes without
  invalidating shapes owned by an active model evaluation.
- Production builds and host-browser measurements cover both cold and warm
  compilation of the metric-fastener example.

## Implemented architecture

- One internal content-addressed LRU evaluates every cacheable kernel operation
  through the same operation/arguments/input-artifacts contract. Fixed-length
  content IDs keep long operation chains compact, and retained values carry
  operation signatures so a resident identity collision cannot return the
  wrong artifact.
- Solid model geometry is one opaque artifact containing the OpenCascade shape,
  stable edge topology, and local bounds. Model copies continue to share their
  per-evaluation geometry, while the cache retains a separate shape and
  instantiates a disposable clone for every hit.
- Primitive construction, scale, fillet, chamfer, relative-frame transforms,
  each Boolean prefix, Boolean intersection/section regions, and render meshes
  use the common cache. JavaScript evaluation and all runtime/source metadata
  remain fresh.
- The cache is bounded by an adjustable LRU entry limit. Eviction deletes
  retained OpenCascade shapes, and installing a kernel clears the previous
  instance's cache before replacement.
- Core has permanent tests for independent cache values, linear-prefix reuse,
  downstream invalidation, bounded retention, eviction, and explicit clearing.

## Verified results

- The metric-fastener render model produced identical geometry/mesh digests,
  object counts, operation counts, and source-target counts across cold and
  cached evaluations. Direct evaluation improved from about 2.70 seconds to
  5–7 milliseconds; compiler-worker round trips improved from about 2.97
  seconds to 9–10 milliseconds.
- Changing only the plate width reused 47 of 57 kernel operations and recomputed
  10 affected operations in about 65 milliseconds. A source-only color change
  reused all 57 operations in about 6 milliseconds, and returning to the prior
  geometry also reused all entries.
- The default 74-object project retained 102 entries, compiled in about 2.73
  seconds cold and 24 milliseconds warm, and produced identical geometry,
  topology groups, and normalized runtime/source metadata.
- Twenty consecutive warm metric-fastener evaluations averaged 4 milliseconds
  with all 1,140 expected operations hitting the same stable 57-entry cache.
