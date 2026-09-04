/* ============================================================
   演出(粒 と 波紋)
   ノードを使い回すプール方式。増えすぎて重くならないようにする。
   ============================================================ */

import { node, add } from '../engine/scene.js';

const MAX_PARTICLES = 150;
const MAX_RINGS = 14;

export function createEffects(M, parent) {
  const root = add(parent, node({}));

  const particles = [];
  for (let i = 0; i < MAX_PARTICLES; i++) {
    const n = add(root, node({ mesh: M.box, visible: false, emissive: 0.6 }));
    particles.push({ n, life: 0, max: 1, vx: 0, vy: 0, vz: 0, spin: 0, grav: -14, drag: 1 });
  }
  const rings = [];
  for (let i = 0; i < MAX_RINGS; i++) {
    const n = add(root, node({ mesh: M.disc, visible: false, transparent: true, depthWrite: false, emissive: 1 }));
    rings.push({ n, life: 0, max: 1, from: 0.4, to: 3 });
  }

  let cursor = 0, ringCursor = 0;

  function take() {
    // 一番古いものから順に使い回す
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = particles[(cursor + i) % MAX_PARTICLES];
      if (p.life <= 0) { cursor = (cursor + i + 1) % MAX_PARTICLES; return p; }
    }
    const p = particles[cursor];
    cursor = (cursor + 1) % MAX_PARTICLES;
    return p;
  }

  return {
    root,
    /** はじけるように粒をまき散らす */
    burst(x, y, z, count, color, opt = {}) {
      const speed = opt.speed || 6;
      const size = opt.size || 0.16;
      const life = opt.life || 0.6;
      for (let i = 0; i < count; i++) {
        const p = take();
        const a = Math.random() * Math.PI * 2;
        const up = opt.up == null ? Math.random() : opt.up;
        const s = speed * (0.5 + Math.random() * 0.8);
        p.vx = Math.cos(a) * s * (opt.dirX || 1);
        p.vz = Math.sin(a) * s * (opt.dirZ || 1);
        p.vy = up * speed * 0.9;
        if (opt.dir) {   // 進行方向へ飛ばす(弾のヒットなど)
          p.vx += opt.dir.x * speed * 0.7;
          p.vz += opt.dir.z * speed * 0.7;
        }
        p.grav = opt.grav == null ? -16 : opt.grav;
        p.drag = opt.drag == null ? 2.4 : opt.drag;
        p.spin = (Math.random() - 0.5) * 14;
        p.max = p.life = life * (0.6 + Math.random() * 0.7);
        const n = p.n;
        n.visible = true;
        n.pos.x = x; n.pos.y = y; n.pos.z = z;
        n.rot.x = Math.random() * 3; n.rot.y = Math.random() * 3; n.rot.z = Math.random() * 3;
        n.scale.x = n.scale.y = n.scale.z = size * (0.6 + Math.random() * 0.8);
        n.color = color.slice ? color.slice() : color;
        n.emissive = opt.emissive == null ? 0.5 : opt.emissive;
        n.transparent = true;
        n.depthWrite = false;
        n.opacity = 1;
      }
    },
    /** 地面に広がる波紋(着弾やゲート演出) */
    ring(x, y, z, color, from = 0.5, to = 3.4, life = 0.45) {
      const r = rings[ringCursor];
      ringCursor = (ringCursor + 1) % MAX_RINGS;
      r.life = r.max = life;
      r.from = from; r.to = to;
      r.n.visible = true;
      r.n.pos.x = x; r.n.pos.y = y; r.n.pos.z = z;
      r.n.color = color;
      r.n.opacity = 0.6;
    },
    update(dt) {
      for (const p of particles) {
        if (p.life <= 0) continue;
        p.life -= dt;
        if (p.life <= 0) { p.n.visible = false; continue; }
        p.vy += p.grav * dt;
        const k = Math.max(0, 1 - p.drag * dt);
        p.vx *= k; p.vz *= k;
        p.n.pos.x += p.vx * dt;
        p.n.pos.y += p.vy * dt;
        p.n.pos.z += p.vz * dt;
        if (p.n.pos.y < 0.05) { p.n.pos.y = 0.05; p.vy *= -0.35; p.vx *= 0.6; p.vz *= 0.6; }
        p.n.rot.x += p.spin * dt;
        p.n.rot.y += p.spin * dt * 0.7;
        p.n.opacity = Math.min(1, (p.life / p.max) * 1.6);
      }
      for (const r of rings) {
        if (r.life <= 0) continue;
        r.life -= dt;
        if (r.life <= 0) { r.n.visible = false; continue; }
        const t = 1 - r.life / r.max;
        const s = r.from + (r.to - r.from) * t;
        r.n.scale.x = r.n.scale.z = s;
        r.n.opacity = 0.6 * (1 - t);
      }
    },
  };
}
