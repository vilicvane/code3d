import * as replicadModule from 'replicad';
import {primitiveConstructor} from './runtime.js';
import {castOwnedShape} from './kernel-shapes.js';
import type {SolidModel} from './index.js';
import type {Shape3D} from 'replicad';

export type * from 'replicad';

export type Replicad = Omit<typeof replicadModule, 'getOC' | 'setOC'>;

const {
  getOC: _getOC,
  setOC: _setOC,
  deserializeShape: _deserializeShape,
  ...authorReplicad
} = replicadModule;

/**
 * The Replicad API bound to the OpenCascade runtime owned by code3d. Kernel
 * installation remains a tooling responsibility and is intentionally omitted.
 */
export const replicad: Replicad = Object.freeze({
  ...authorReplicad,
  deserializeShape(data: string) {
    // The native reader owns a raw shape; casting acquires another handle.
    return castOwnedShape(replicadModule.getOC().BRepToolsWrapper.Read(data));
  },
});

/**
 * Defines a synchronous model constructor with the builder's parameters.
 * Reuses deterministic geometry by arguments; pass changing captured state as
 * explicit parameters. Each invocation creates a fresh model. The builder
 * transfers its returned solid to code3d and owns its intermediate shapes.
 */
export function definePrimitive<
  Builder extends (...arguments_: never[]) => Shape3D,
>(build: Builder): (...arguments_: Parameters<Builder>) => SolidModel {
  return primitiveConstructor(build);
}
