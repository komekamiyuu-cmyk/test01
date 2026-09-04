/* ============================================================
   飛び道具(アヒルの弾・手裏剣 / 鬼の鬼火)
   当たり判定は「上から見た円どうし」で判定する軽い方式。
   ============================================================ */

import { node, add } from '../engine/scene.js';
import { makeShuriken } from '../models/items.js';
import { ARENA } from '../config.js';

export function createProjectiles(M, parent, effects) {
  const root = add(parent, node({}));
  const live = [];
  const pool = { bullet: [], shuriken: [], onifire: [] };

  function makeView(kind) {
    const p = pool[kind];
    if (p.length) return p.pop();
    if (kind === 'shuriken') {
      const s = makeShuriken(M, 1.1);
      add(root, s.root);
      return { root: s.root, spin: s.spin };
    }
    if (kind === 'onifire') {
      const r = add(root, node({}));
      add(r, node({ mesh: M.sphere, color: [0.65, 0.9, 1], scale: 0.3, emissive: 1 }));
      add(r, node({ mesh: M.sphere, color: [0.3, 0.55, 1], scale: 0.52, emissive: 1, transparent: true, opacity: 0.4, depthWrite: false }));
      return { root: r, spin: null };
    }
    const r = add(root, node({}));
    add(r, node({ mesh: M.sphere, color: [1, 0.9, 0.4], sx: 0.09, sy: 0.09, sz: 0.28, emissive: 1 }));
    add(r, node({ mesh: M.sphere, color: [1, 0.6, 0.2], scale: 0.2, emissive: 1, transparent: true, opacity: 0.4, depthWrite: false }));
    return { root: r, spin: null };
  }

  function spawn(o) {
    const view = makeView(o.kind);
    view.root.visible = true;
    view.root.pos.x = o.x; view.root.pos.y = o.y; view.root.pos.z = o.z;
    view.root.rot.y = Math.atan2(o.dx, o.dz);
    live.push({
      view, kind: o.kind, from: o.from,
      x: o.x, y: o.y, z: o.z,
      vx: o.dx * o.speed, vz: o.dz * o.speed,
      damage: o.damage, life: o.life, radius: o.radius || 0.3,
      pierce: o.pierce || 0, hitSet: new Set(), knockback: o.knockback || 1,
    });
  }

  function kill(p, i) {
    p.view.root.visible = false;
    pool[p.kind].push(p.view);
    live.splice(i, 1);
  }

  function update(dt, world) {
    const half = ARENA.half;
    for (let i = live.length - 1; i >= 0; i--) {
      const p = live[i];
      p.life -= dt;
      p.x += p.vx * dt;
      p.z += p.vz * dt;

      const v = p.view.root;
      v.pos.x = p.x; v.pos.z = p.z;
      if (p.kind === 'shuriken') { v.rot.z += dt * 26; if (p.view.spin) p.view.spin.rot.z += dt * 26; }
      if (p.kind === 'onifire') {
        const s = 1 + Math.sin(p.life * 22) * 0.12;
        v.scale.x = v.scale.y = v.scale.z = s;
        if (Math.random() < 0.5) effects.burst(p.x, p.y, p.z, 1, [0.5, 0.75, 1], { speed: 1.2, size: 0.1, life: 0.3, grav: 2, up: 0.3 });
      }

      if (p.life <= 0 || Math.abs(p.x) > half || Math.abs(p.z) > half) { kill(p, i); continue; }

      // 障害物に当たったら消える
      let blocked = false;
      for (const o of world.obstacles) {
        if (Math.hypot(o.x - p.x, o.z - p.z) < o.r + p.radius * 0.6) { blocked = true; break; }
      }
      if (blocked) {
        effects.burst(p.x, p.y, p.z, 5, p.kind === 'onifire' ? [0.5, 0.75, 1] : [1, 0.85, 0.5], { speed: 3.5, size: 0.1, life: 0.3 });
        kill(p, i);
        continue;
      }

      if (p.from === 'player') {
        let done = false;
        for (const oni of world.onis) {
          if (oni.dead || p.hitSet.has(oni)) continue;
          if (Math.hypot(oni.x - p.x, oni.z - p.z) < oni.def.radius + p.radius) {
            world.onHitOni(oni, p);
            p.hitSet.add(oni);
            if (p.pierce > 0) p.pierce--;
            else { kill(p, i); done = true; }
            break;
          }
        }
        if (done) continue;
      } else {
        const pl = world.player;
        if (!pl.down && Math.hypot(pl.x - p.x, pl.z - p.z) < pl.radius + p.radius) {
          world.onHitPlayer(p);
          kill(p, i);
          continue;
        }
      }
    }
  }

  function clear() {
    for (let i = live.length - 1; i >= 0; i--) kill(live[i], i);
  }

  return { spawn, update, clear, live };
}
