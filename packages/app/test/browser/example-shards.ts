// Rounded seconds from the successful CI run on 32a109a (2026-09-19),
// run 35409955789. Unknown examples start at the measured median (~60 s).
const exampleSeconds: Record<string, number> = {
  'iso-screws.ts': 254,
  'gb-screws.ts': 246,
  'projects/desktop-controller/enclosure.ts': 103,
  'projects/desktop-controller/panel.ts': 90,
  'projects/desktop-controller/model.ts': 206,
  'projects/phone-stand.ts': 74,
  'assemblies/screw-box/model.ts': 327,
  'assemblies/screw-box/box.ts': 222,
  'assemblies/screw-box/lid.ts': 221,
  'constraints/combined-constraints.ts': 59,
  'constraints/transformations.ts': 53,
  'materials.ts': 63,
  'primitives/primitives.ts': 58,
  'operations/cut.ts': 53,
  'operations/group.ts': 49,
  'operations/union.ts': 52,
  'operations/distance.ts': 53,
  'operations/origin.ts': 51,
  'operations/rotate.ts': 51,
  'operations/intersect.ts': 79,
  'topology-paths.ts': 43,
  'text.ts': 76,
  'annotations.ts': 54,
  'constraints/relate.ts': 52,
  'operations/loft.ts': 62,
  'operations/shell.ts': 56,
  'expose.ts': 49,
  'primitives/custom-primitives.ts': 53,
  'npm/model.ts': 208,
  'layout/grid.ts': 63,
  'layout/linear.ts': 57,
  'layout/radial.ts': 58,
  'layout/ventilation.ts': 54,
  'layout/flex.ts': 57,
  'layout/flex-space.ts': 50,
  'layout/flex-wrap.ts': 51,
  'layout/fill-grid.ts': 49,
  'layout/grille.ts': 50,
  'sketches/constraints.ts': 29,
  'sketches/mounting-plate.ts': 61,
  'sketches/regions.ts': 61,
};

// The two non-example checks run on the last shard and took 232 s together.
const standaloneSeconds = 232;
const unmeasuredSeconds = 60;

export function assignExampleShards(
  files: readonly string[],
  shardCount: number,
): number[] {
  const loads = Array.from({length: shardCount}, (_, shard) =>
    shard === shardCount - 1 ? standaloneSeconds : 0,
  );
  const assignment = Array<number>(files.length);
  const weighted = files
    .map((file, index) => ({
      index,
      seconds: exampleSeconds[file] ?? unmeasuredSeconds,
    }))
    .sort(
      (left, right) => right.seconds - left.seconds || left.index - right.index,
    );
  for (const {index, seconds} of weighted) {
    let lightest = 0;
    for (let shard = 1; shard < shardCount; shard++)
      if (loads[shard]! < loads[lightest]!) lightest = shard;
    assignment[index] = lightest;
    loads[lightest]! += seconds;
  }
  return assignment;
}

export function estimatedExampleShardLoads(
  files: readonly string[],
  assignment: readonly number[],
  shardCount: number,
): number[] {
  const loads = Array.from({length: shardCount}, (_, shard) =>
    shard === shardCount - 1 ? standaloneSeconds : 0,
  );
  files.forEach((file, index) => {
    loads[assignment[index]!]! += exampleSeconds[file] ?? unmeasuredSeconds;
  });
  return loads;
}
