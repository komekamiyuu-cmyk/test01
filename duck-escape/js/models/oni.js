/* ============================================================
   敵「鬼」のモデル(赤鬼=金棒で殴る / 青鬼=鬼火を投げる)
   前方向は +Z。アヒルよりずっと大きく作って怖さを出す。
   ============================================================ */

import { node, add } from '../engine/scene.js';
import { skinNode, setFlash, healthBar } from './parts.js';

const IVORY = [0.94, 0.92, 0.82];
const CLOTH = [0.95, 0.78, 0.22];
const DARK = [0.09, 0.08, 0.12];

export function createOni(M, def) {
  const skin = [];
  const root = node({});
  const body = add(root, node({}));
  const C = def.color, C2 = def.skin2;

  // 胴体と腹
  add(body, skinNode(skin, { mesh: M.sphere, color: C, sx: 0.9, sy: 0.95, sz: 0.75, y: 2.0 }));
  add(body, skinNode(skin, { mesh: M.sphere, color: C2, sx: 0.72, sy: 0.6, sz: 0.5, y: 1.72, z: 0.42 }));

  // 虎柄のパンツ
  add(body, node({ mesh: M.box, color: CLOTH, sx: 1.5, sy: 0.75, sz: 1.25, y: 1.28 }));
  for (let i = -1; i <= 1; i++) {
    add(body, node({ mesh: M.box, color: [0.35, 0.24, 0.1], sx: 0.14, sy: 0.66, sz: 1.28, x: i * 0.42, y: 1.28 }));
  }

  // 首と頭
  add(body, skinNode(skin, { mesh: M.cyl, color: C2, sx: 0.34, sz: 0.34, sy: 0.4, y: 2.78 }));
  const head = add(body, node({ y: 3.28 }));
  add(head, skinNode(skin, { mesh: M.sphere, color: C, sx: 0.68, sy: 0.66, sz: 0.62 }));
  add(head, node({ mesh: M.box, color: DARK, sx: 0.5, sy: 0.15, sz: 0.2, y: 0.24, z: 0.5, rz: 0.3, x: -0.25 }));
  add(head, node({ mesh: M.box, color: DARK, sx: 0.5, sy: 0.15, sz: 0.2, y: 0.24, z: 0.5, rz: -0.3, x: 0.25 }));
  for (const s of [-1, 1]) {
    add(head, node({ mesh: M.sphereLo, color: [1, 0.92, 0.35], scale: 0.14, x: 0.26 * s, y: 0.06, z: 0.5, emissive: 0.85 }));
    add(head, node({ mesh: M.cone, color: IVORY, sx: 0.16, sz: 0.16, sy: 0.62, x: 0.3 * s, y: 0.78, z: -0.04, rz: -0.28 * s }));
  }
  // 口と牙
  add(head, node({ mesh: M.box, color: [0.2, 0.05, 0.08], sx: 0.46, sy: 0.2, sz: 0.14, y: -0.3, z: 0.52 }));
  for (const s of [-1, 1]) {
    add(head, node({ mesh: M.cone, color: IVORY, sx: 0.06, sz: 0.06, sy: 0.16, x: 0.14 * s, y: -0.36, z: 0.56, rz: Math.PI }));
  }
  // もじゃもじゃの髪(後頭部と頭のてっぺんだけ)
  for (let i = 0; i < 7; i++) {
    const a = Math.PI * 0.15 + (i / 6) * Math.PI * 0.7;
    add(head, node({ mesh: M.sphereLo, color: [0.15, 0.1, 0.13], scale: 0.26,
      x: Math.cos(a * 2) * 0.4, y: 0.36 + Math.sin(a) * 0.16, z: -0.28 - Math.sin(a) * 0.2 }));
  }

  // 腕
  const armL = add(body, node({ x: -0.9, y: 2.5 }));
  const armR = add(body, node({ x: 0.9, y: 2.5 }));
  for (const [arm, s] of [[armL, -1], [armR, 1]]) {
    add(arm, skinNode(skin, { mesh: M.sphereLo, color: C, scale: 0.36 }));               // 肩
    add(arm, skinNode(skin, { mesh: M.cylB, color: C, sx: 0.23, sz: 0.23, sy: 1.25, rz: Math.PI }));
    add(arm, skinNode(skin, { mesh: M.sphereLo, color: C, scale: 0.27, y: -1.3 }));
  }

  // 赤鬼の金棒 / 青鬼の鬼火
  let club = null, orb = null;
  if (def.style === 'melee') {
    club = add(armR, node({ y: -1.35, z: 0.1, rx: 0.4 }));
    add(club, node({ mesh: M.cylB, color: [0.36, 0.24, 0.15], sx: 0.13, sz: 0.13, sy: 1.9 }));
    add(club, node({ mesh: M.cylB, color: [0.3, 0.2, 0.13], sx: 0.26, sz: 0.26, sy: 1.1, y: 0.9 }));
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 * 1.7;
      add(club, node({ mesh: M.sphereLo, color: [0.62, 0.62, 0.68], scale: 0.09,
        x: Math.cos(a) * 0.26, z: Math.sin(a) * 0.26, y: 1.0 + (i % 5) * 0.18 }));
    }
  } else {
    orb = add(armR, node({ y: -1.5, z: 0.35, visible: false }));
    add(orb, node({ mesh: M.sphere, color: [0.6, 0.85, 1], scale: 0.34, emissive: 1 }));
    add(orb, node({ mesh: M.sphere, color: [0.35, 0.6, 1], scale: 0.55, emissive: 1, transparent: true, opacity: 0.35, depthWrite: false }));
  }

  // 脚
  const legs = [];
  for (const s of [-1, 1]) {
    const leg = add(body, node({ x: 0.45 * s, y: 1.15 }));
    add(leg, skinNode(skin, { mesh: M.cylB, color: C2, sx: 0.28, sz: 0.28, sy: 1.15, rz: Math.PI }));
    add(leg, node({ mesh: M.box, color: [0.2, 0.16, 0.14], sx: 0.44, sy: 0.18, sz: 0.7, y: -1.2, z: 0.14 }));
    legs.push(leg);
  }

  const shadow = node({ mesh: M.disc, color: [0, 0, 0], scale: def.radius * 1.35, y: 0.02,
    transparent: true, opacity: 0.4, depthWrite: false, emissive: 1 });

  const bar = healthBar(M, 1.9);
  bar.root.pos.y = 4.5;
  add(root, bar.root);

  let walk = 0;

  return {
    root, body, head, shadow, bar, orb,
    /**
     * st: { speed, phase, t, flash, hpRatio, camYaw }
     * phase … walk / windup / attack / cast / down
     */
    update(dt, st) {
      const sp = st.speed || 0;
      walk += dt * (1.6 + sp * 1.15);
      const moving = Math.min(1, sp / 3);
      const swing = Math.sin(walk * 2) * 0.7 * moving;

      legs[0].rot.x = swing;
      legs[1].rot.x = -swing;
      body.pos.y = Math.abs(Math.sin(walk * 2)) * 0.1 * moving;
      body.rot.z = Math.sin(walk * 2) * 0.04 * moving;
      head.rot.z = Math.sin(walk * 2 + 1) * 0.05;

      armL.rot.x = -swing * 0.8;
      armR.rot.x = swing * 0.8;
      armL.rot.z = -0.16;
      armR.rot.z = 0.16;

      if (st.phase === 'windup') {
        // 大きく振りかぶる(プレイヤーに「来るぞ」と伝える)
        const t = st.t;
        armR.rot.x = -2.4 * t;
        armR.rot.z = 0.16 + 0.5 * t;
        body.rot.x = -0.18 * t;
        if (orb) { orb.visible = true; orb.scale.x = orb.scale.y = orb.scale.z = 0.4 + t * 0.9; }
      } else if (st.phase === 'attack') {
        const t = st.t;
        armR.rot.x = -2.4 + 3.6 * Math.min(1, t * 2.6);
        body.rot.x = 0.3 * Math.min(1, t * 2.6);
        if (orb) orb.visible = false;
      } else {
        body.rot.x = 0;
        if (orb) orb.visible = false;
      }

      if (st.phase === 'down') {
        // 倒れる
        body.rot.x = -1.5;
        body.pos.y = -0.6;
        bar.root.visible = false;
      }

      bar.set(st.hpRatio, def.id === 'red' ? [1, 0.42, 0.32] : [0.45, 0.72, 1]);
      bar.root.rot.y = st.camYaw || 0;
      setFlash(skin, st.flash || 0);
    },
  };
}
