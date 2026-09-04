/* ============================================================
   3Dの数学(ベクトル・4x4行列)
   外部ライブラリを使わないので、必要な分だけをここに置く。
   行列は WebGL と同じ「列優先」のFloat32Array(16)。
   ============================================================ */

/* ---------------- 角度と補間 ---------------- */

/** 角度を -PI〜PI に丸める(向きの補間で使う) */
export function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/** a から b へ、最大 maxStep だけ角度を近づける */
export function turnToward(a, b, maxStep) {
  const d = wrapAngle(b - a);
  return a + Math.max(-maxStep, Math.min(maxStep, d));
}

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;

/* ---------------- 4x4 行列 ---------------- */

export function mat4() {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

export function identity(out) {
  out.fill(0);
  out[0] = out[5] = out[10] = out[15] = 1;
  return out;
}

/** out = a * b */
export function multiply(out, a, b) {
  const a00 = a[0],  a01 = a[1],  a02 = a[2],  a03 = a[3];
  const a10 = a[4],  a11 = a[5],  a12 = a[6],  a13 = a[7];
  const a20 = a[8],  a21 = a[9],  a22 = a[10], a23 = a[11];
  const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
  for (let i = 0; i < 4; i++) {
    const b0 = b[i * 4], b1 = b[i * 4 + 1], b2 = b[i * 4 + 2], b3 = b[i * 4 + 3];
    out[i * 4]     = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
    out[i * 4 + 1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
    out[i * 4 + 2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
    out[i * 4 + 3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
  }
  return out;
}

/**
 * 位置・回転(Y→X→Zの順)・拡大から行列を作る。
 * ノード1つぶんのローカル行列はすべてこれで作られる。
 */
export function compose(out, p, r, s) {
  const cx = Math.cos(r.x), sx = Math.sin(r.x);
  const cy = Math.cos(r.y), sy = Math.sin(r.y);
  const cz = Math.cos(r.z), sz = Math.sin(r.z);

  // R = Ry * Rx * Rz を展開したもの
  const m00 = cy * cz + sy * sx * sz;
  const m01 = cx * sz;
  const m02 = -sy * cz + cy * sx * sz;
  const m10 = -cy * sz + sy * sx * cz;
  const m11 = cx * cz;
  const m12 = sy * sz + cy * sx * cz;
  const m20 = sy * cx;
  const m21 = -sx;
  const m22 = cy * cx;

  out[0] = m00 * s.x; out[1] = m01 * s.x; out[2]  = m02 * s.x; out[3]  = 0;
  out[4] = m10 * s.y; out[5] = m11 * s.y; out[6]  = m12 * s.y; out[7]  = 0;
  out[8] = m20 * s.z; out[9] = m21 * s.z; out[10] = m22 * s.z; out[11] = 0;
  out[12] = p.x; out[13] = p.y; out[14] = p.z; out[15] = 1;
  return out;
}

export function perspective(out, fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2);
  out.fill(0);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) / (near - far);
  out[11] = -1;
  out[14] = (2 * far * near) / (near - far);
  return out;
}

export function lookAt(out, eye, center, up) {
  let zx = eye.x - center.x, zy = eye.y - center.y, zz = eye.z - center.z;
  let l = Math.hypot(zx, zy, zz) || 1;
  zx /= l; zy /= l; zz /= l;

  let xx = up.y * zz - up.z * zy;
  let xy = up.z * zx - up.x * zz;
  let xz = up.x * zy - up.y * zx;
  l = Math.hypot(xx, xy, xz) || 1;
  xx /= l; xy /= l; xz /= l;

  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;

  out[0] = xx; out[1] = yx; out[2] = zx; out[3] = 0;
  out[4] = xy; out[5] = yy; out[6] = zy; out[7] = 0;
  out[8] = xz; out[9] = yz; out[10] = zz; out[11] = 0;
  out[12] = -(xx * eye.x + xy * eye.y + xz * eye.z);
  out[13] = -(yx * eye.x + yy * eye.y + yz * eye.z);
  out[14] = -(zx * eye.x + zy * eye.y + zz * eye.z);
  out[15] = 1;
  return out;
}

/**
 * 法線用の3x3行列(モデル行列の左上3x3の逆転置)。
 * 押しつぶした球など、拡大が均等でない形でも陰影が崩れないようにする。
 */
export function normalMatrix(out9, m) {
  const a = m[0], b = m[1], c = m[2];
  const d = m[4], e = m[5], f = m[6];
  const g = m[8], h = m[9], i = m[10];

  const A =  (e * i - f * h), B = -(d * i - f * g), C =  (d * h - e * g);
  let det = a * A + b * B + c * C;
  if (!det) { out9.set([1, 0, 0, 0, 1, 0, 0, 0, 1]); return out9; }
  det = 1 / det;

  // 逆行列の転置 = 余因子行列 / det(そのまま列に並べる)
  out9[0] = A * det;
  out9[1] = B * det;
  out9[2] = C * det;
  out9[3] = -(b * i - c * h) * det;
  out9[4] =  (a * i - c * g) * det;
  out9[5] = -(a * h - b * g) * det;
  out9[6] =  (b * f - c * e) * det;
  out9[7] = -(a * f - c * d) * det;
  out9[8] =  (a * e - b * d) * det;
  return out9;
}
