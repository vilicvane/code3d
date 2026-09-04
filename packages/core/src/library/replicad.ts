import * as replicadModule from 'replicad';
import {modelFromReplicadSolid} from './runtime.js';
import type {SolidModel} from './index.js';
import type {Shape3D} from 'replicad';

export type * from 'replicad';

export type Replicad = Omit<typeof replicadModule, 'getOC' | 'setOC'>;

const {getOC: _getOC, setOC: _setOC, ...authorReplicad} = replicadModule;

/**
 * The Replicad API bound to the OpenCascade runtime owned by code3d. Kernel
 * installation remains a tooling responsibility and is intentionally omitted.
 */
export const replicad: Replicad = Object.freeze(authorReplicad);

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
