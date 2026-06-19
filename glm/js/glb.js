// glb.js - minimal glTF 2.0 GLB parser (geometry + nodes + skin + animations)
"use strict";

const GLB = (() => {

const COMP = { 5120:1, 5121:1, 5122:2, 5123:2, 5125:4, 5126:4 };
const COMPCOUNT = { SCALAR:1, VEC2:2, VEC3:3, VEC4:4, MAT2:4, MAT3:9, MAT4:16 };

function typedArray(componentType, buffer, byteOffset, count) {
  switch (componentType) {
    case 5120: return new Int8Array(buffer, byteOffset, count);
    case 5121: return new Uint8Array(buffer, byteOffset, count);
    case 5122: return new Int16Array(buffer, byteOffset, count);
    case 5123: return new Uint16Array(buffer, byteOffset, count);
    case 5125: return new Uint32Array(buffer, byteOffset, count);
    case 5126: return new Float32Array(buffer, byteOffset, count);
  }
  throw new Error("Unknown componentType " + componentType);
}

async function load(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error("Failed to load " + url + ": " + resp.status);
  const buf = await resp.arrayBuffer();
  return parse(buf, url);
}

function parse(buf, url) {
  const dv = new DataView(buf);
  const magic = dv.getUint32(0, true);
  const version = dv.getUint32(4, true);
  const length = dv.getUint32(8, true);
  if (magic !== 0x46546C67) throw new Error("Not a GLB: " + url);
  if (version !== 2) throw new Error("Unsupported GLB version: " + version);
  let offset = 12;
  let json = null, bin = null;
  while (offset < length) {
    const chunkLength = dv.getUint32(offset, true);
    const chunkType = dv.getUint32(offset + 4, true);
    const data = buf.slice(offset + 8, offset + 8 + chunkLength);
    if (chunkType === 0x4E4F534A) json = JSON.parse(new TextDecoder().decode(data));
    else if (chunkType === 0x004E4942) bin = data;
    offset += 8 + chunkLength;
  }
  if (!json) throw new Error("No JSON chunk in " + url);
  return build(json, bin, url);
}

function readAccessor(json, bin, accIndex) {
  const acc = json.accessors[accIndex];
  const bv = json.bufferViews[acc.bufferView];
  const compSize = COMP[acc.componentType];
  const numComps = COMPCOUNT[acc.type];
  const count = acc.count;
  const byteOffset = (bv.byteOffset || 0) + (acc.byteOffset || 0);
  const stride = bv.byteStride || 0;
  const buffer = bin; // bin is an ArrayBuffer
  // Typed array view; if no stride (tightly packed), we can view directly
  let result;
  if (stride === 0 || stride === compSize * numComps) {
    result = typedArray(acc.componentType, buffer, byteOffset, count * numComps);
  } else {
    // interleaved: copy out
    const flat = new Array(count * numComps);
    const tmp = typedArray(acc.componentType, buffer, byteOffset, numComps);
    for (let i = 0; i < count; i++) {
      const view = typedArray(acc.componentType, buffer, byteOffset + i * stride, numComps);
      for (let j = 0; j < numComps; j++) flat[i * numComps + j] = view[j];
    }
    result = typedArray(acc.componentType, new ArrayBuffer(count * numComps * compSize), 0, count * numComps);
    for (let i = 0; i < count * numComps; i++) result[i] = flat[i];
  }
  // Normalize integers if needed
  if (acc.normalized) {
    result = new Float32Array(result);
    // normalization handled by caller for weights (we'll convert to float)
  }
  return { array: result, count, numComps, componentType: acc.componentType, type: acc.type };
}

function toFloat32(accData) {
  if (accData.array instanceof Float32Array) return accData.array;
  const out = new Float32Array(accData.array.length);
  if (accData.componentType === 5120 || accData.componentType === 5122) {
    // signed ints - not normalized here
    for (let i = 0; i < out.length; i++) out[i] = accData.array[i];
  } else if (accData.componentType === 5121 || accData.componentType === 5123 || accData.componentType === 5125) {
    for (let i = 0; i < out.length; i++) out[i] = accData.array[i];
  } else {
    for (let i = 0; i < out.length; i++) out[i] = accData.array[i];
  }
  return out;
}

function build(json, bin, url) {
  const model = { json, url, nodes: [], meshes: [], skins: [], animations: [], rootNodes: json.scenes[json.scene].nodes };

  // Nodes
  for (const n of json.nodes) {
    model.nodes.push({
      name: n.name || "",
      translation: n.translation ? n.translation.slice() : [0,0,0],
      rotation: n.rotation ? n.rotation.slice() : [0,0,0,1],
      scale: n.scale ? n.scale.slice() : [1,1,1],
      children: n.children ? n.children.slice() : [],
      mesh: n.mesh !== undefined ? n.mesh : null,
      skin: n.skin !== undefined ? n.skin : null,
      local: Mat4.identity(),
      world: Mat4.identity(),
    });
  }

  // Skins
  if (json.skins) {
    for (const s of json.skins) {
      const ibm = readAccessor(json, bin, s.inverseBindMatrices);
      const ibmFloat = toFloat32(ibm);
      model.skins.push({
        joints: s.joints.slice(),
        inverseBind: ibmFloat, // length = joints*16
      });
    }
  }

  // Meshes
  if (json.meshes) {
    for (const m of json.meshes) {
      const prims = [];
      for (const p of m.primitives) {
        const prim = { skinned: false, indices: null, position: null, normal: null, joints: null, weights: null, vertexCount: 0, indexCount: 0 };
        const attrs = p.attributes || {};
        if (attrs.POSITION !== undefined) {
          const a = readAccessor(json, bin, attrs.POSITION);
          prim.position = toFloat32(a);
          prim.vertexCount = a.count;
        }
        if (attrs.NORMAL !== undefined) {
          prim.normal = toFloat32(readAccessor(json, bin, attrs.NORMAL));
        }
        if (attrs.JOINTS_0 !== undefined) {
          prim.joints = toFloat32(readAccessor(json, bin, attrs.JOINTS_0));
          prim.skinned = true;
        }
        if (attrs.WEIGHTS_0 !== undefined) {
          const w = readAccessor(json, bin, attrs.WEIGHTS_0);
          let wf = toFloat32(w);
          // normalize weights to sum to 1 (some exporters don't)
          for (let v = 0; v < w.count; v++) {
            let sum = wf[v*4]+wf[v*4+1]+wf[v*4+2]+wf[v*4+3];
            if (sum > 0) { const inv = 1/sum; wf[v*4]*=inv; wf[v*4+1]*=inv; wf[v*4+2]*=inv; wf[v*4+3]*=inv; }
          }
          prim.weights = wf;
        }
        if (p.indices !== undefined) {
          const a = readAccessor(json, bin, p.indices);
          prim.indices = a.array;
          prim.indexCount = a.count;
        } else {
          // non-indexed
          prim.indexCount = prim.vertexCount;
        }
        prims.push(prim);
      }
      model.meshes.push({ name: m.name || "", primitives: prims });
    }
  }

  // Animations
  if (json.animations) {
    json.animations.forEach((anim, ai) => {
      const channels = [];
      let duration = 0;
      for (const ch of anim.channels) {
        const sampler = anim.samplers[ch.sampler];
        const input = toFloat32(readAccessor(json, bin, sampler.input));
        const output = readAccessor(json, bin, sampler.output);
        const outputFloat = toFloat32(output);
        if (input[input.count - 1] !== undefined) {
          const last = input[input.length - 1];
          if (last > duration) duration = last;
        }
        channels.push({
          node: ch.target.node,
          path: ch.target.path,
          input,
          output: outputFloat,
          numComps: output.numComps,
          interpolation: sampler.interpolation || "LINEAR",
        });
      }
      model.animations.push({ name: anim.name || ("anim" + ai), channels, duration });
    });
  }

  // Compute local matrices
  for (const n of model.nodes) {
    n.local = Mat4.fromTRS(n.translation, n.rotation, n.scale);
  }

  // Compute AABB from first mesh primitive positions (model space, ignoring skin - use rest pose)
  model.aabb = null;
  if (model.meshes.length) {
    let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const m of model.meshes) {
      for (const p of m.primitives) {
        if (!p.position) continue;
        for (let i = 0; i < p.vertexCount; i++) {
          const x = p.position[i*3], y = p.position[i*3+1], z = p.position[i*3+2];
          if (x < min[0]) min[0] = x; if (x > max[0]) max[0] = x;
          if (y < min[1]) min[1] = y; if (y > max[1]) max[1] = y;
          if (z < min[2]) min[2] = z; if (z > max[2]) max[2] = z;
        }
      }
    }
    model.aabb = { min, max };
  }

  return model;
}

// Update world matrices given a root transform applied to rootNodes
function updateWorld(model, rootMatrix) {
  const nodes = model.nodes;
  function visit(nodeIdx, parentWorld) {
    const n = nodes[nodeIdx];
    n.world = Mat4.multiply(parentWorld, n.local);
    for (const c of n.children) visit(c, n.world);
  }
  for (const r of model.rootNodes) visit(r, rootMatrix || Mat4.identity());
}

// Sample an animation at time t, writing local TRS into nodes (only channels present).
// Loops the animation.
function sampleAnimation(model, animIndex, time) {
  const anim = model.animations[animIndex];
  if (!anim) return;
  let t = time;
  if (anim.duration > 0) {
    t = t % anim.duration;
    if (t < 0) t += anim.duration;
  }
  for (const ch of anim.channels) {
    const input = ch.input;
    const n = input.length / (ch.numComps > 0 ? 1 : 1); // input is times, 1 per keyframe
    // find keyframe index
    const keyCount = input.length;
    let k = 0;
    while (k < keyCount - 1 && input[k + 1] <= t) k++;
    let frac = 0;
    if (keyCount > 1) {
      const span = input[k + 1] - input[k];
      if (span > 0) frac = (t - input[k]) / span;
      if (frac < 0) frac = 0; if (frac > 1) frac = 1;
    }
    const node = model.nodes[ch.node];
    if (!node) continue;
    const nc = ch.numComps;
    const out = ch.output;
    if (ch.path === "translation") {
      const a = [out[k*nc], out[k*nc+1], out[k*nc+2]];
      const b = [out[(k+1)*nc], out[(k+1)*nc+1], out[(k+1)*nc+2]];
      node.translation = Vec3.lerp(a, b, frac);
    } else if (ch.path === "scale") {
      const a = [out[k*nc], out[k*nc+1], out[k*nc+2]];
      const b = [out[(k+1)*nc], out[(k+1)*nc+1], out[(k+1)*nc+2]];
      node.scale = [a[0]+(b[0]-a[0])*frac, a[1]+(b[1]-a[1])*frac, a[2]+(b[2]-a[2])*frac];
    } else if (ch.path === "rotation") {
      const a = [out[k*nc], out[k*nc+1], out[k*nc+2], out[k*nc+3]];
      const b = [out[(k+1)*nc], out[(k+1)*nc+1], out[(k+1)*nc+2], out[(k+1)*nc+3]];
      node.rotation = Quat.slerp(a, b, frac);
    }
    // recompute local
    node.local = Mat4.fromTRS(node.translation, node.rotation, node.scale);
  }
}

// Find animation by name
function findAnim(model, name) {
  for (let i = 0; i < model.animations.length; i++) {
    if (model.animations[i].name === name) return i;
  }
  return -1;
}

return { load, parse, updateWorld, sampleAnimation, findAnim, readAccessor, toFloat32 };

})();

window.GLB = GLB;
