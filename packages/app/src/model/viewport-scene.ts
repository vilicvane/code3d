import {Matrix4, Quaternion, Vector3} from 'three';
import type {ModelSnapshotObject, Transform} from '@code3d/core/tooling';
import type {ModelModule} from './compiler';
import type {ModelPlacement} from '../rendering/model-renderer';

export type ViewportScene = Readonly<{
  key: string;
  /** Map the rendered frame into this scene identity's stored camera frame. */
  frame: Matrix4;
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
    // Frame-only containers preserve one authored value. They should not
    // create a fresh camera identity merely because an inspector retained it.
    const roots = nodes.map(node => {
      let transform = matrix(
        placement === 'composition'
          ? node.compositionTransform
          : node.transform,
      );
      while (
        !this.identities.has(node.nodeId) &&
        !node.sourceNodeId &&
        node.children.length === 1
      ) {
        node = node.children[0];
        transform.multiply(matrix(node.transform));
      }
      return {node, transform};
    });
    const canonicalPlacement = roots.length > 1 ? 'composition' : placement;
    const key = this.key(
      roots.map(root => root.node),
      canonicalPlacement,
    );
    const first = roots.sort((a, b) =>
      (a.node.sourceNodeId ?? a.node.nodeId).localeCompare(
        b.node.sourceNodeId ?? b.node.nodeId,
      ),
    )[0];
    const original = this.module.objects.get(
      first.node.sourceNodeId ?? first.node.nodeId,
    );
    const canonical =
      original &&
      (canonicalPlacement === 'composition'
        ? original.compositionTransform
        : original.transform);
    const frame = canonical
      ? matrix(canonical).multiply(first.transform.clone().invert())
      : new Matrix4();
    return {key, frame, defaults: this.defaults.get(key) ?? []};
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
          nodes.map(node => {
            const id = node.sourceNodeId ?? node.nodeId;
            return this.identities.get(id) ?? id;
          }),
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
