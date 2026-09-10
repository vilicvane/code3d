import {Matrix4, Quaternion, Vector3} from 'three';
import type {ModelSnapshotObject, Transform} from '@code3d/core/tooling';
import type {ModelModule} from './compiler';
import type {ModelPlacement} from '../rendering/model-renderer';

export type ViewportScene = Readonly<{
  key: string;
  defaults: readonly Readonly<{key: string; transform: Matrix4}>[];
}>;

/** Identities belong to displayed root values, never their meshes or emphasis. */
export class ViewportScenes {
  private readonly identities = new Map<string, string>();
  private readonly defaults = new Map<
    string,
    Array<{key: string; transform: Matrix4}>
  >();

  constructor(private readonly module: ModelModule) {
    // A traced operation survives numeric/whitespace edits and distinguishes
    // repeated executions. Catalog occurrences cover imported/returned values.
    for (const entry of module.catalog) {
      for (const occurrence of entry.occurrences) {
        if (!this.identities.has(occurrence.nodeId))
          this.identities.set(occurrence.nodeId, occurrence.id);
      }
    }
    for (const node of module.objects.values()) {
      if (node.operation.siteId)
        this.identities.set(node.nodeId, node.operation.id);
    }
    for (const node of module.objects.values()) {
      if (node.kind !== 'group' || node.children.length === 0) continue;
      const members = node.children.map(child =>
        module.objects.get(child.nodeId)!,
      );
      const collection = this.key(members, 'composition');
      // Group-local origins differ from the coordinate frame of its inputs.
      const collectionFromGroup = matrix(
        members[0].compositionTransform,
      ).multiply(matrix(node.children[0].transform).invert());
      // Only a rigidly corresponding collection can inherit the same camera.
      if (
        !members.every((member, index) => {
          const transform = matrix(member.compositionTransform).multiply(
            matrix(node.children[index].transform).invert(),
          );
          return transform.elements.every(
            (value, i) =>
              Math.abs(value - collectionFromGroup.elements[i]) < 1e-7,
          );
        })
      )
        continue;
      for (const placement of ['standalone', 'composition'] as const) {
        const group = this.key([node], placement);
        const transform = collectionFromGroup
          .clone()
          .multiply(
            matrix(
              placement === 'composition'
                ? node.compositionTransform
                : node.transform,
            ).invert(),
          );
        this.addDefault(collection, group, transform);
        this.addDefault(group, collection, transform.clone().invert());
      }
    }
  }

  scene(
    nodes: readonly ModelSnapshotObject[],
    placement: ModelPlacement,
  ): ViewportScene | undefined {
    if (nodes.length === 0) return undefined;
    const key = this.key(nodes, placement);
    return {key, defaults: this.defaults.get(key) ?? []};
  }

  private key(
    nodes: readonly ModelSnapshotObject[],
    placement: ModelPlacement,
  ): string {
    return JSON.stringify([
      this.module.activeDesignContextId ?? null,
      placement,
      [
        ...new Set(
          nodes.map(node => this.identities.get(node.nodeId) ?? node.nodeId),
        ),
      ].sort(),
    ]);
  }

  private addDefault(key: string, source: string, transform: Matrix4): void {
    const defaults = this.defaults.get(key) ?? [];
    defaults.push({key: source, transform});
    this.defaults.set(key, defaults);
  }
}

function matrix(transform: Transform): Matrix4 {
  return new Matrix4().compose(
    new Vector3(...transform.position),
    new Quaternion(...transform.quaternion),
    new Vector3(1, 1, 1),
  );
}
