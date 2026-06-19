// renderer.js - WebGL2 renderer with glTF skinning support
"use strict";

const Renderer = (() => {

const VS = `#version 300 es
precision highp float;
in vec3 aPosition;
in vec3 aNormal;
in vec4 aJoints;
in vec4 aWeights;
uniform mat4 uJointMatrix[8];
uniform mat4 uModel;
uniform mat4 uViewProj;
uniform float uSkinned;
out vec3 vNormal;
out vec3 vWorldPos;
void main() {
  mat4 skinMat = mat4(0.0);
  if (uSkinned > 0.5) {
    skinMat =
      aWeights.x * uJointMatrix[int(aJoints.x)] +
      aWeights.y * uJointMatrix[int(aJoints.y)] +
      aWeights.z * uJointMatrix[int(aJoints.z)] +
      aWeights.w * uJointMatrix[int(aJoints.w)];
  } else {
    skinMat = mat4(1.0);
  }
  vec4 skinned = skinMat * vec4(aPosition, 1.0);
  vec4 world = uModel * skinned;
  vWorldPos = world.xyz;
  // normal: use upper-left 3x3 of skinMat then model's rotation (assume uniform scale)
  mat3 nm = mat3(uModel) * mat3(skinMat);
  vNormal = normalize(nm * aNormal);
  gl_Position = uViewProj * world;
}`;

const FS = `#version 300 es
precision highp float;
in vec3 vNormal;
in vec3 vWorldPos;
uniform vec3 uColor;
uniform int uMaterialType; // 0=flat, 1=grass-top, 2=snow-top
uniform vec3 uLightDir;    // normalized, pointing toward light
uniform vec3 uCamPos;
uniform float uTime;
out vec4 frag;
void main() {
  vec3 n = normalize(vNormal);
  vec3 base = uColor;
  if (uMaterialType == 0) {
    base = uColor;
  } else if (uMaterialType == 1) {
    // grass: green top, dirt-brown sides
    vec3 top = vec3(0.45, 0.72, 0.30);
    vec3 side = vec3(0.62, 0.46, 0.31);
    float f = smoothstep(0.55, 0.85, n.y);
    base = mix(side, top, f);
    // underside darker
    base = mix(base, vec3(0.34, 0.25, 0.18), smoothstep(-0.1, -0.6, n.y));
  } else if (uMaterialType == 2) {
    vec3 top = vec3(0.92, 0.94, 0.97);
    vec3 side = vec3(0.55, 0.62, 0.72);
    base = mix(side, top, smoothstep(0.5, 0.85, n.y));
  }
  // half-lambert wrap lighting so faces are never fully black
  float ndl = dot(n, uLightDir);
  float wrap = ndl * 0.5 + 0.5;
  float diff = wrap * wrap;
  float amb = 0.42;
  vec3 lit = base * (amb + diff * 0.62);
  // subtle rim
  vec3 viewDir = normalize(uCamPos - vWorldPos);
  float rim = pow(1.0 - max(dot(n, viewDir), 0.0), 3.0) * 0.10;
  lit += rim * base;
  frag = vec4(lit, 1.0);
}`;

function createShader(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s);
    console.error(src);
    throw new Error("Shader compile error: " + log);
  }
  return s;
}

function createProgram(gl) {
  const vs = createShader(gl, gl.VERTEX_SHADER, VS);
  const fs = createShader(gl, gl.FRAGMENT_SHADER, FS);
  const p = gl.createProgram();
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error("Program link error: " + gl.getProgramInfoLog(p));
  }
  return p;
}

function makeGpuMesh(gl, prim) {
  const obj = { skinned: prim.skinned, indexCount: prim.indexCount, vertexCount: prim.vertexCount, hasIndex: !!prim.indices };
  obj.posBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, obj.posBuf);
  gl.bufferData(gl.ARRAY_BUFFER, prim.position, gl.STATIC_DRAW);
  obj.normBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, obj.normBuf);
  if (prim.normal) gl.bufferData(gl.ARRAY_BUFFER, prim.normal, gl.STATIC_DRAW);
  else gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(prim.vertexCount * 3), gl.STATIC_DRAW);
  obj.jointBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, obj.jointBuf);
  if (prim.joints) gl.bufferData(gl.ARRAY_BUFFER, prim.joints, gl.STATIC_DRAW);
  else gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(prim.vertexCount * 4), gl.STATIC_DRAW);
  obj.weightBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, obj.weightBuf);
  if (prim.weights) gl.bufferData(gl.ARRAY_BUFFER, prim.weights, gl.STATIC_DRAW);
  else { const w = new Float32Array(prim.vertexCount*4); for (let i=0;i<prim.vertexCount;i++) w[i*4]=1; gl.bufferData(gl.ARRAY_BUFFER, w, gl.STATIC_DRAW); }
  if (prim.indices) {
    obj.idxBuf = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, obj.idxBuf);
    let idxArr = prim.indices;
    let idxType = gl.UNSIGNED_SHORT;
    if (idxArr instanceof Uint8Array) idxType = gl.UNSIGNED_BYTE;
    else if (idxArr instanceof Uint32Array) idxType = gl.UNSIGNED_INT;
    obj.idxType = idxType;
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idxArr, gl.STATIC_DRAW);
  }
  return obj;
}

class R {
  constructor(canvas) {
    this.gl = canvas.getContext("webgl2", { antialias: true, alpha: false, preserveDrawingBuffer: true });
    if (!this.gl) throw new Error("WebGL2 not supported");
    const gl = this.gl;
    this.prog = createProgram(gl);
    this.loc = {
      aPosition: gl.getAttribLocation(this.prog, "aPosition"),
      aNormal: gl.getAttribLocation(this.prog, "aNormal"),
      aJoints: gl.getAttribLocation(this.prog, "aJoints"),
      aWeights: gl.getAttribLocation(this.prog, "aWeights"),
      uJointMatrix: gl.getUniformLocation(this.prog, "uJointMatrix[0]"),
      uModel: gl.getUniformLocation(this.prog, "uModel"),
      uViewProj: gl.getUniformLocation(this.prog, "uViewProj"),
      uSkinned: gl.getUniformLocation(this.prog, "uSkinned"),
      uColor: gl.getUniformLocation(this.prog, "uColor"),
      uMaterialType: gl.getUniformLocation(this.prog, "uMaterialType"),
      uLightDir: gl.getUniformLocation(this.prog, "uLightDir"),
      uCamPos: gl.getUniformLocation(this.prog, "uCamPos"),
      uTime: gl.getUniformLocation(this.prog, "uTime"),
    };
    gl.enable(gl.DEPTH_TEST);
    // No face culling: glTF materials are doubleSided and some asset windings face away;
    // culling would make flat objects (flags, coins edge) invisible from one side.
    this.canvas = canvas;
  }

  // Upload a model's meshes to GPU, return a renderable model object
  uploadModel(model, materialType, color) {
    const gl = this.gl;
    const gpuMeshes = [];
    for (const m of model.meshes) {
      const prims = m.primitives.map(p => makeGpuMesh(gl, p));
      gpuMeshes.push({ prims });
    }
    return { model, gpuMeshes, materialType, color };
  }

  setViewProj(viewProj, camPos) {
    const gl = this.gl;
    gl.uniformMatrix4fv(this.loc.uViewProj, false, viewProj);
    gl.uniform3fv(this.loc.uCamPos, camPos);
  }
  setLight(dir) {
    this.gl.uniform3fv(this.loc.uLightDir, dir);
  }
  setTime(t) {
    if (this.loc.uTime) this.gl.uniform1f(this.loc.uTime, t);
  }

  // jointMatrices: Float32Array of length 8*16 (padded with identity), or null
  drawModelMeshes(gpuModel, modelMatrix, jointMatrices) {
    const gl = this.gl;
    const model = gpuModel.model;
    gl.uniformMatrix4fv(this.loc.uModel, false, modelMatrix);
    gl.uniform3fv(this.loc.uColor, gpuModel.color);
    gl.uniform1i(this.loc.uMaterialType, gpuModel.materialType);
    for (let ni = 0; ni < model.nodes.length; ni++) {
      const node = model.nodes[ni];
      if (node.mesh === null) continue;
      const gpuMesh = gpuModel.gpuMeshes[node.mesh];
      const skinIdx = node.skin;
      const skinned = skinIdx !== null && skinIdx !== undefined;
      gl.uniform1f(this.loc.uSkinned, skinned ? 1.0 : 0.0);
      if (skinned && jointMatrices) {
        // upload 8 joint matrices
        gl.uniformMatrix4fv(this.loc.uJointMatrix, false, jointMatrices);
      } else if (skinned) {
        gl.uniformMatrix4fv(this.loc.uJointMatrix, false, IDENTITY8);
      }
      for (const prim of gpuMesh.prims) {
        gl.bindBuffer(gl.ARRAY_BUFFER, prim.posBuf);
        gl.enableVertexAttribArray(this.loc.aPosition);
        gl.vertexAttribPointer(this.loc.aPosition, 3, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, prim.normBuf);
        gl.enableVertexAttribArray(this.loc.aNormal);
        gl.vertexAttribPointer(this.loc.aNormal, 3, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, prim.jointBuf);
        gl.enableVertexAttribArray(this.loc.aJoints);
        gl.vertexAttribPointer(this.loc.aJoints, 4, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, prim.weightBuf);
        gl.enableVertexAttribArray(this.loc.aWeights);
        gl.vertexAttribPointer(this.loc.aWeights, 4, gl.FLOAT, false, 0, 0);
        if (prim.hasIndex) {
          gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, prim.idxBuf);
          gl.drawElements(gl.TRIANGLES, prim.indexCount, prim.idxType, 0);
        } else {
          gl.drawArrays(gl.TRIANGLES, 0, prim.vertexCount);
        }
      }
    }
  }

  clear(r, g, b) {
    const gl = this.gl;
    gl.clearColor(r, g, b, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  }
  useProgram() { this.gl.useProgram(this.prog); }
  viewport() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.floor(this.canvas.clientWidth * dpr);
    const h = Math.floor(this.canvas.clientHeight * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w; this.canvas.height = h;
    }
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }
}

const IDENTITY8 = new Float32Array(8 * 16);
for (let i = 0; i < 8; i++) IDENTITY8[i*16] = IDENTITY8[i*16+5] = IDENTITY8[i*16+10] = IDENTITY8[i*16+15] = 1;

// Compute joint matrices for a skin: jointMatrix[j] = jointWorld * inverseBind[j]
// Returns Float32Array(8*16) padded with identity.
function computeJointMatrices(model, skinIdx) {
  const skin = model.skins[skinIdx];
  const out = new Float32Array(8 * 16);
  for (let i = 0; i < skin.joints.length; i++) {
    const jointNode = model.nodes[skin.joints[i]];
    const jm = Mat4.multiply(jointNode.world, skin.inverseBind.subarray(i*16, i*16+16));
    out.set(jm, i*16);
  }
  // pad rest with identity
  for (let i = skin.joints.length; i < 8; i++) {
    out[i*16] = out[i*16+5] = out[i*16+10] = out[i*16+15] = 1;
  }
  return out;
}

return { R, computeJointMatrices };

})();

window.Renderer = Renderer;
