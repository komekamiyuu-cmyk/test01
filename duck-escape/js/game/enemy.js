/* ============================================================
   鬼(敵)のAI
   赤鬼: まっすぐ追いかけて金棒でなぐる
   青鬼: 距離をとりながら鬼火を投げてくる
   どちらも「振りかぶり(windup)」で予告してから攻撃する。
   ============================================================ */

import { add, remove as removeNode } from '../engine/scene.js';
import { createOni } from '../models/oni.js';
import { ARENA } from '../config.js';
import { turnToward, clamp } from '../engine/math.js';

export function createOniEntity(M, parent, def, mul, audio, effects) {
  const model = createOni(M, def);
  add(parent, model.root);
  add(parent, model.shadow);

  const e = {
    def, model,
    x: 0, z: 0, facing: 0,
    maxHp: Math.round(def.hp * mul.hp),
    hp: Math.round(def.hp * mul.hp),
    speed: def.speed * mul.speed,
    rate: mul.rate,
    dead: false, deadTime: 0,
    phase: 'walk', timer: 0, cooldown: 1.2 + Math.random(),
    flash: 0, knockX: 0, knockZ: 0,
    strafe: Math.random() < 0.5 ? 1 : -1,
    strafeTimer: 2,
    hitDone: false,
  };

  e.place = function (x, z) { e.x = x; e.z = z; e.facing = Math.atan2(-x, -z); };

  e.takeDamage = function (dmg, dirX, dirZ, world) {
    if (e.dead) return 0;
    const before = e.hp;
    e.hp = Math.max(0, e.hp - dmg);
    e.flash = 1;
    e.knockX += dirX * def.knockback;
    e.knockZ += dirZ * def.knockback;
    effects.burst(e.x, 2.1, e.z, 8, [1, 0.75, 0.35], { speed: 5, size: 0.13, life: 0.4, dir: { x: dirX, z: dirZ } });
    audio.play('hitOni');
    if (e.hp <= 0) {
      e.dead = true;
      e.deadTime = 0;
      e.phase = 'down';
      effects.burst(e.x, 1.8, e.z, 26, def.color, { speed: 8, size: 0.2, life: 0.9 });
      effects.ring(e.x, 0.07, e.z, def.color, 0.8, 6, 0.7);
      audio.play('oniDown');
    }
    return before - e.hp;
  };

  /** 障害物と場外から押し戻す */
  function resolve(world) {
    for (const o of world.obstacles) {
      const dx = e.x - o.x, dz = e.z - o.z;
      const d = Math.hypot(dx, dz);
      const min = o.r + def.radius * 0.85;
      if (d < min && d > 0.0001) {
        e.x = o.x + (dx / d) * min;
        e.z = o.z + (dz / d) * min;
      }
    }
    const lim = ARENA.half - 1.6;
    e.x = clamp(e.x, -lim, lim);
    e.z = clamp(e.z, -lim, lim);
  }

  e.update = function (dt, world) {
    const pl = world.player;
    e.flash = Math.max(0, e.flash - dt * 3.5);

    if (e.dead) {
      e.deadTime += dt;
      model.root.pos.x = e.x; model.root.pos.z = e.z;
      model.shadow.pos.x = e.x; model.shadow.pos.z = e.z;
      model.shadow.opacity = Math.max(0, 0.4 - e.deadTime * 0.25);
      model.root.pos.y = -Math.min(3.5, e.deadTime * 1.1);
      model.update(dt, { speed: 0, phase: 'down', t: 0, flash: e.flash, hpRatio: 0, camYaw: world.camYaw });
      if (e.deadTime > 3.2) { model.root.visible = false; model.shadow.visible = false; }
      return;
    }

    const dx = pl.x - e.x, dz = pl.z - e.z;
    const dist = Math.hypot(dx, dz) || 0.0001;
    const dirX = dx / dist, dirZ = dz / dist;
    const toPlayer = Math.atan2(dirX, dirZ);

    let moveX = 0, moveZ = 0;
    let moving = 0;
    e.cooldown = Math.max(0, e.cooldown - dt);
    e.strafeTimer -= dt;
    if (e.strafeTimer <= 0) { e.strafe *= -1; e.strafeTimer = 1.8 + Math.random() * 2.2; }

    if (e.phase === 'walk') {
      if (pl.down) {
        moving = 0;                                   // アヒルが倒れたら追うのをやめる
      } else if (def.style === 'melee') {
        if (dist > def.attackRange * 0.8) { moveX = dirX; moveZ = dirZ; moving = 1; }
        if (dist < def.attackRange && e.cooldown <= 0) {
          e.phase = 'windup'; e.timer = 0; e.hitDone = false;
          audio.play('oniRoar');
        }
      } else {
        const keep = def.keepDistance;
        if (dist > keep + 2) { moveX = dirX; moveZ = dirZ; moving = 1; }
        else if (dist < keep - 3) { moveX = -dirX; moveZ = -dirZ; moving = 1; }
        else {
          moveX = -dirZ * e.strafe; moveZ = dirX * e.strafe; moving = 0.75;
        }
        if (dist < def.attackRange && e.cooldown <= 0) {
          e.phase = 'windup'; e.timer = 0; e.hitDone = false;
          audio.play('oniRoar');
        }
      }
    } else if (e.phase === 'windup') {
      e.timer += dt;
      const need = def.attackWindup * e.rate;
      if (def.style === 'ranged') { moveX = -dirZ * e.strafe * 0.35; moveZ = dirX * e.strafe * 0.35; moving = 0.35; }
      if (e.timer >= need) {
        e.phase = 'attack'; e.timer = 0;
        if (def.style === 'melee') audio.play('oniSwing');
        else {
          audio.play('oniFire');
          // 少し先読みして鬼火を投げる
          const lead = dist / def.projectileSpeed;
          const px = pl.x + (pl.lastVx || 0) * lead * 0.5;
          const pz = pl.z + (pl.lastVz || 0) * lead * 0.5;
          const base = Math.atan2(px - e.x, pz - e.z);
          const shots = world.round >= 3 ? 3 : 1;
          for (let i = 0; i < shots; i++) {
            const a = base + (i - (shots - 1) / 2) * 0.16;
            world.projectiles.spawn({
              kind: 'onifire', from: 'oni',
              x: e.x + Math.sin(a) * 1.2, y: 2.0, z: e.z + Math.cos(a) * 1.2,
              dx: Math.sin(a), dz: Math.cos(a),
              speed: def.projectileSpeed, damage: def.attackDamage,
              life: 3.2, radius: 0.55,
            });
          }
          effects.burst(e.x + dirX * 1.2, 2.0, e.z + dirZ * 1.2, 8, [0.5, 0.8, 1], { speed: 4, size: 0.13, life: 0.4 });
        }
      }
    } else if (e.phase === 'attack') {
      e.timer += dt;
      if (def.style === 'melee') {
        if (!e.hitDone && e.timer > 0.14) {
          e.hitDone = true;
          const ang = Math.abs(((toPlayer - e.facing + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
          if (dist < def.attackRange + 0.9 && ang < 1.1) {
            pl.takeDamage(def.attackDamage, e.x, e.z, world);
            world.onPlayerHurt && world.onPlayerHurt();
          }
          effects.burst(e.x + dirX * 2.2, 1.2, e.z + dirZ * 2.2, 12, [1, 0.6, 0.3], { speed: 6, size: 0.16, life: 0.4 });
          effects.ring(e.x + dirX * 2.2, 0.07, e.z + dirZ * 2.2, [1, 0.6, 0.3], 0.6, 3.2, 0.35);
        }
        if (e.timer > 0.45) { e.phase = 'walk'; e.cooldown = def.attackCooldown * e.rate; }
      } else {
        if (e.timer > 0.4) { e.phase = 'walk'; e.cooldown = def.attackCooldown * e.rate; }
      }
    }

    // 移動(ノックバックも足す)
    const sp = e.speed * (e.phase === 'walk' ? 1 : 0.25);
    e.x += moveX * sp * dt + e.knockX * dt;
    e.z += moveZ * sp * dt + e.knockZ * dt;
    e.knockX *= Math.max(0, 1 - dt * 6);
    e.knockZ *= Math.max(0, 1 - dt * 6);

    // 仲間どうしが重ならないように
    for (const other of world.onis) {
      if (other === e || other.dead) continue;
      const ox = e.x - other.x, oz = e.z - other.z;
      const d = Math.hypot(ox, oz);
      const min = def.radius + other.def.radius;
      if (d < min && d > 0.0001) {
        e.x = other.x + (ox / d) * min;
        e.z = other.z + (oz / d) * min;
      }
    }
    resolve(world);

    if (!pl.down || e.phase !== 'walk') e.facing = turnToward(e.facing, toPlayer, dt * 4.5);

    model.root.pos.x = e.x;
    model.root.pos.z = e.z;
    model.root.rot.y = e.facing;
    model.shadow.pos.x = e.x;
    model.shadow.pos.z = e.z;

    const need = e.phase === 'windup' ? def.attackWindup * e.rate : 0.45;
    model.update(dt, {
      speed: moving * sp,
      phase: e.phase,
      t: clamp(e.timer / (need || 1), 0, 1),
      flash: e.flash,
      hpRatio: e.hp / e.maxHp,
      camYaw: world.camYaw,
    });
  };

  e.dispose = function () {
    removeNode(parent, model.root);
    removeNode(parent, model.shadow);
  };

  return e;
}
