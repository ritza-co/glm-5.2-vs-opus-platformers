// WebGL2 renderer: two GLSL programs (static + skinned), a shared colormap
// texture, simple directional lighting, and per-instance draw helpers.

import { mat4 } from './math.js';

const STATIC_VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec2 aUV;
uniform mat4 uProj;
uniform mat4 uView;
uniform mat4 uModel;
uniform mat3 uNormalMat;
out vec3 vNormal;
out vec2 vUV;
out vec3 vWorldPos;
void main() {
  vec4 world = uModel * vec4(aPos, 1.0);
  vWorldPos = world.xyz;
  vNormal = normalize(uNormalMat * aNormal);
  vUV = aUV;
  gl_Position = uProj * uView * world;
}`;

const FRAG = `#version 300 es
precision highp float;
in vec3 vNormal;
in vec2 vUV;
in vec3 vWorldPos;
uniform sampler2D uTex;
uniform vec3 uLightDir;   // direction TO the light, normalized
uniform vec4 uTint;       // multiplied over texture (rgb), a = extra
uniform float uEmissive;  // 0..1 self-illumination for collectibles
out vec4 fragColor;
void main() {
  vec3 N = normalize(vNormal);
  float diff = max(dot(N, uLightDir), 0.0);
  float ambient = 0.45;
  float light = ambient + diff * 0.75;
  vec4 tex = texture(uTex, vUV);
  vec3 base = tex.rgb * uTint.rgb;
  vec3 lit = base * light;
  // Emissive collectibles get a glow that ignores shading.
  vec3 col = mix(lit, base * 1.25, uEmissive);
  fragColor = vec4(col, 1.0);
}`;

const SKINNED_VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec2 aUV;
layout(location=3) in vec4 aJoints;
layout(location=4) in vec4 aWeights;
uniform mat4 uProj;
uniform mat4 uView;
uniform mat4 uModel;
uniform mat3 uNormalMat;
uniform mat4 uJoints[24];
out vec3 vNormal;
out vec2 vUV;
out vec3 vWorldPos;
void main() {
  mat4 skin =
      aWeights.x * uJoints[int(aJoints.x)] +
      aWeights.y * uJoints[int(aJoints.y)] +
      aWeights.z * uJoints[int(aJoints.z)] +
      aWeights.w * uJoints[int(aJoints.w)];
  vec4 skinned = skin * vec4(aPos, 1.0);
  vec4 world = uModel * skinned;
  vWorldPos = world.xyz;
  // Approximate normal skinning with the same matrices (uniform scale rig).
  mat3 skin3 = mat3(skin);
  vNormal = normalize(uNormalMat * (skin3 * aNormal));
  vUV = aUV;
  gl_Position = uProj * uView * world;
}`;

export class Renderer {
  constructor(canvas) {
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error('WebGL2 not supported');
    this.gl = gl;
    this.canvas = canvas;

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.clearColor(0.53, 0.81, 0.98, 1.0); // sky blue

    this.staticProg = this._program(STATIC_VS, FRAG);
    this.skinnedProg = this._program(SKINNED_VS, FRAG);

    this.staticU = this._uniforms(this.staticProg, ['uProj', 'uView', 'uModel', 'uNormalMat', 'uTex', 'uLightDir', 'uTint', 'uEmissive']);
    this.skinnedU = this._uniforms(this.skinnedProg, ['uProj', 'uView', 'uModel', 'uNormalMat', 'uTex', 'uLightDir', 'uTint', 'uEmissive', 'uJoints']);

    this._normalMat = new Float32Array(9);
    this._lightDir = new Float32Array([0.4, 0.85, 0.35]);
    const l = Math.hypot(...this._lightDir);
    this._lightDir = this._lightDir.map((v) => v / l);
  }

  _program(vsSrc, fsSrc) {
    const gl = this.gl;
    const vs = this._shader(gl.VERTEX_SHADER, vsSrc);
    const fs = this._shader(gl.FRAGMENT_SHADER, fsSrc);
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error('Program link error: ' + gl.getProgramInfoLog(prog));
    }
    return prog;
  }

  _shader(type, src) {
    const gl = this.gl;
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(sh);
      throw new Error(`Shader compile error (${type === gl.VERTEX_SHADER ? 'vertex' : 'fragment'}): ${log}\n${src}`);
    }
    return sh;
  }

  _uniforms(prog, names) {
    const gl = this.gl;
    const u = {};
    for (const n of names) u[n] = gl.getUniformLocation(prog, n);
    return u;
  }

  // Upload the shared colormap texture from an Image / ImageBitmap.
  createTexture(image) {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    // This is a color-palette atlas: mipmapping/linear filtering would bleed
    // neighbouring swatches together (washing small objects out to grey), so
    // sample it with NEAREST to keep every face its exact authored color.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.texture = tex;
    return tex;
  }

  resize() {
    const canvas = this.canvas;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.floor(canvas.clientWidth * dpr);
    const h = Math.floor(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    this.gl.viewport(0, 0, canvas.width, canvas.height);
    return canvas.width / Math.max(1, canvas.height);
  }

  beginFrame() {
    this.gl.clear(this.gl.COLOR_BUFFER_BIT | this.gl.DEPTH_BUFFER_BIT);
  }

  // Draw a StaticModel's primitives, each transformed by `worldMatrix`
  // (the model's own node matrices are pre-baked, so worldMatrix is the
  // placement of the whole asset in the level).
  drawStatic(model, proj, view, worldMatrix, tint = [1, 1, 1, 1], emissive = 0) {
    const gl = this.gl;
    gl.useProgram(this.staticProg);
    const U = this.staticU;
    gl.uniformMatrix4fv(U.uProj, false, proj);
    gl.uniformMatrix4fv(U.uView, false, view);
    gl.uniform3fv(U.uLightDir, this._lightDir);
    gl.uniform4fv(U.uTint, tint);
    gl.uniform1f(U.uEmissive, emissive);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.uniform1i(U.uTex, 0);

    const composed = mat4.create();
    for (const prim of model.primitives) {
      mat4.multiply(composed, worldMatrix, prim.modelMatrix);
      gl.uniformMatrix4fv(U.uModel, false, composed);
      mat4.normalFromMat4(this._normalMat, composed);
      gl.uniformMatrix3fv(U.uNormalMat, false, this._normalMat);
      gl.bindVertexArray(prim.vao);
      if (prim.indexType != null) {
        gl.drawElements(gl.TRIANGLES, prim.indexCount, prim.indexType, 0);
      } else {
        gl.drawArrays(gl.TRIANGLES, 0, prim.indexCount);
      }
    }
    gl.bindVertexArray(null);
  }

  // Draw the skinned character. worldMatrix places it in the level;
  // jointMatrices is the model's current pose.
  drawSkinned(model, proj, view, worldMatrix, jointMatrices, tint = [1, 1, 1, 1]) {
    const gl = this.gl;
    gl.useProgram(this.skinnedProg);
    const U = this.skinnedU;
    gl.uniformMatrix4fv(U.uProj, false, proj);
    gl.uniformMatrix4fv(U.uView, false, view);
    gl.uniformMatrix4fv(U.uModel, false, worldMatrix);
    mat4.normalFromMat4(this._normalMat, worldMatrix);
    gl.uniformMatrix3fv(U.uNormalMat, false, this._normalMat);
    gl.uniform3fv(U.uLightDir, this._lightDir);
    gl.uniform4fv(U.uTint, tint);
    gl.uniform1f(U.uEmissive, 0);
    gl.uniformMatrix4fv(U.uJoints, false, jointMatrices);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.uniform1i(U.uTex, 0);

    for (const prim of model.primitives) {
      gl.bindVertexArray(prim.vao);
      gl.drawElements(gl.TRIANGLES, prim.indexCount, prim.indexType, 0);
    }
    gl.bindVertexArray(null);
  }
}
