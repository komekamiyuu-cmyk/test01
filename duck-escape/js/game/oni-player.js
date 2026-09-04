/* ============================================================
   あなたが操作する鬼(鬼モード)
   金棒でなぐってアヒルをつかまえる。移動と攻撃だけのシンプル操作。
   ============================================================ */

import { add, remove as removeNode } from '../engine/scene.js';
import { createOni } from '../models/oni.js';
import { ONI, ONI_PLAYER, ARENA } from '../config.js';
import { turnToward, clamp } from '../engine/math.js';

export function createOniPlayer(M, parent, audio, effects) {
  const def = ONI.red;
  const model = createOni(M, def);
  model.bar.root.visible = false;      // 体力はHUDのハートで見せる
  add(parent, model.root);
  add(parent, model.shadow);

  const p = {
    def, model,
    x: 0, z: 0, facing: 0,
    radius: ONI_PLAYER.radius,
    hp: ONI_PLAYER.maxHp,
    maxHp: ONI_PLAYER.maxHp,
    down: false, dead: false,
    invuln: 0, flash: 0,
    dash: 0, dashCd: 0, dashDir: { x: 0, z: 1 },
    attack: 0, attackCd: 0, hitDone: false,
    speed: 0,
    aimYaw: null,
    stats: { hits: 0, caught: 0 },
    lastVx: 0, lastVz: 0,
  };

  p.reset = function () {
    p.x = 0; p.z = 6; p.facing = Math.PI;
    p.hp = ONI_PLAYER.maxHp;
    p.down = false; p.dead = false;
    p.invuln = 0; p.flash = 0;
    p.dash = 0; p.dashCd = 0;
    p.attack = 0; p.attackCd = 0;
    p.aimYaw = null;
    p.stats = { hits: 0, caught: 0 };
    model.root.visible = true;
    model.shadow.visible = true;
    model.root.rot.z = 0;
  };

  /** アヒルが落としたハートは鬼も拾える */
  p.give = function (kind) {
    if (kind === 'heart') {
      p.hp = Math.min(ONI_PLAYER.maxHp, p.hp + 1);
      audio.play('heal');
    }
  };

  p.takeDamage = function (n, fromX, fromZ) {
    if (p.down || p.invuln > 0) return false;
    p.hp -= n;
    p.invuln = ONI_PLAYER.invuln;
    p.flash = 1;
    const dx = p.x - fromX, dz = p.z - fromZ;
    const l = Math.hypot(dx, dz) || 1;
    p.knockX = (dx / l) * 4;
    p.knockZ = (dz / l) * 4;
    effects.burst(p.x, 2.2, p.z, 12, [1, 0.6, 0.4], { speed: 5, size: 0.16, life: 0.5 });
    audio.play('hitOni');
    if (p.hp <= 0) { p.hp = 0; p.down = true; audio.play('oniDown'); }
    return true;
  };

  /** 金棒をふる。当たり判定は少し遅れて出る */
  p.swing = function () {
    if (p.down || p.attack > 0 || p.attackCd > 0) return false;
    p.attack = ONI_PLAYER.attackTotal;
    p.hitDone = false;
    p.attackCd = ONI_PLAYER.attackCooldown;
    audio.play('oniSwing');
    return true;
  };

  p.tryDash = function (input, camYaw) {
    if (p.down || p.dashCd > 0 || p.dash > 0) return false;
    let vx = Math.sin(p.facing), vz = Math.cos(p.facing);
    if (Math.hypot(input.move.x, input.move.y) > 0.1) {
      const f = { x: Math.sin(camYaw), z: Math.cos(camYaw) };
      const r = { x: Math.cos(camYaw), z: -Math.sin(camYaw) };
      vx = f.x * input.move.y + r.x * input.move.x;
      vz = f.z * input.move.y + r.z * input.move.x;
      const l = Math.hypot(vx, vz) || 1;
      vx /= l; vz /= l;
    }
    p.dashDir = { x: vx, z: vz };
    p.dash = ONI_PLAYER.dashTime;
    p.dashCd = ONI_PLAYER.dashCooldown;
    effects.burst(p.x, 0.5, p.z, 12, [1, 0.7, 0.5], { speed: 4.5, size: 0.14, life: 0.4, up: 0.2 });
    audio.play('dash');
    return true;
  };

  p.update = function (dt, input, camYaw, world) {
    p.invuln = Math.max(0, p.invuln - dt);
    p.flash = Math.max(0, p.flash - dt * 3);
    p.dashCd = Math.max(0, p.dashCd - dt);
    p.attackCd = Math.max(0, p.attackCd - dt);

    let vx = 0, vz = 0;
    if (!p.down) {
      const f = { x: Math.sin(camYaw), z: Math.cos(camYaw) };
      const r = { x: Math.cos(camYaw), z: -Math.sin(camYaw) };
      vx = f.x * input.move.y + r.x * input.move.x;
      vz = f.z * input.move.y + r.z * input.move.x;
      const l = Math.hypot(vx, vz);
      if (l > 1) { vx /= l; vz /= l; }
    }

    if (p.dash > 0) { p.dash -= dt; vx = p.dashDir.x; vz = p.dashDir.z; }
    const moveLen = Math.hypot(vx, vz);
    let speed = p.dash > 0 ? ONI_PLAYER.dashSpeed : ONI_PLAYER.speed;
    if (p.attack > 0) speed *= 0.78;                     // 振っている間は少しゆっくり
    p.speed = moveLen * speed;

    let nx = p.x + vx * speed * dt;
    let nz = p.z + vz * speed * dt;
    if (p.knockX || p.knockZ) {
      nx += p.knockX * dt; nz += p.knockZ * dt;
      p.knockX = (p.knockX || 0) * Math.max(0, 1 - dt * 7);
      p.knockZ = (p.knockZ || 0) * Math.max(0, 1 - dt * 7);
    }

    for (const o of world.obstacles) {
      const dx = nx - o.x, dz = nz - o.z;
      const d = Math.hypot(dx, dz);
      const min = o.r + p.radius * 0.9;
      if (d < min && d > 0.0001) {
        nx = o.x + (dx / d) * min;
        nz = o.z + (dz / d) * min;
      }
    }
    const lim = ARENA.half - 1.6;
    p.x = clamp(nx, -lim, lim);
    p.z = clamp(nz, -lim, lim);
    p.lastVx = vx * speed;
    p.lastVz = vz * speed;

    // 向き
    let want = p.facing;
    if (p.aimYaw != null && !p.down) want = p.aimYaw;
    else if (moveLen > 0.05) want = Math.atan2(vx, vz);
    else if (input.fire) want = camYaw;
    p.facing = turnToward(p.facing, want, dt * ONI_PLAYER.turnSpeed);

    // 攻撃の当たり判定
    let phase = 'walk';
    let t = 0;
    if (p.attack > 0) {
      const done = ONI_PLAYER.attackTotal - p.attack;
      p.attack -= dt;
      phase = done < ONI_PLAYER.attackWindup ? 'windup' : 'attack';
      t = phase === 'windup' ? done / ONI_PLAYER.attackWindup : (done - ONI_PLAYER.attackWindup) / 0.3;
      if (!p.hitDone && done >= ONI_PLAYER.attackWindup + ONI_PLAYER.attackHit) {
        p.hitDone = true;
        const hx = p.x + Math.sin(p.facing) * 2.4;
        const hz = p.z + Math.cos(p.facing) * 2.4;
        effects.burst(hx, 1.2, hz, 12, [1, 0.7, 0.35], { speed: 6, size: 0.16, life: 0.4 });
        effects.ring(hx, 0.07, hz, [1, 0.7, 0.35], 0.6, 3.4, 0.35);
        for (const target of world.enemies) {
          if (target.dead || target.down) continue;
          const dx = target.x - p.x, dz = target.z - p.z;
          const dist = Math.hypot(dx, dz);
          const ang = Math.abs(((Math.atan2(dx, dz) - p.facing + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
          if (dist < ONI_PLAYER.attackRange + target.radius && ang < ONI_PLAYER.attackAngle) {
            world.onOniHit(target, ONI_PLAYER.attackDamage, p);
          }
        }
      }
    }
    if (p.down) phase = 'down';

    model.root.pos.x = p.x;
    model.root.pos.z = p.z;
    model.root.rot.y = p.facing;
    model.shadow.pos.x = p.x;
    model.shadow.pos.z = p.z;

    // 無敵中は点滅
    const blink = p.invuln > 0 ? (Math.sin(p.invuln * 40) * 0.5 + 0.5) * 0.6 : 0;
    model.update(dt, {
      speed: p.speed, phase, t: clamp(t, 0, 1),
      flash: Math.max(p.flash, blink),
      hpRatio: p.hp / p.maxHp,
      camYaw: world.camYaw,
    });
  };

  p.dispose = function () {
    removeNode(parent, model.root);
    removeNode(parent, model.shadow);
  };

  p.reset();
  return p;
}
