import * as replicadModule from 'replicad';
import {modelFromReplicadSolid} from './runtime.js';
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
 * The builder runs on every call and transfers ownership of its returned solid
 * to code3d. Intermediate shapes remain the builder's responsibility.
 */
export function definePrimitive<
  Builder extends (...arguments_: never[]) => Shape3D,
>(build: Builder): (...arguments_: Parameters<Builder>) => SolidModel {
  return (...arguments_: Parameters<Builder>) =>
    modelFromReplicadSolid(build(...arguments_));
}
