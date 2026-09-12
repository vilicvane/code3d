import assert from 'node:assert/strict';
import test, {afterEach} from 'node:test';
import * as screws from '@code3d/screws';
import {type Anchor, type Model} from '@code3d/core';
import {modelElementReference} from '@code3d/core/tooling';
import {replicad} from '@code3d/core/replicad';
import {
  disposeModelObjects,
  modelGeometry,
} from '../../core/test/model-test.ts';
import {clearKernelOperationCache} from '../../core/bld/library/kernel-cache.js';

const kept: Model[] = [];
export function keep<T extends Model>(model: T): T {
  kept.push(model);
  return model;
}
export function releaseModels(): void {
  disposeModelObjects(kept.splice(0));
  clearKernelOperationCache();
}
afterEach(releaseModels);
export const near = (a: number, b: number) =>
  assert.ok(Math.abs(a - b) < 1e-5, `${a} != ${b}`);
export const y = (anchor: Anchor) =>
  modelElementReference(anchor)!.transform.position[1];
export const volume = (model: Model) =>
  replicad.measureVolume(modelGeometry(model).value.shape.asShape3D());

const {ISO4029, ISO7379, ...headedStandards} = screws;
export function headedStandardTests(
  names: readonly (keyof typeof headedStandards)[],
): void {
  for (const name of names) {
    const standard = headedStandards[name];
    test(`${name} builds representative sizes with the correct physical and mounting lengths`, () => {
      for (const size of ['M3', 'M6', 'M10'] as const) {
        const spec = standard.resolveSpecification(size);
        const screw = keep(standard.screw(size, 20));
        near(y(screw.headTop) - y(screw.headBottom), spec.headHeight);
        near(y(screw.shankTop), y(screw.headBottom));
        near(
          y(screw.headTop) - y(screw.shankBottom),
          name === 'ISO10642' ? 20 : 20 + spec.headHeight,
        );
        assert.ok(volume(screw) > 0);
        assert.equal(
          modelGeometry(screw).value.shape.asShape3D().isNull,
          false,
        );
        // Release each native graph before moving on to another size.
        disposeModelObjects(kept.splice(0));
        clearKernelOperationCache();
      }
    });
  }
}
