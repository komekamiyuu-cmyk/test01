/* ============================================================
   主人公「ペットのアヒル」のモデル
   前方向は +Z。root.rot.y を変えると向きが変わる。
   ============================================================ */

import { node, add } from '../engine/scene.js';
import { skinNode, setFlash } from './parts.js';
import { PALETTE } from '../config.js';
import { makeWeaponModel } from './items.js';

export function createDuck(M) {
  const skin = [];
  const root = node({});
  const body = add(root, node({ scale: 1.18 }));   // 全体をひとまわり大きく

  const W = PALETTE.duck;
  const BEAK = PALETTE.beak;

  // 胴・尾
  add(body, skinNode(skin, { mesh: M.sphere, color: W, sx: 0.62, sy: 0.56, sz: 0.82, y: 0.72 }));
  add(body, skinNode(skin, { mesh: M.cone, color: W, sx: 0.3, sz: 0.3, sy: 0.5, y: 0.92, z: -0.78, rx: -2.1 }));

  // 首と頭
  add(body, skinNode(skin, { mesh: M.cyl, color: W, sx: 0.22, sz: 0.22, sy: 0.62, y: 1.1, z: 0.2, rx: 0.3 }));
  const head = add(body, node({ y: 1.5, z: 0.34 }));
  add(head, skinNode(skin, { mesh: M.sphere, color: W, scale: 0.38 }));
  add(head, skinNode(skin, { mesh: M.cone, color: BEAK, sx: 0.22, sz: 0.15, sy: 0.5, y: -0.04, z: 0.34, rx: Math.PI / 2 }));
  for (const s of [-1, 1]) {
    add(head, node({ mesh: M.sphereLo, color: [0.08, 0.07, 0.1], scale: 0.085, x: 0.19 * s, y: 0.12, z: 0.27 }));
    add(head, node({ mesh: M.sphereLo, color: [1, 1, 1], scale: 0.034, x: 0.21 * s, y: 0.16, z: 0.31, emissive: 0.8 }));
  }

  // 飼われている証の首輪と鈴
  add(body, node({ mesh: M.cyl, color: [0.85, 0.18, 0.25], sx: 0.29, sz: 0.29, sy: 0.11, y: 1.18, z: 0.24, rx: 0.3 }));
  add(body, node({ mesh: M.sphereLo, color: [1, 0.83, 0.25], scale: 0.095, y: 1.12, z: 0.46, emissive: 0.35 }));

  // 翼(右の翼で武器を持つ)
  const wingL = add(body, node({ x: -0.55, y: 0.78 }));
  const wingR = add(body, node({ x: 0.55, y: 0.78 }));
  add(wingL, skinNode(skin, { mesh: M.sphere, color: W, sx: 0.13, sy: 0.34, sz: 0.6, x: -0.04 }));
  add(wingR, skinNode(skin, { mesh: M.sphere, color: W, sx: 0.13, sy: 0.34, sz: 0.6, x: 0.04 }));

  // 手に持つ武器(3種を作っておき、表示を切り替える)
  const hand = add(wingR, node({ x: 0.12, y: -0.12, z: 0.3 }));
  const held = {};
  for (const id of ['shuriken', 'pistol', 'machinegun']) {
    const m = makeWeaponModel(M, id);
    m.root.visible = false;
    add(hand, m.root);
    held[id] = m;
  }

  // 足
  const legs = [];
  for (const s of [-1, 1]) {
    const leg = add(body, node({ x: 0.22 * s, y: 0.44 }));
    add(leg, node({ mesh: M.cylB, color: BEAK, sx: 0.075, sz: 0.075, sy: 0.44, rz: Math.PI }));
    add(leg, node({ mesh: M.box, color: BEAK, sx: 0.2, sy: 0.06, sz: 0.3, y: -0.45, z: 0.08 }));
    legs.push(leg);
  }

  // 足元の影
  const shadow = node({ mesh: M.disc, color: [0, 0, 0], scale: 0.95, y: 0.02, transparent: true, opacity: 0.34, depthWrite: false, emissive: 1 });

  let walk = 0, flap = 0;

  return {
    root, shadow, body, head,
    /** 武器の見た目を切り替える */
    setWeapon(id) {
      for (const k in held) held[k].root.visible = (k === id);
    },
    /** 攻撃したときに少しのけぞらせる */
    recoil() { this._recoil = 0.35; },
    update(dt, st) {
      const sp = st.speed || 0;
      walk += dt * (2.2 + sp * 1.5);
      flap = Math.max(0, flap - dt * 3);
      if (st.dashing) flap = 1;

      const moving = Math.min(1, sp / 4);
      const swing = Math.sin(walk * 2) * 0.55 * moving;
      legs[0].rot.x = swing;
      legs[1].rot.x = -swing;

      body.pos.y = Math.abs(Math.sin(walk * 2)) * 0.06 * moving + (st.dashing ? 0.12 : 0);
      body.rot.z = Math.sin(walk * 2) * 0.05 * moving;
      body.rot.x = (this._recoil || 0) * -0.6 + (st.dashing ? 0.18 : 0);
      this._recoil = Math.max(0, (this._recoil || 0) - dt * 2.5);

      const f = flap * 0.9 + Math.sin(walk * 2) * 0.1 * moving;
      wingL.rot.z = -0.25 - f;
      wingR.rot.z = 0.25 + f;
      wingL.rot.x = wingR.rot.x = -f * 0.3;

      head.rot.x = Math.sin(walk * 2 + 0.6) * 0.06 * moving;
      const shu = held.shuriken;
      if (shu && shu.spin) shu.spin.rot.z += dt * 6;

      // 無敵中は点滅させる
      const inv = st.invuln || 0;
      const blink = inv > 0 ? (Math.sin(inv * 40) * 0.5 + 0.5) * 0.75 : 0;
      setFlash(skin, Math.max(blink, st.hurtFlash || 0), [1, 0.42, 0.45]);
      shadow.opacity = 0.34 - (body.pos.y * 0.5);
    },
  };
}
