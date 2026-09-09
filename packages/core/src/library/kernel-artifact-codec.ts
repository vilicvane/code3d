import {getOC, Shape, type AnyShape} from 'replicad';
import {castOwnedShape} from './kernel-shapes.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', {fatal: true});

// Every node has an explicit tag, so authored keys cannot collide with binary
// references. Native handles never escape their runtime; only BinTools bytes do.
type Node = null | boolean | string | number | readonly [string, unknown];

export function encodeKernelArtifact(
  signature: string,
  value: unknown,
): Uint8Array {
  const chunks: Uint8Array[] = [];
  let offset = 0;
  function binary(kind: string, bytes: Uint8Array): Node {
    const node: Node = [kind, [offset, bytes.byteLength]];
    chunks.push(bytes);
    offset += bytes.byteLength;
    return node;
  }
  function encode(value: unknown): Node {
    if (value === undefined) return ['undefined', null];
    if (typeof value === 'number') {
      if (Object.is(value, -0)) return ['number', '-0'];
      return Number.isFinite(value) ? value : ['number', String(value)];
    }
    if (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'boolean'
    )
      return value;
    if (value instanceof Shape)
      return binary('shape', encodeShape(value as AnyShape));
    if (value instanceof Float32Array || value instanceof Uint32Array) {
      return binary(
        value instanceof Float32Array ? 'float32' : 'uint32',
        new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
      );
    }
    if (Array.isArray(value)) return ['array', value.map(encode)];
    if (
      typeof value === 'object' &&
      Object.getPrototypeOf(value) === Object.prototype
    ) {
      return [
        'object',
        Object.entries(value).map(([key, item]) => [key, encode(item)]),
      ];
    }
    throw new Error('Unsupported kernel artifact value');
  }
  const metadata = encoder.encode(JSON.stringify([signature, encode(value)]));
  const bytes = new Uint8Array(4 + metadata.byteLength + offset);
  new DataView(bytes.buffer).setUint32(0, metadata.byteLength, true);
  bytes.set(metadata, 4);
  offset = 4 + metadata.byteLength;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export function decodeKernelArtifact<Value>(
  bytes: Uint8Array,
  signature: string,
): Value {
  const metadataLength = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  ).getUint32(0, true);
  const start = 4 + metadataLength;
  if (start > bytes.byteLength) throw new Error('Truncated kernel artifact');
  const [storedSignature, tree] = JSON.parse(
    decoder.decode(bytes.subarray(4, start)),
  );
  if (storedSignature !== signature)
    throw new Error('Kernel artifact signature mismatch');
  const shapes: AnyShape[] = [];
  function decode(node: Node): unknown {
    if (!Array.isArray(node)) return node;
    const [kind, data] = node;
    switch (kind) {
      case 'undefined':
        return undefined;
      case 'number':
        return Number(data);
      case 'array':
        return (data as Node[]).map(decode);
      case 'object':
        return Object.fromEntries(
          (data as [string, Node][]).map(([key, item]) => [key, decode(item)]),
        );
      case 'shape':
      case 'float32':
      case 'uint32': {
        const [offset, length] = data as number[];
        if (
          !Number.isSafeInteger(offset) ||
          !Number.isSafeInteger(length) ||
          offset < 0 ||
          length < 0 ||
          start + offset + length > bytes.byteLength
        ) {
          throw new Error('Invalid kernel artifact binary range');
        }
        // Each retained array owns exactly its bytes, not the whole disk record.
        const chunk = bytes.slice(start + offset, start + offset + length);
        if (kind === 'float32') return new Float32Array(chunk.buffer);
        if (kind === 'uint32') return new Uint32Array(chunk.buffer);
        const shape = decodeShape(chunk);
        shapes.push(shape);
        return shape;
      }
      default:
        throw new Error('Invalid kernel artifact node');
    }
  }
  try {
    return decode(tree) as Value;
  } catch (error) {
    for (const shape of shapes) shape.delete();
    throw error;
  }
}

// Synchronous calls are serial within an OC instance. MEMFS is only a temporary
// bridge to the bound BinTools file overload, never the persistent store itself.
const shapePath = '/code3d-kernel-artifact.bin';
function encodeShape(shape: AnyShape): Uint8Array {
  const oc = getOC();
  const progress = new oc.Message_ProgressRange();
  let created = false;
  try {
    oc.FS.writeFile(shapePath, new Uint8Array());
    created = true;
    if (!oc.BinTools.Write(shape.wrapped, shapePath, progress))
      throw new Error('Could not encode kernel shape');
    return oc.FS.readFile(shapePath);
  } finally {
    progress.delete();
    if (created) oc.FS.unlink(shapePath);
  }
}

function decodeShape(bytes: Uint8Array): AnyShape {
  const oc = getOC();
  const progress = new oc.Message_ProgressRange();
  const raw = new oc.TopoDS_Shape();
  let created = false;
  try {
    oc.FS.writeFile(shapePath, bytes);
    created = true;
    if (!oc.BinTools.Read(raw, shapePath, progress) || raw.IsNull())
      throw new Error('Invalid kernel shape');
    return castOwnedShape(raw.clone());
  } finally {
    raw.delete();
    progress.delete();
    if (created) oc.FS.unlink(shapePath);
  }
}
