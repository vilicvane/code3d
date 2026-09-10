import {
  acceptKernelOperation,
  evaluateCachedArtifact,
  findKernelOperation,
  kernelContentId,
  kernelOperationKey,
  type CacheCodec,
  type KernelArtifact,
  type KernelOperationKey,
  type KernelValueLifecycle,
} from './kernel-cache.js';
import {encodeKernelArtifact} from './kernel-artifact-codec.js';
import {estimateRetainedBytes} from './retained-memory.js';

export type CachedOptions<Value> = CacheCodec<Value>;

const identities = new WeakMap<Function, string>();
const sessionIdentities = new WeakMap<Function, string>();
const session = crypto.randomUUID();
let nextIdentity = 0;

/** The compiler supplies the definition and its static dependency fingerprint. */
export function identifyCachedFunction<Fn extends Function>(
  fn: Fn,
  identity: string,
): Fn {
  // Identity belongs to this cache definition (including its codec), not to
  // every other use of the author's original function object.
  const identified = function (this: unknown, ...args: unknown[]) {
    return Reflect.apply(fn, this, args);
  } as unknown as Fn;
  identities.set(identified, identity);
  return identified;
}

function functionIdentity(fn: Function): {id: string; persistent: boolean} {
  const identity = identities.get(fn);
  if (identity) return {id: identity, persistent: true};
  let id = sessionIdentities.get(fn);
  if (!id) {
    id = `${session}:${nextIdentity++}`;
    sessionIdentities.set(fn, id);
  }
  // Without compiler fingerprints, object identity is the only sound identity
  // for a JavaScript closure. It still shares the process-wide memory budget.
  return {id, persistent: false};
}

const dataLifecycle: KernelValueLifecycle<unknown> = {
  estimateBytes: estimateRetainedBytes,
  retain: value => value,
  instantiate: value => value,
  release() {},
};

/**
 * Memoizes a synchronous, deterministic computation in the shared cache.
 * Pass changing captured state as arguments and treat returned data as immutable.
 * The engine fingerprints definitions and dependencies for persistent reuse.
 * Outside the engine, function identity provides process-local memory reuse.
 * Custom encoder/decoder pairs run only when writing/restoring persistent data;
 * memory hits return the retained value without decoding or copying it.
 */
export function cached<Args extends unknown[], Value>(
  compute: (
    ...args: Args
  ) => Value & (Value extends PromiseLike<unknown> ? never : unknown),
  options?: CachedOptions<Value>,
): (...args: Args) => Value {
  const operation = cachedArtifact(
    (...args: Args): Value => {
      const value = compute(...args);
      if (
        value &&
        typeof value === 'object' &&
        'then' in value &&
        typeof value.then === 'function'
      )
        throw new Error('cached() requires a synchronous computation.');
      return value;
    },
    {identity: compute, codec: options},
  );
  return (...args) => operation(...args).value;
}

/** Internal artifact form also supports native ownership and remote admission. */
export function cachedArtifact<Args extends unknown[], Value>(
  compute: (...args: Args) => Value,
  {
    key,
    lifecycle = dataLifecycle as KernelValueLifecycle<Value>,
    codec,
    identity = compute,
    namespace = 'cached',
  }: {
    key?: (...args: Args) => KernelOperationKey;
    lifecycle?: KernelValueLifecycle<Value>;
    codec?: CacheCodec<Value> | false;
    identity?: Function;
    namespace?: string;
  } = {},
) {
  const definition = functionIdentity(identity);
  const persistence = key || definition.persistent ? codec : false;
  const operationKey =
    key ??
    ((...args: Args) =>
      kernelOperationKey(
        namespace,
        [definition.id, kernelContentId(encodeKernelArtifact('', args))],
        [],
      ));
  const find = (key: KernelOperationKey) =>
    findKernelOperation(key, lifecycle, persistence);
  const accept = (key: KernelOperationKey, value: Value) =>
    acceptKernelOperation(key, lifecycle, value, persistence);
  return Object.assign(
    (...args: Args): KernelArtifact<Value> => {
      return evaluateCachedArtifact(
        operationKey(...args),
        lifecycle,
        () => compute(...args),
        persistence,
      );
    },
    {key: operationKey, find, accept},
  );
}
