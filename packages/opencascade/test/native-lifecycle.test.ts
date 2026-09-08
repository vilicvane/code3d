import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import initialize, {type TopoDS_Edge} from '@code3d/opencascade';

const oc = await initialize({
  wasmBinary: await readFile(
    new URL('../wasm/replicad_single.wasm', import.meta.url),
  ),
});

test('allocator statistics decrease after releasing geometry without shrinking WASM memory', () => {
  const before = oc.Code3dMemory.AllocatedBytes();
  const shapes = Array.from({length: 500}, () => {
    const builder = new oc.BRepPrimAPI_MakeBox(10, 20, 30);
    try {
      return builder.Shape();
    } finally {
      builder.delete();
    }
  });
  const allocated = oc.Code3dMemory.AllocatedBytes();
  const capacity = oc.wasmMemory.buffer.byteLength;
  for (const shape of shapes) shape.delete();
  const released = oc.Code3dMemory.AllocatedBytes();
  assert.ok(allocated > before + 1024 * 1024);
  assert.ok(released < allocated - 1024 * 1024);
  assert.equal(oc.wasmMemory.buffer.byteLength, capacity);
  assert.ok(released >= 0);
});

test('allocator statistics include allocations larger than an ordinary heap page', () => {
  const before = oc.Code3dMemory.AllocatedBytes();
  const values = new oc.NCollection_Array1_double(1_000_000);
  let allocated: number;
  try {
    values.Init(1);
    allocated = oc.Code3dMemory.AllocatedBytes();
    assert.ok(allocated >= before + 8_000_000);
  } finally {
    values.delete();
  }
  assert.ok(oc.Code3dMemory.AllocatedBytes() <= allocated - 8_000_000);
});

test('owned native shapes outlive their builder and release their geometry', () => {
  const initial = oc.wasmMemory.buffer.byteLength;
  for (let iteration = 0; iteration < 10_000; iteration += 1) {
    const builder = new oc.BRepPrimAPI_MakeBox(10, 20, 30);
    const shape = builder.Shape();
    const retained = shape.clone();
    shape.delete();
    builder.delete();
    try {
      const mesh = oc.ReplicadMeshExtractor.extract(retained, 0.1, 0.2, false);
      try {
        assert.equal(mesh.getVerticesSize(), 72);
        assert.equal(mesh.getTrianglesSize(), 36);
      } finally {
        mesh.delete();
      }
    } finally {
      retained.delete();
    }
    if (iteration % 1000 === 0) {
      assert.ok(
        oc.wasmMemory.buffer.byteLength <= initial + 32 * 1024 * 1024,
        `Native memory kept growing after ${iteration} releases`,
      );
    }
  }
});

test('repeated fillet builders release their working geometry and result', () => {
  const initial = oc.wasmMemory.buffer.byteLength;
  const box = new oc.BRepPrimAPI_MakeBox(30, 20, 4);
  const source = box.Shape();
  box.delete();
  const edges: TopoDS_Edge[] = [];
  const explorer = new oc.TopExp_Explorer(
    source,
    oc.TopAbs_ShapeEnum.TopAbs_EDGE,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
  );
  try {
    while (explorer.More()) {
      const current = explorer.Current();
      try {
        if (!edges.some(edge => edge.IsSame(current))) {
          edges.push(oc.TopoDS.Edge(current));
        }
      } finally {
        current.delete();
      }
      explorer.Next();
    }
    for (let iteration = 0; iteration < 400; iteration += 1) {
      const builder = new oc.BRepFilletAPI_MakeFillet(
        source,
        oc.ChFi3d_FilletShape.ChFi3d_Rational,
      );
      let result;
      try {
        for (const edge of edges) builder.Add(1 + iteration * 0.001, edge);
        builder.Build();
        result = builder.Shape();
      } finally {
        builder.delete();
      }
      try {
        const mesh = oc.ReplicadMeshExtractor.extract(result, 0.1, 0.2, false);
        try {
          assert.ok(mesh.getTrianglesSize() > 36);
        } finally {
          mesh.delete();
        }
      } finally {
        result.delete();
      }
      assert.ok(
        oc.wasmMemory.buffer.byteLength <= initial + 32 * 1024 * 1024,
        `Native fillet memory kept growing after ${iteration} releases`,
      );
    }
  } finally {
    explorer.delete();
    edges.forEach(edge => edge.delete());
    source.delete();
  }
});
