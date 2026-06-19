// Builds renderable GPU models from a parsed GLTF, and handles skeletal
// animation (joint matrix computation) for the rigged character.

import { mat4, quat, vec3 } from './math.js';

// A static (non-skinned) model: one or more primitives uploaded to the GPU.
// World transform comes from the node TRS baked into a model matrix per node.
export class StaticModel {
  constructor(gl, gltf) {
    this.gl = gl;
    this.gltf = gltf;
    this.primitives = []; // { vao, indexCount, indexType, modelMatrix, min, max }
    this.bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    this._build();
  }

  _build() {
    const gl = this.gl;
    const gltf = this.gltf;
    const scene = gltf.scene;
    const visit = (nodeIdx, parentMatrix) => {
      const node = gltf.json.nodes[nodeIdx];
      const local = nodeLocalMatrix(node);
      const world = mat4.create();
      mat4.multiply(world, parentMatrix, local);
      if (node.mesh != null) {
        const mesh = gltf.json.meshes[node.mesh];
        for (const prim of mesh.primitives) {
          this._buildPrimitive(prim, world);
        }
      }
      if (node.children) for (const c of node.children) visit(c, world);
    };
    const root = mat4.create();
    for (const n of scene.nodes) visit(n, root);
  }

  _buildPrimitive(prim, world) {
    const gl = this.gl;
    const gltf = this.gltf;
    const pos = gltf.accessor(prim.attributes.POSITION);
    const nrm = prim.attributes.NORMAL != null ? gltf.accessor(prim.attributes.NORMAL) : null;
    const uv = prim.attributes.TEXCOORD_0 != null ? gltf.accessor(prim.attributes.TEXCOORD_0) : null;
    const indices = prim.indices != null ? gltf.accessor(prim.indices) : null;

    // Track bounds in world space (used for level sizing / debug).
    const accMin = gltf.json.accessors[prim.attributes.POSITION].min;
    const accMax = gltf.json.accessors[prim.attributes.POSITION].max;
    if (accMin && accMax) {
      const corners = [
        [accMin[0], accMin[1], accMin[2]], [accMax[0], accMax[1], accMax[2]],
      ];
      const tmp = vec3.create();
      for (const c of corners) {
        mat4.transformPoint(tmp, world, c);
        for (let i = 0; i < 3; i++) {
          this.bounds.min[i] = Math.min(this.bounds.min[i], tmp[i]);
          this.bounds.max[i] = Math.max(this.bounds.max[i], tmp[i]);
        }
      }
    }

    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);

    uploadAttrib(gl, 0, pos, 3);
    if (nrm) uploadAttrib(gl, 1, nrm, 3);
    if (uv) uploadAttrib(gl, 2, uv, 2);

    let indexCount, indexType;
    if (indices) {
      const ib = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
      // Promote to Uint32 if needed; here indices are Uint8/16/32 already typed.
      let idxArr = indices;
      if (idxArr instanceof Uint8Array) idxArr = Uint16Array.from(idxArr);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idxArr, gl.STATIC_DRAW);
      indexCount = idxArr.length;
      indexType = idxArr instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
    } else {
      indexCount = pos.length / 3;
      indexType = null;
    }

    gl.bindVertexArray(null);
    this.primitives.push({ vao, indexCount, indexType, modelMatrix: world });
  }
}

// A skinned model (the character). Builds buffers including joints/weights,
// and computes joint matrices each frame from a sampled animation pose.
export class SkinnedModel {
  constructor(gl, gltf) {
    this.gl = gl;
    this.gltf = gltf;
    this.primitives = [];
    this.skin = gltf.json.skins[0];
    this.joints = this.skin.joints; // node indices
    this.inverseBind = []; // Float32Array(16) per joint
    this.jointMatrices = new Float32Array(this.joints.length * 16);

    // Build a quick map of node index -> local TRS that we mutate during animation.
    this.nodeTRS = gltf.json.nodes.map((n) => ({
      t: n.translation ? Float32Array.from(n.translation) : new Float32Array([0, 0, 0]),
      r: n.rotation ? Float32Array.from(n.rotation) : new Float32Array([0, 0, 0, 1]),
      s: n.scale ? Float32Array.from(n.scale) : new Float32Array([1, 1, 1]),
    }));
    // Keep base/rest pose to reset before applying a clip.
    this.restTRS = this.nodeTRS.map((trs) => ({
      t: Float32Array.from(trs.t), r: Float32Array.from(trs.r), s: Float32Array.from(trs.s),
    }));

    this._worldMatrices = gltf.json.nodes.map(() => mat4.create());

    this._buildInverseBind();
    this._buildPrimitives();
    this._buildAnimations();
  }

  _buildInverseBind() {
    const ibmFlat = this.gltf.accessor(this.skin.inverseBindMatrices);
    for (let i = 0; i < this.joints.length; i++) {
      this.inverseBind.push(ibmFlat.subarray(i * 16, i * 16 + 16));
    }
  }

  _buildPrimitives() {
    const gl = this.gl;
    const gltf = this.gltf;
    // The character mesh lives on the node with a skin; gather that mesh.
    let meshNode = gltf.json.nodes.find((n) => n.skin != null && n.mesh != null);
    const mesh = gltf.json.meshes[meshNode.mesh];
    for (const prim of mesh.primitives) {
      const pos = gltf.accessor(prim.attributes.POSITION);
      const nrm = gltf.accessor(prim.attributes.NORMAL);
      const uv = gltf.accessor(prim.attributes.TEXCOORD_0);
      const jnt = gltf.accessor(prim.attributes.JOINTS_0); // Uint16 x4
      const wgt = gltf.accessor(prim.attributes.WEIGHTS_0); // Float32 x4
      const indices = gltf.accessor(prim.indices);

      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      uploadAttrib(gl, 0, pos, 3);
      uploadAttrib(gl, 1, nrm, 3);
      uploadAttrib(gl, 2, uv, 2);
      // Joints as float attribute (simplest, robust across drivers).
      uploadAttrib(gl, 3, Float32Array.from(jnt), 4);
      uploadAttrib(gl, 4, wgt, 4);

      const ib = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
      let idxArr = indices;
      if (idxArr instanceof Uint8Array) idxArr = Uint16Array.from(idxArr);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idxArr, gl.STATIC_DRAW);
      gl.bindVertexArray(null);

      this.primitives.push({
        vao,
        indexCount: idxArr.length,
        indexType: idxArr instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT,
      });
    }
  }

  _buildAnimations() {
    this.animations = {};
    for (const anim of this.gltf.json.animations || []) {
      const channels = anim.channels.map((ch) => {
        const sampler = anim.samplers[ch.sampler];
        return {
          node: ch.target.node,
          path: ch.target.path, // 'translation' | 'rotation' | 'scale'
          times: this.gltf.accessor(sampler.input),
          values: this.gltf.accessor(sampler.output),
          interp: sampler.interpolation || 'LINEAR',
        };
      });
      let duration = 0;
      for (const ch of channels) {
        if (ch.times.length) duration = Math.max(duration, ch.times[ch.times.length - 1]);
      }
      this.animations[anim.name] = { channels, duration };
    }
  }

  // Sample an animation clip at time `t` (seconds, looped) and update joint matrices.
  pose(clipName, t) {
    const clip = this.animations[clipName];
    // Reset to rest pose first.
    for (let i = 0; i < this.nodeTRS.length; i++) {
      this.nodeTRS[i].t.set(this.restTRS[i].t);
      this.nodeTRS[i].r.set(this.restTRS[i].r);
      this.nodeTRS[i].s.set(this.restTRS[i].s);
    }
    if (clip) {
      const time = clip.duration > 0 ? (t % clip.duration) : 0;
      for (const ch of clip.channels) {
        this._applyChannel(ch, time);
      }
    }
    this._computeJointMatrices();
  }

  _applyChannel(ch, time) {
    const times = ch.times;
    const n = times.length;
    if (n === 0) return;
    // Find keyframe interval.
    let i1 = 0;
    while (i1 < n && times[i1] < time) i1++;
    let i0 = Math.max(0, i1 - 1);
    if (i1 >= n) i1 = n - 1;
    const t0 = times[i0], t1 = times[i1];
    const f = (t1 > t0) ? (time - t0) / (t1 - t0) : 0;

    const trs = this.nodeTRS[ch.node];
    if (ch.path === 'translation' || ch.path === 'scale') {
      const v = ch.path === 'translation' ? trs.t : trs.s;
      for (let c = 0; c < 3; c++) {
        v[c] = ch.values[i0 * 3 + c] + (ch.values[i1 * 3 + c] - ch.values[i0 * 3 + c]) * f;
      }
    } else if (ch.path === 'rotation') {
      const a = ch.values.subarray(i0 * 4, i0 * 4 + 4);
      const b = ch.values.subarray(i1 * 4, i1 * 4 + 4);
      quat.slerp(trs.r, a, b, f);
    }
  }

  _computeJointMatrices() {
    // Compute world matrix for every node by walking the scene hierarchy.
    const gltf = this.gltf;
    const visit = (nodeIdx, parent) => {
      const trs = this.nodeTRS[nodeIdx];
      const local = mat4.create();
      mat4.fromRotationTranslationScale(local, trs.r, trs.t, trs.s);
      const world = this._worldMatrices[nodeIdx];
      mat4.multiply(world, parent, local);
      const node = gltf.json.nodes[nodeIdx];
      if (node.children) for (const c of node.children) visit(c, world);
    };
    const identity = mat4.create();
    for (const n of gltf.scene.nodes) visit(n, identity);

    // jointMatrix[i] = worldJoint[i] * inverseBind[i]
    const tmp = mat4.create();
    for (let i = 0; i < this.joints.length; i++) {
      mat4.multiply(tmp, this._worldMatrices[this.joints[i]], this.inverseBind[i]);
      this.jointMatrices.set(tmp, i * 16);
    }
  }
}

function nodeLocalMatrix(node) {
  const m = mat4.create();
  if (node.matrix) {
    m.set(node.matrix);
    return m;
  }
  const t = node.translation || [0, 0, 0];
  const r = node.rotation || [0, 0, 0, 1];
  const s = node.scale || [1, 1, 1];
  mat4.fromRotationTranslationScale(m, r, t, s);
  return m;
}

function uploadAttrib(gl, location, data, size) {
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(location);
  gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
  return buf;
}
