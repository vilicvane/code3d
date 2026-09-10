import {getOC, Shape, type AnyShape} from 'replicad';
import {castOwnedShape} from './kernel-shapes.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', {fatal: true});

// Every node has an explicit tag, so authored keys cannot collide with binary
// references. Native handles never escape their runtime; only BinTools bytes do.
type Node = null | boolean | string | number | readonly [string, unknown];

const binaryTypes: Record<
  string,
  new (buffer: ArrayBuffer, offset?: number, length?: number) => ArrayBufferView
> = {
  Int8Array,
  Uint8Array,
  Uint8ClampedArray,
  Int16Array,
  Uint16Array,
  Int32Array,
  Uint32Array,
  Float32Array,
  Float64Array,
  BigInt64Array,
  BigUint64Array,
  DataView,
};

export function encodeKernelArtifact(
  signature: string,
  value: unknown,
): Uint8Array {
  const chunks: Uint8Array[] = [];
  let offset = 0;
  const references = new Map<object, number>();
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
    if (typeof value === 'bigint') return ['bigint', String(value)];
    if (typeof value !== 'object')
      throw new Error('Unsupported kernel artifact value');
    const existing = references.get(value);
    if (existing !== undefined) return ['reference', existing];
    const id = references.size;
    references.set(value, id);
    return ['value', [id, encodeObject(value)]];
  }
  function encodeObject(value: object): Node {
    if (value instanceof Shape)
      return binary('shape', encodeShape(value as AnyShape));
    if (ArrayBuffer.isView(value)) {
      if (!Object.hasOwn(binaryTypes, value.constructor.name))
        throw new Error('Unsupported kernel artifact view');
      return [
        'view',
        [
          value.constructor.name,
          encode(value.buffer),
          value.byteOffset,
          value instanceof DataView
            ? value.byteLength
            : (value as unknown as {length: number}).length,
        ],
      ];
    }
    if (value instanceof ArrayBuffer)
      return binary('ArrayBuffer', new Uint8Array(value));
    if (value instanceof Date) return ['date', encode(value.getTime())];
    if (value instanceof Map)
      return [
        'map',
        [...value].map(([key, item]) => [encode(key), encode(item)]),
      ];
    if (value instanceof Set) return ['set', [...value].map(encode)];
    if (Array.isArray(value))
      return [
        'array',
        [
          value.length,
          Object.entries(value).map(([key, item]) => [key, encode(item)]),
        ],
      ];
    if (
      Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null
    ) {
      return [
        Object.getPrototypeOf(value) === null ? 'record' : 'object',
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
  const references = new Map<number, unknown>();
  function decode(node: Node, referenceId?: number): unknown {
    const register = <T>(value: T): T => {
      if (referenceId !== undefined) references.set(referenceId, value);
      return value;
    };
    if (!Array.isArray(node)) return node;
    const [kind, data] = node;
    switch (kind) {
      case 'reference':
        if (!references.has(data as number))
          throw new Error('Invalid kernel artifact reference');
        return references.get(data as number);
      case 'value': {
        const [id, value] = data as [number, Node];
        return decode(value, id);
      }
      case 'undefined':
        return undefined;
      case 'number':
        return Number(data);
      case 'bigint':
        return BigInt(data as string);
      case 'date':
        return register(new Date(decode(data as Node) as number));
      case 'map': {
        const map = register(new Map());
        for (const [key, item] of data as [Node, Node][])
          map.set(decode(key), decode(item));
        return map;
      }
      case 'set': {
        const set = register(new Set());
        for (const item of data as Node[]) set.add(decode(item));
        return set;
      }
      case 'array':
      case 'record':
      case 'object': {
        const object = register(
          kind === 'array'
            ? new Array((data as [number, unknown])[0])
            : kind === 'record'
              ? Object.create(null)
              : {},
        );
        const entries = (
          kind === 'array' ? (data as [number, unknown])[1] : data
        ) as [string, Node][];
        for (const [key, item] of entries)
          Object.defineProperty(object, key, {
            value: decode(item),
            writable: true,
            configurable: true,
            enumerable: true,
          });
        return object;
      }
      case 'view': {
        const [name, buffer, offset, length] = data as [
          string,
          Node,
          number,
          number,
        ];
        if (!Object.hasOwn(binaryTypes, name))
          throw new Error('Invalid kernel artifact view');
        return register(
          new binaryTypes[name](decode(buffer) as ArrayBuffer, offset, length),
        );
      }
      case 'shape':
      case 'ArrayBuffer': {
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
        // Each restored backing buffer owns its source bytes, not the disk record.
        const chunk = bytes.slice(start + offset, start + offset + length);
        if (kind === 'ArrayBuffer') return register(chunk.buffer);
        const shape = decodeShape(chunk);
        shapes.push(shape);
        return register(shape);
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
