import assert from 'node:assert/strict';
import type {Model} from '@code3d/core';
import {
  createModelSnapshotter as createSnapshotter,
  disposeModelObjects as disposeObjects,
  isModelObject,
  type ModelObject,
} from '@code3d/core/tooling';
import type {ModelObject as SourceModelObject} from '../src/library/runtime.ts';

/** Assert the same author-value boundary used by the project runtime. */
export function modelObject(model: Model | ModelObject): ModelObject {
  assert.ok(isModelObject(model));
  return model;
}

export function createModelSnapshotter() {
  const snapshot = createSnapshotter();
  return (model: Model | ModelObject) => snapshot(modelObject(model));
}

export function disposeModelObjects(
  models: Iterable<Model | ModelObject>,
): void {
  disposeObjects(Array.from(models, modelObject));
}

/** White-box cache/lifecycle assertions use the source's private geometry type. */
export function modelGeometry(model: Model | ModelObject) {
  const geometry = Reflect.get(
    modelObject(model),
    'geometry',
  ) as SourceModelObject['geometry'];
  return defined(geometry);
}

export function defined<T>(value: T | undefined | null): T {
  assert.ok(value !== undefined && value !== null);
  return value;
}
