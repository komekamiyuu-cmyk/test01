/* ============================================================
   逃げるアヒル(AI) — 鬼モードのときの「追われる側」
   ・鬼から離れる方向へ逃げる
   ・落ちている武器やハートを拾いに行く
   ・ときどき立ち止まって撃ち返してくる
   プレイヤーのアヒル(player.js)と同じ見た目を使う。
   ============================================================ */

import { add, remove as removeNode } from '../engine/scene.js';
import { createDuck } from '../models/duck.js';
import { DUCK_AI, WEAPONS, START_WEAPON, ARENA } from '../config.js';
import { turnToward, clamp } from '../engine/math.js';

export function createDuckAi(M, parent, audio, effects, mul = {}) {
  const model = createDuck(M);
  add(parent, model.root);
  add(parent, model.shadow);

  const d = {
    def: { id: 'duck', name: 'アヒル', color: [1, 0.86, 0.4], radius: DUCK_AI.radius },
    model,
    x: 0, z: 0, facing: 0,
    radius: DUCK_AI.radius,
    maxHp: DUCK_AI.maxHp,
    hp: DUCK_AI.maxHp,
    speed: DUCK_AI.speed * (mul.speed || 1),
    dead: false, down: false, deadTime: 0,
    invuln: 0, hurtFlash: 0,
    dash: 0, dashCd: 0, dashDir: { x: 0, z: 1 },
    shootCd: DUCK_AI.firstShotDelay,
    aimError: DUCK_AI.aimError * (mul.aim || 1),
    shootWait: DUCK_AI.shootCooldown * (mul.rate || 1),
    moveSpeed: 0,
    ammo: { shuriken: START_WEAPON.ammo, pistol: 0, machinegun: 0 },
    current: START_WEAPON.id,
    lastVx: 0, lastVz: 0,
  };
  model.setWeapon(d.current);

  d.place = function (x, z) { d.x = x; d.z = z; d.facing = Math.atan2(-x, -z); };

  /** アイテムを拾ったとき(鬼モードでもアヒルは武器を拾う) */
  d.give = function (kind) {
    if (kind === 'heart') {
      d.hp = Math.min(d.maxHp, d.hp + 1);
      audio.play('heal');
      return;
    }
    const w = WEAPONS[kind];
    if (!w) return;
    d.ammo[kind] = Math.min(w.maxAmmo, d.ammo[kind] + w.pickupAmmo);
    d.current = kind;
    model.setWeapon(kind);
    audio.play('pickup');
  };

  /** fromX/fromZ は「攻撃してきた側の位置」 */
  d.takeDamage = function (n, fromX, fromZ) {
    if (d.dead || d.invuln > 0) return 0;
    d.hp = Math.max(0, d.hp - n);
    d.invuln = DUCK_AI.invuln;
    d.hurtFlash = 1;
    const dx = d.x - fromX, dz = d.z - fromZ;
    const l = Math.hypot(dx, dz) || 1;
    d.knockX = (dx / l) * 7;
    d.knockZ = (dz / l) * 7;
    effects.burst(d.x, 1.0, d.z, 12, [1, 0.9, 0.6], { speed: 5, size: 0.14, life: 0.5 });
    audio.play('quack');
    if (d.hp <= 0) {
      d.dead = true;
      d.down = true;
      d.deadTime = 0;
      effects.burst(d.x, 1.0, d.z, 24, [1, 0.95, 0.8], { speed: 7, size: 0.18, life: 0.9 });
      effects.ring(d.x, 0.07, d.z, [1, 0.9, 0.5], 0.6, 5, 0.7);
      audio.play('oniDown');
    }
    return n;
  };

  /** 撃ち返す */
  function shoot(world, tx, tz) {
    const w = WEAPONS[d.current];
    // 弾がなければ撃たない(拾うまでひたすら逃げる)
    if (!w || d.ammo[d.current] <= 0) {
      for (const id of ['pistol', 'machinegun', 'shuriken']) {
        if (d.ammo[id] > 0) { d.current = id; model.setWeapon(id); return true; }
      }
      return false;
    }
    d.ammo[d.current]--;
    const base = Math.atan2(tx - d.x, tz - d.z) + (Math.random() - 0.5) * d.aimError * 2;
    const count = 1;               // AIは1発ずつ(強すぎないように)
    for (let i = 0; i < count; i++) {
      const a = base + (i - (count - 1) / 2) * w.spread * 2 + (Math.random() - 0.5) * 0.06;
      world.projectiles.spawn({
        kind: w.kind, from: 'enemy',
        x: d.x + Math.sin(a) * 0.9, y: 1.0, z: d.z + Math.cos(a) * 0.9,
        dx: Math.sin(a), dz: Math.cos(a),
        speed: w.speed * 0.8, damage: 1, life: w.life,
        radius: w.radius, pierce: 0,
      });
    }
    model.recoil();
    audio.play(d.current === 'shuriken' ? 'shuriken' : 'pistol');
    return true;
  }

  d.update = function (dt, world) {
    d.invuln = Math.max(0, d.invuln - dt);
    d.hurtFlash = Math.max(0, d.hurtFlash - dt * 3);
    d.dashCd = Math.max(0, d.dashCd - dt);
    d.shootCd = Math.max(0, d.shootCd - dt);

    if (d.dead) {
      d.deadTime += dt;
      model.root.pos.x = d.x; model.root.pos.z = d.z;
      model.root.rot.z = Math.min(1.5, d.deadTime * 4);
      model.shadow.pos.x = d.x; model.shadow.pos.z = d.z;
      model.shadow.opacity = Math.max(0, 0.34 - d.deadTime * 0.2);
      model.update(dt, { speed: 0, dashing: false, invuln: 0, hurtFlash: 0 });
      return;
    }

    // ---- どっちへ逃げるか(まわりから受ける「押される力」を足し合わせる) ----
    let ax = 0, az = 0;
    let nearest = null, nearestD = 1e9;
    for (const o of world.chasers) {
      if (o.dead || o.down) continue;
      const dx = d.x - o.x, dz = d.z - o.z;
      const dist = Math.hypot(dx, dz) || 0.001;
      if (dist < nearestD) { nearestD = dist; nearest = o; }
      const w = clamp(1 - dist / DUCK_AI.panicDistance, 0, 1);
      ax += (dx / dist) * w * 2.6;
      az += (dz / dist) * w * 2.6;
    }

    // 壁ぎわに追いつめられないよう、内側へ戻る力
    const lim = ARENA.half - 1.2;
    const edge = 9;
    if (d.x > lim - edge) ax -= (d.x - (lim - edge)) / edge * 2.2;
    if (d.x < -lim + edge) ax += (-lim + edge - d.x) / edge * 2.2;
    if (d.z > lim - edge) az -= (d.z - (lim - edge)) / edge * 2.2;
    if (d.z < -lim + edge) az += (-lim + edge - d.z) / edge * 2.2;

    // 岩や木をよける
    for (const o of world.obstacles) {
      const dx = d.x - o.x, dz = d.z - o.z;
      const dist = Math.hypot(dx, dz);
      if (dist < o.r + 3.5 && dist > 0.001) {
        const w = (o.r + 3.5 - dist) / 3.5;
        ax += (dx / dist) * w * 1.6;
        az += (dz / dist) * w * 1.6;
      }
    }

    // 危なくないときは、落ちているアイテムを取りに行く
    if (nearestD > DUCK_AI.panicDistance * 0.75 && world.pickupItems) {
      let best = null, bestD = DUCK_AI.itemSeek;
      for (const it of world.pickupItems) {
        const dist = Math.hypot(it.x - d.x, it.z - d.z);
        if (dist < bestD) { bestD = dist; best = it; }
      }
      if (best) {
        const dx = best.x - d.x, dz = best.z - d.z;
        const l = Math.hypot(dx, dz) || 1;
        ax += (dx / l) * 2.0;
        az += (dz / l) * 2.0;
      }
    }

    let len = Math.hypot(ax, az);
    if (len > 0.001) { ax /= len; az /= len; } else { ax = Math.sin(d.facing); az = Math.cos(d.facing); }

    // 鬼がすぐそばに来たらダッシュでかわす
    if (nearest && nearestD < 4.5 && d.dashCd <= 0) {
      d.dash = 0.24;
      d.dashCd = DUCK_AI.dashCooldown;
      d.dashDir = { x: ax, z: az };
      effects.burst(d.x, 0.4, d.z, 8, [0.9, 0.95, 1], { speed: 3.5, size: 0.1, life: 0.3, up: 0.2 });
      audio.play('dash');
    }

    let vx = ax, vz = az;
    let speed = d.speed * (len > 0.15 ? 1 : 0.35);
    if (d.dash > 0) {
      d.dash -= dt;
      vx = d.dashDir.x; vz = d.dashDir.z;
      speed = d.speed * 2.1;
    }

    // 撃ち返すあいだは少しゆっくり
    let aiming = false;
    if (nearest && nearestD < DUCK_AI.shootRange && nearestD > DUCK_AI.minShootDistance && d.shootCd <= 0 && d.dash <= 0) {
      aiming = shoot(world, nearest.x, nearest.z) !== false;
      d.shootCd = d.shootWait;
    }
    if (aiming) speed *= 0.5;

    d.x += vx * speed * dt + (d.knockX || 0) * dt;
    d.z += vz * speed * dt + (d.knockZ || 0) * dt;
    d.knockX = (d.knockX || 0) * Math.max(0, 1 - dt * 7);
    d.knockZ = (d.knockZ || 0) * Math.max(0, 1 - dt * 7);
    d.moveSpeed = speed;
    d.lastVx = vx * speed;
    d.lastVz = vz * speed;

    for (const o of world.obstacles) {
      const dx = d.x - o.x, dz = d.z - o.z;
      const dist = Math.hypot(dx, dz);
      const min = o.r + d.radius;
      if (dist < min && dist > 0.0001) {
        d.x = o.x + (dx / dist) * min;
        d.z = o.z + (dz / dist) * min;
      }
    }
    d.x = clamp(d.x, -lim, lim);
    d.z = clamp(d.z, -lim, lim);

    // 撃つときは鬼の方、ふだんは進む方を向く
    const want = (aiming && nearest) ? Math.atan2(nearest.x - d.x, nearest.z - d.z) : Math.atan2(vx, vz);
    d.facing = turnToward(d.facing, want, dt * 10);

    model.root.pos.x = d.x;
    model.root.pos.z = d.z;
    model.root.rot.y = d.facing;
    model.shadow.pos.x = d.x;
    model.shadow.pos.z = d.z;
    model.update(dt, { speed: d.moveSpeed, dashing: d.dash > 0, invuln: d.invuln, hurtFlash: d.hurtFlash });
  };

  d.dispose = function () {
    removeNode(parent, model.root);
    removeNode(parent, model.shadow);
  };

  return d;
}
