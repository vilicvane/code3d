import type * as Replicad from 'replicad';
import type {AnyShape} from 'replicad';
import {strToU8, zipSync} from 'fflate';
import {
  quaternionAxisAngle,
  type ModelGeometrySnapshot,
  type ModelKind,
  type RigidTransform,
} from '@code3d/core/tooling';

export type ModelExportFormat = 'step' | 'stl' | '3mf';
export type ModelExportInstance = Readonly<{
  nodeId: string;
  name: string;
  color?: string;
  kind: ModelKind;
  transform: RigidTransform;
}>;
export type ModelExportOptions = Readonly<{
  format: ModelExportFormat;
  /** Millimeters per authoring coordinate unit. */
  scale: number;
  upAxis: 'y' | 'z';
  tolerance: number;
  angularTolerance: number;
  binary: boolean;
}>;

export function exportModel(
  geometry: ModelGeometrySnapshot,
  instances: readonly ModelExportInstance[],
  options: ModelExportOptions,
  {
    exportSTEP,
    makeCompound,
  }: Pick<typeof Replicad, 'exportSTEP' | 'makeCompound'>,
): Blob {
  if (!instances.length)
    throw new Error('There is no rendered model to export.');
  if (!Number.isFinite(options.scale) || options.scale <= 0) {
    throw new Error('Scale must be a positive number.');
  }
  if (options.format !== 'step') {
    if (instances.some(instance => instance.kind !== 'solid')) {
      throw new Error(
        'STL and 3MF require solids. Select a solid or use STEP for curves and surfaces.',
      );
    }
    if (
      !Number.isFinite(options.tolerance) ||
      options.tolerance <= 0 ||
      !Number.isFinite(options.angularTolerance) ||
      options.angularTolerance <= 0
    ) {
      throw new Error('Mesh tolerances must be positive numbers.');
    }
  }

  const shapes: {shape: AnyShape; name: string; color?: string}[] = [];
  try {
    for (const instance of instances) {
      const original = geometry.shapes.get(instance.nodeId);
      if (!original)
        throw new Error(
          'The model has changed. Wait for it to finish compiling and reopen export.',
        );
      let shape = original.clone();
      try {
        const {axis, angleDegrees} = quaternionAxisAngle(
          instance.transform.quaternion,
        );
        if (Math.abs(angleDegrees) > 1e-9)
          shape = shape.rotate(angleDegrees, [0, 0, 0], [...axis]);
        shape = shape.translate([...instance.transform.position]);
        if (options.upAxis === 'z')
          shape = shape.rotate(90, [0, 0, 0], [1, 0, 0]);
        if (options.scale !== 1) shape = shape.scale(options.scale);
        shapes.push({shape, name: instance.name, color: instance.color});
      } catch (error) {
        shape.delete();
        throw error;
      }
    }
    if (options.format === 'step') {
      return exportSTEP(shapes, {unit: 'MM', modelUnit: 'MM'});
    }
    if (options.format === 'stl') {
      const compound = makeCompound(shapes.map(item => item.shape));
      // Replicad's makeCompound consumes the supplied shape wrappers.
      shapes.length = 0;
      try {
        return compound.blobSTL(options);
      } finally {
        compound.delete();
      }
    }
    return export3mf(shapes, options);
  } finally {
    for (const {shape} of shapes) shape.delete();
  }
}

function export3mf(
  shapes: readonly {shape: AnyShape; name: string; color?: string}[],
  options: ModelExportOptions,
): Blob {
  const resources: string[] = [];
  const components: string[] = [];
  let id = 1;
  for (const {shape, name, color} of shapes) {
    const objectId = id++;
    const materialId = id++;
    const mesh = weldMesh(shape.mesh(options));
    if (!mesh.triangles.length)
      throw new Error('The model has no triangles to export.');
    const material = color ? ` pid="${materialId}" pindex="0"` : '';
    if (color) {
      resources.push(
        `<basematerials id="${materialId}"><base name="${xml(name)}" displaycolor="${xml(color)}"/></basematerials>`,
      );
    }
    resources.push(
      `<object id="${objectId}" type="model" name="${xml(name)}"${material}><mesh><vertices>${mesh.vertices
        .map(([x, y, z]) => `<vertex x="${x}" y="${y}" z="${z}"/>`)
        .join('')}</vertices><triangles>${mesh.triangles
        .map(([a, b, c]) => `<triangle v1="${a}" v2="${b}" v3="${c}"/>`)
        .join('')}</triangles></mesh></object>`,
    );
    components.push(`<component objectid="${objectId}"/>`);
  }
  // One assembly keeps the relative placement of separate bodies intact.
  resources.push(
    `<object id="${id}" type="model"><components>${components.join('')}</components></object>`,
  );
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
<metadata name="Application">Code3D</metadata><resources>${resources.join('')}</resources>
<build><item objectid="${id}"/></build></model>`;
  // OPC package layout: https://3mf.io/spec/
  const archive = zipSync({
    '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>`),
    '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="model" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" Target="/3D/3dmodel.model"/></Relationships>`),
    '3D/3dmodel.model': strToU8(model),
  });
  return new Blob([archive], {type: 'model/3mf'});
}

function xml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    character =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&apos;',
      })[character]!,
  );
}

/** CAD tessellation duplicates face-boundary vertices; 3MF needs shared indices. */
function weldMesh(mesh: {vertices: number[]; triangles: number[]}): {
  vertices: number[][];
  triangles: number[][];
} {
  const minimum = [Infinity, Infinity, Infinity];
  const maximum = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < mesh.vertices.length; i++) {
    minimum[i % 3] = Math.min(minimum[i % 3], mesh.vertices[i]);
    maximum[i % 3] = Math.max(maximum[i % 3], mesh.vertices[i]);
  }
  const epsilon =
    Math.max(...maximum.map((value, i) => value - minimum[i])) * 1e-10;
  const vertices: number[][] = [];
  const indices: number[] = [];
  const buckets = new Map<string, number[]>();
  for (let i = 0; i < mesh.vertices.length; i += 3) {
    const point = mesh.vertices.slice(i, i + 3);
    const cell = point.map((value, axis) =>
      Math.floor((value - minimum[axis]) / epsilon),
    );
    let index: number | undefined;
    search: for (let x = -1; x <= 1; x++) {
      for (let y = -1; y <= 1; y++) {
        for (let z = -1; z <= 1; z++) {
          for (const candidate of buckets.get(
            [cell[0] + x, cell[1] + y, cell[2] + z].join(','),
          ) ?? []) {
            if (
              point.every(
                (value, axis) =>
                  Math.abs(value - vertices[candidate][axis]) <= epsilon,
              )
            ) {
              index = candidate;
              break search;
            }
          }
        }
      }
    }
    if (index === undefined) {
      index = vertices.length;
      vertices.push(point);
      const key = cell.join(',');
      const bucket = buckets.get(key) ?? [];
      bucket.push(index);
      buckets.set(key, bucket);
    }
    indices.push(index);
  }
  const triangles: number[][] = [];
  for (let i = 0; i < mesh.triangles.length; i += 3) {
    const triangle = mesh.triangles
      .slice(i, i + 3)
      .map(index => indices[index]);
    if (new Set(triangle).size === 3) triangles.push(triangle);
  }
  return {vertices, triangles};
}
