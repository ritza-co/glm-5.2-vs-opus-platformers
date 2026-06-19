// Hand-written GLB / glTF 2.0 parser.
// Parses the binary container, decodes accessors, and exposes meshes,
// the node hierarchy, skins, and animation clips. No external libraries.

const COMPONENT = {
  5120: { array: Int8Array, size: 1 },
  5121: { array: Uint8Array, size: 1 },
  5122: { array: Int16Array, size: 2 },
  5123: { array: Uint16Array, size: 2 },
  5125: { array: Uint32Array, size: 4 },
  5126: { array: Float32Array, size: 4 },
};

const TYPE_COMPONENTS = {
  SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16,
};

export async function loadGLB(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to fetch ${url}: ${resp.status}`);
  const buffer = await resp.arrayBuffer();
  return parseGLB(buffer, url);
}

function parseGLB(buffer, url) {
  const dv = new DataView(buffer);
  const magic = dv.getUint32(0, true);
  if (magic !== 0x46546c67) throw new Error(`${url}: not a GLB (bad magic)`);
  const length = dv.getUint32(8, true);

  let json = null;
  let bin = null;
  let off = 12;
  while (off < length) {
    const chunkLen = dv.getUint32(off, true);
    const chunkType = dv.getUint32(off + 4, true);
    const chunkStart = off + 8;
    if (chunkType === 0x4e4f534a) { // "JSON"
      json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, chunkStart, chunkLen)));
    } else if (chunkType === 0x004e4942) { // "BIN\0"
      bin = new Uint8Array(buffer, chunkStart, chunkLen);
    }
    off = chunkStart + chunkLen;
  }
  if (!json) throw new Error(`${url}: no JSON chunk`);

  return new GLTF(json, bin, url);
}

export class GLTF {
  constructor(json, bin, url) {
    this.json = json;
    this.bin = bin;
    this.url = url;
    this._accessorCache = new Map();
  }

  // Decode an accessor index into a typed array (flat, length = count * components).
  // Handles interleaved buffer views via byteStride.
  accessor(index) {
    if (this._accessorCache.has(index)) return this._accessorCache.get(index);
    const acc = this.json.accessors[index];
    const comp = COMPONENT[acc.componentType];
    const numComp = TYPE_COMPONENTS[acc.type];
    const count = acc.count;
    const out = new comp.array(count * numComp);

    if (acc.bufferView == null) {
      // No buffer view => all zeros (sparse not handled, not needed for these assets).
      this._accessorCache.set(index, out);
      return out;
    }

    const bv = this.json.bufferViews[acc.bufferView];
    const bvOffset = bv.byteOffset || 0;
    const accOffset = acc.byteOffset || 0;
    const base = bvOffset + accOffset;
    const elemBytes = comp.size * numComp;
    const stride = bv.byteStride || elemBytes;

    const dv = new DataView(this.bin.buffer, this.bin.byteOffset, this.bin.byteLength);
    const getter = this._getterFor(acc.componentType);

    for (let i = 0; i < count; i++) {
      const elemStart = base + i * stride;
      for (let c = 0; c < numComp; c++) {
        out[i * numComp + c] = getter(dv, elemStart + c * comp.size);
      }
    }
    this._accessorCache.set(index, out);
    return out;
  }

  _getterFor(componentType) {
    switch (componentType) {
      case 5120: return (dv, o) => dv.getInt8(o);
      case 5121: return (dv, o) => dv.getUint8(o);
      case 5122: return (dv, o) => dv.getInt16(o, true);
      case 5123: return (dv, o) => dv.getUint16(o, true);
      case 5125: return (dv, o) => dv.getUint32(o, true);
      case 5126: return (dv, o) => dv.getFloat32(o, true);
      default: throw new Error(`Unknown componentType ${componentType}`);
    }
  }

  get scene() {
    const sceneIdx = this.json.scene || 0;
    return this.json.scenes[sceneIdx];
  }
}
