/* ============================================================
   アイテムの見た目(銃・マシンガン・手裏剣・ハート)
   拾う前の「落ちているアイテム」と、アヒルが持つ武器の
   両方で同じモデルを使う。
   ============================================================ */

import { node, add } from '../engine/scene.js';

const GUNMETAL = [0.24, 0.26, 0.33];
const GRIP = [0.32, 0.2, 0.14];

/** ピストル。+Z方向が銃口 */
export function makePistol(M) {
  const root = node({});
  add(root, node({ mesh: M.box, color: GUNMETAL, sx: 0.16, sy: 0.2, sz: 0.5, y: 0.1 }));
  add(root, node({ mesh: M.cyl, color: [0.16, 0.17, 0.22], sx: 0.055, sz: 0.055, sy: 0.42, y: 0.13, z: 0.42, rx: Math.PI / 2 }));
  add(root, node({ mesh: M.box, color: GRIP, sx: 0.13, sy: 0.26, sz: 0.15, y: -0.06, z: -0.14, rx: 0.25 }));
  add(root, node({ mesh: M.box, color: [0.9, 0.75, 0.3], sx: 0.06, sy: 0.05, sz: 0.06, y: 0.22, z: 0.1, emissive: 0.5 }));
  return root;
}

/** マシンガン(ピストルより長い) */
export function makeMachinegun(M) {
  const root = node({});
  add(root, node({ mesh: M.box, color: [0.2, 0.22, 0.28], sx: 0.18, sy: 0.22, sz: 0.78, y: 0.1, z: 0.05 }));
  add(root, node({ mesh: M.cyl, color: [0.14, 0.15, 0.2], sx: 0.06, sz: 0.06, sy: 0.6, y: 0.13, z: 0.62, rx: Math.PI / 2 }));
  add(root, node({ mesh: M.box, color: [0.35, 0.35, 0.4], sx: 0.11, sy: 0.3, sz: 0.14, y: -0.08, z: 0.12 }));   // 弾倉
  add(root, node({ mesh: M.box, color: GRIP, sx: 0.13, sy: 0.24, sz: 0.15, y: -0.05, z: -0.22, rx: 0.3 }));
  add(root, node({ mesh: M.box, color: GRIP, sx: 0.12, sy: 0.16, sz: 0.3, y: 0.08, z: -0.4 }));                 // 銃床
  return root;
}

/** 手裏剣。板を寝かせてあるので root.rot.y でくるくる回る */
export function makeShuriken(M, scale = 1) {
  const root = node({});
  const spin = add(root, node({ rx: Math.PI / 2 }));
  add(spin, node({ mesh: M.star, color: [0.78, 0.82, 0.9], scale: 0.34 * scale }));
  add(spin, node({ mesh: M.cyl, color: [0.1, 0.11, 0.15], sx: 0.09 * scale, sz: 0.09 * scale, sy: 0.14 * scale, rx: Math.PI / 2 }));
  return { root, spin };
}

/** ハート(回復) */
export function makeHeart(M) {
  const root = node({});
  const c = [0.98, 0.28, 0.42];
  add(root, node({ mesh: M.sphereLo, color: c, scale: 0.2, x: -0.14, y: 0.14 }));
  add(root, node({ mesh: M.sphereLo, color: c, scale: 0.2, x: 0.14, y: 0.14 }));
  add(root, node({ mesh: M.cone, color: c, sx: 0.29, sz: 0.29, sy: 0.42, y: -0.13, rz: Math.PI }));
  return root;
}

/** 落ちているアイテムの足元の光(拾えることが分かるように) */
export function makeGlow(M, color) {
  return node({ mesh: M.disc, color, scale: 1.05, y: 0.03, transparent: true, opacity: 0.35, depthWrite: false, emissive: 1 });
}

/** 種類名からモデルを作る */
export function makeWeaponModel(M, id) {
  if (id === 'pistol') return { root: makePistol(M), spin: null };
  if (id === 'machinegun') return { root: makeMachinegun(M), spin: null };
  return makeShuriken(M);
}
