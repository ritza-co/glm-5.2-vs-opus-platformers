// mat4.js - minimal column-major matrix / vector / quaternion math for WebGL
"use strict";

const Vec3 = {
  create(x = 0, y = 0, z = 0) { return [x, y, z]; },
  set(v, x, y, z) { v[0]=x; v[1]=y; v[2]=z; return v; },
  add(a, b) { return [a[0]+b[0], a[1]+b[1], a[2]+b[2]]; },
  sub(a, b) { return [a[0]-b[0], a[1]-b[1], a[2]-b[2]]; },
  scale(a, s) { return [a[0]*s, a[1]*s, a[2]*s]; },
  dot(a, b) { return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]; },
  cross(a, b) { return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]; },
  len(a) { return Math.hypot(a[0], a[1], a[2]); },
  norm(a) { const l = Math.hypot(a[0],a[1],a[2]) || 1; return [a[0]/l, a[1]/l, a[2]/l]; },
  lerp(a, b, t) { return [a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t, a[2]+(b[2]-a[2])*t]; },
  dist(a, b) { return Math.hypot(a[0]-b[0], a[1]-b[1], a[2]-b[2]); },
};

const Quat = {
  identity() { return [0,0,0,1]; },
  fromAxisAngle(ax, ay, az, angle) {
    const half = angle * 0.5;
    const s = Math.sin(half);
    return [ax*s, ay*s, az*s, Math.cos(half)];
  },
  fromEulerY(yaw) { return Quat.fromAxisAngle(0,1,0,yaw); },
  // multiply q1 then q2 (apply q2 first? convention: result rotates by q1 then q2)
  // We use: r = q2 * q1 meaning apply q1 first. For our needs we mostly set yaw directly.
  multiply(a, b) {
    // Hamilton product: a*b
    return [
      a[3]*b[0] + a[0]*b[3] + a[1]*b[2] - a[2]*b[1],
      a[3]*b[1] - a[0]*b[2] + a[1]*b[3] + a[2]*b[0],
      a[3]*b[2] + a[0]*b[1] - a[1]*b[0] + a[2]*b[3],
      a[3]*b[3] - a[0]*b[0] - a[1]*b[1] - a[2]*b[2],
    ];
  },
  norm(q) { const l = Math.hypot(q[0],q[1],q[2],q[3]) || 1; return [q[0]/l,q[1]/l,q[2]/l,q[3]/l]; },
  slerp(a, b, t) {
    let dot = a[0]*b[0]+a[1]*b[1]+a[2]*b[2]+a[3]*b[3];
    let b2 = b.slice();
    if (dot < 0) { b2 = b.map(c=>-c); dot = -dot; }
    if (dot > 0.9995) {
      return Quat.norm([
        a[0]+(b2[0]-a[0])*t,
        a[1]+(b2[1]-a[1])*t,
        a[2]+(b2[2]-a[2])*t,
        a[3]+(b2[3]-a[3])*t,
      ]);
    }
    const theta = Math.acos(dot);
    const sinTheta = Math.sin(theta);
    const s0 = Math.sin((1-t)*theta)/sinTheta;
    const s1 = Math.sin(t*theta)/sinTheta;
    return [
      s0*a[0]+s1*b2[0],
      s0*a[1]+s1*b2[1],
      s0*a[2]+s1*b2[2],
      s0*a[3]+s1*b2[3],
    ];
  },
};

const Mat4 = {
  identity() {
    const m = new Float32Array(16);
    m[0]=m[5]=m[10]=m[15]=1;
    return m;
  },
  clone(m) { return new Float32Array(m); },
  multiply(a, b) {
    // a*b, column-major: out[col*4+row] = sum_k a[k*4+row]*b[col*4+k]
    const out = new Float32Array(16);
    for (let r=0;r<4;r++){
      for (let c=0;c<4;c++){
        let s=0;
        for (let k=0;k<4;k++) s += a[k*4+r]*b[c*4+k];
        out[c*4+r]=s;
      }
    }
    return out;
  },
  multiplyInto(out, a, b) {
    for (let r=0;r<4;r++){
      for (let c=0;c<4;c++){
        let s=0;
        for (let k=0;k<4;k++) s += a[k*4+r]*b[c*4+k];
        out[c*4+r]=s;
      }
    }
    return out;
  },
  translation(x, y, z) {
    const m = Mat4.identity();
    m[12]=x; m[13]=y; m[14]=z;
    return m;
  },
  scaling(x, y, z) {
    const m = Mat4.identity();
    m[0]=x; m[5]=y; m[10]=z;
    return m;
  },
  rotationY(a) {
    const c=Math.cos(a), s=Math.sin(a);
    const m = Mat4.identity();
    m[0]=c; m[2]=-s; m[8]=s; m[10]=c;
    return m;
  },
  rotationX(a) {
    const c=Math.cos(a), s=Math.sin(a);
    const m = Mat4.identity();
    m[5]=c; m[6]=s; m[9]=-s; m[10]=c;
    return m;
  },
  perspective(fovy, aspect, near, far) {
    const f = 1.0/Math.tan(fovy/2);
    const m = new Float32Array(16);
    m[0]=f/aspect;
    m[5]=f;
    m[10]=(far+near)/(near-far);
    m[11]=-1;
    m[14]=(2*far*near)/(near-far);
    return m;
  },
  lookAt(eye, target, up) {
    const z = Vec3.norm(Vec3.sub(eye, target)); // forward (eye-target)
    const x = Vec3.norm(Vec3.cross(up, z));
    const y = Vec3.cross(z, x);
    const m = new Float32Array(16);
    m[0]=x[0]; m[1]=y[0]; m[2]=z[0]; m[3]=0;
    m[4]=x[1]; m[5]=y[1]; m[6]=z[1]; m[7]=0;
    m[8]=x[2]; m[9]=y[2]; m[10]=z[2]; m[11]=0;
    m[12]=-Vec3.dot(x,eye); m[13]=-Vec3.dot(y,eye); m[14]=-Vec3.dot(z,eye); m[15]=1;
    return m;
  },
  fromTRS(t, q, s) {
    const x=q[0], y=q[1], z=q[2], w=q[3];
    const x2=x+x, y2=y+y, z2=z+z;
    const xx=x*x2, xy=x*y2, xz=x*z2;
    const yy=y*y2, yz=y*z2, zz=z*z2;
    const wx=w*x2, wy=w*y2, wz=w*z2;
    const m = new Float32Array(16);
    m[0]=(1-(yy+zz))*s[0];
    m[1]=(xy+wz)*s[0];
    m[2]=(xz-wy)*s[0];
    m[3]=0;
    m[4]=(xy-wz)*s[1];
    m[5]=(1-(xx+zz))*s[1];
    m[6]=(yz+wx)*s[1];
    m[7]=0;
    m[8]=(xz+wy)*s[2];
    m[9]=(yz-wx)*s[2];
    m[10]=(1-(xx+yy))*s[2];
    m[11]=0;
    m[12]=t[0]; m[13]=t[1]; m[14]=t[2]; m[15]=1;
    return m;
  },
  invert(m) {
    const out = new Float32Array(16);
    const a00=m[0],a01=m[1],a02=m[2],a03=m[3];
    const a10=m[4],a11=m[5],a12=m[6],a13=m[7];
    const a20=m[8],a21=m[9],a22=m[10],a23=m[11];
    const a30=m[12],a31=m[13],a32=m[14],a33=m[15];
    const b00=a00*a11-a01*a10, b01=a00*a12-a02*a10, b02=a00*a13-a03*a10;
    const b03=a01*a12-a02*a11, b04=a01*a13-a03*a11, b05=a02*a13-a03*a12;
    const b06=a20*a31-a21*a30, b07=a20*a32-a22*a30, b08=a20*a33-a23*a30;
    const b09=a21*a32-a22*a31, b10=a21*a33-a23*a31, b11=a22*a33-a23*a32;
    let det = b00*b11-b01*b10+b02*b09+b03*b08-b04*b07+b05*b06;
    if (!det) return Mat4.identity();
    det = 1.0/det;
    out[0]=(a11*b11-a12*b10+a13*b09)*det;
    out[1]=(a02*b10-a01*b11-a03*b09)*det;
    out[2]=(a31*b05-a32*b04+a33*b03)*det;
    out[3]=(a22*b04-a21*b05-a23*b03)*det;
    out[4]=(a12*b08-a10*b11-a13*b07)*det;
    out[5]=(a00*b11-a02*b08+a03*b07)*det;
    out[6]=(a32*b02-a30*b05-a33*b01)*det;
    out[7]=(a20*b05-a22*b02+a23*b01)*det;
    out[8]=(a10*b10-a11*b08+a13*b06)*det;
    out[9]=(a01*b08-a00*b10-a03*b06)*det;
    out[10]=(a30*b04-a31*b02+a33*b00)*det;
    out[11]=(a21*b02-a20*b04-a23*b00)*det;
    out[12]=(a11*b07-a10*b09-a12*b06)*det;
    out[13]=(a00*b09-a01*b07+a02*b06)*det;
    out[14]=(a31*b01-a30*b03-a32*b00)*det;
    out[15]=(a20*b03-a21*b01+a22*b00)*det;
    return out;
  },
  // extract translation
  getTranslation(m) { return [m[12], m[13], m[14]]; },
};

window.Vec3 = Vec3;
window.Quat = Quat;
window.Mat4 = Mat4;
