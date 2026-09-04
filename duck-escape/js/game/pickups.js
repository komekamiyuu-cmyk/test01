/* ============================================================
   落ちているアイテム(銃・マシンガン・手裏剣・ハート)
   ふわふわ浮かせて、近づくと拾える。
   ============================================================ */

import { node, add } from '../engine/scene.js';
import { makeWeaponModel, makeHeart, makeGlow } from '../models/items.js';
import { ARENA, PICKUPS } from '../config.js';

const GLOW_COLOR = {
  pistol: [1, 0.85, 0.4],
  machinegun: [1, 0.6, 0.3],
  shuriken: [0.6, 0.85, 1],
  heart: [1, 0.4, 0.55],
};

export function createPickups(M, parent, effects) {
  const root = add(parent, node({}));
  const items = [];
  let t = 0;

  function create(kind, x, z) {
    const holder = add(root, node({ x, z }));
    const bob = add(holder, node({ y: 0.9 }));
    let spin = null;
    if (kind === 'heart') {
      add(bob, makeHeart(M));
    } else {
      const m = makeWeaponModel(M, kind);
      m.root.scale.x = m.root.scale.y = m.root.scale.z = 1.35;
      if (kind === 'shuriken') m.root.rot.x = -0.95;   // 寝かせると見えないので斜めに
      add(bob, m.root);
      spin = m.spin;
    }
    add(holder, makeGlow(M, GLOW_COLOR[kind] || [1, 1, 1]));
    const it = { kind, x, z, holder, bob, spin, phase: Math.random() * 6.28, alive: true };
    items.push(it);
    effects.ring(x, 0.06, z, GLOW_COLOR[kind] || [1, 1, 1], 0.3, 2.2, 0.5);
    return it;
  }

  /** 空いている場所を探して置く */
  function spawnRandom(kindPicker, world, player) {
    if (items.length >= PICKUPS.maxOnField) return null;
    for (let tries = 0; tries < 60; tries++) {
      const a = Math.random() * Math.PI * 2;
      const d = 5 + Math.random() * (ARENA.half - 8);
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (world.obstacles.some(o => Math.hypot(o.x - x, o.z - z) < o.r + 1.6)) continue;
      if (items.some(i => Math.hypot(i.x - x, i.z - z) < 4)) continue;
      if (player && Math.hypot(player.x - x, player.z - z) < 5) continue;
      return create(kindPicker(), x, z);
    }
    return null;
  }

  function remove(it) {
    it.alive = false;
    const i = items.indexOf(it);
    if (i >= 0) items.splice(i, 1);
    const j = root.children.indexOf(it.holder);
    if (j >= 0) root.children.splice(j, 1);
  }

  return {
    items, create, spawnRandom,
    /**
     * 拾い手は複数いてよい(アヒルと鬼など)。
     * collectors: [{ who, accept(kind)->bool, onCollect(kind) }]
     */
    update(dt, collectors) {
      t += dt;
      for (let i = items.length - 1; i >= 0; i--) {
        const it = items[i];
        it.bob.pos.y = 0.9 + Math.sin(t * 2.2 + it.phase) * 0.16;
        it.bob.rot.y += dt * 1.4;
        if (it.spin) it.spin.rot.z += dt * 5;
        for (const c of collectors) {
          const who = c.who;
          if (!who || who.down || who.dead) continue;
          if (c.accept && !c.accept(it.kind)) continue;
          if (Math.hypot(who.x - it.x, who.z - it.z) > PICKUPS.radius + who.radius) continue;
          const col = GLOW_COLOR[it.kind] || [1, 1, 1];
          effects.burst(it.x, 1, it.z, 12, col, { speed: 4.5, size: 0.13, life: 0.5 });
          effects.ring(it.x, 0.06, it.z, col, 0.4, 3, 0.4);
          remove(it);
          c.onCollect(it.kind);
          break;
        }
      }
    },
    clear() {
      for (let i = items.length - 1; i >= 0; i--) remove(items[i]);
    },
    /** ラウンドに応じて、出てくるアイテムの種類を決める */
    picker(round, rng = Math.random) {
      return () => {
        if (rng() < PICKUPS.heartChance) return 'heart';
        if (round >= PICKUPS.machinegunRound && rng() < PICKUPS.machinegunChance) return 'machinegun';
        return rng() < 0.5 ? 'pistol' : 'shuriken';
      };
    },
  };
}
