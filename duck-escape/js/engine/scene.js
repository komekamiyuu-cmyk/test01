/* ============================================================
   シーングラフ(親子関係を持つ「ノード」)とカメラ
   キャラは「ノードを組み合わせた木」で作り、ノードを回すと
   手足が動く……という仕組み。
   ============================================================ */

import { mat4, compose, multiply, perspective, lookAt } from './math.js';

/** 描画されるノード(mesh が null なら「入れ物」として使える) */
export function node(opts = {}) {
  return {
    mesh: opts.mesh || null,
    color: opts.color || [1, 1, 1],
    emissive: opts.emissive || 0,
    opacity: opts.opacity == null ? 1 : opts.opacity,
    transparent: !!opts.transparent,
    depthWrite: opts.depthWrite !== false,
    visible: opts.visible !== false,
    pos: { x: opts.x || 0, y: opts.y || 0, z: opts.z || 0 },
    rot: { x: opts.rx || 0, y: opts.ry || 0, z: opts.rz || 0 },
    scale: typeof opts.scale === 'number'
      ? { x: opts.scale, y: opts.scale, z: opts.scale }
      : { x: opts.sx == null ? 1 : opts.sx, y: opts.sy == null ? 1 : opts.sy, z: opts.sz == null ? 1 : opts.sz },
    children: [],
    local: mat4(),
    world: mat4(),
  };
}

export function add(parent, ...kids) {
  for (const k of kids) parent.children.push(k);
  return kids[0];
}

export function remove(parent, kid) {
  const i = parent.children.indexOf(kid);
  if (i >= 0) parent.children.splice(i, 1);
}

/** ワールド行列を計算しながら、描画リストを組み立てる */
export function collect(n, parentWorld, out) {
  if (!n.visible) return out;
  compose(n.local, n.pos, n.rot, n.scale);
  if (parentWorld) multiply(n.world, parentWorld, n.local);
  else n.world.set(n.local);
  if (n.mesh) {
    out.push({
      mesh: n.mesh, matrix: n.world, color: n.color,
      emissive: n.emissive, opacity: n.opacity,
      transparent: n.transparent, depthWrite: n.depthWrite,
    });
  }
  for (const c of n.children) collect(c, n.world, out);
  return out;
}

/* ---------------- カメラ ---------------- */

export function createCamera(fovDeg = 58) {
  return {
    fov: (fovDeg * Math.PI) / 180,
    near: 0.1,
    far: 200,
    pos: { x: 0, y: 6, z: 12 },
    target: { x: 0, y: 1, z: 0 },
    proj: mat4(),
    view: mat4(),
    update(aspect) {
      perspective(this.proj, this.fov, aspect, this.near, this.far);
      lookAt(this.view, this.pos, this.target, UP);
    },
  };
}

const UP = { x: 0, y: 1, z: 0 };
