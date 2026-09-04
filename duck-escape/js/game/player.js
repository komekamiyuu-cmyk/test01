/* ============================================================
   プレイヤー(ペットのアヒル)
   移動・ダッシュ・射撃・被弾をまとめて持つ。
   ============================================================ */

import { add } from '../engine/scene.js';
import { createDuck } from '../models/duck.js';
import { PLAYER, WEAPONS, START_WEAPON, ARENA } from '../config.js';
import { turnToward, clamp } from '../engine/math.js';

const ORDER = ['shuriken', 'pistol', 'machinegun'];

export function createPlayer(M, parent, audio, effects) {
  const model = createDuck(M);
  add(parent, model.root);
  add(parent, model.shadow);

  const p = {
    x: 0, z: 0, facing: 0,
    hp: PLAYER.maxHp,
    radius: PLAYER.radius,
    down: false,
    invuln: 0,
    hurtFlash: 0,
    dash: 0, dashCd: 0, dashDir: { x: 0, z: 1 },
    cooldown: 0,
    ammo: { shuriken: 0, pistol: 0, machinegun: 0 },
    current: START_WEAPON.id,
    speed: 0,
    aimYaw: null,          // オートエイム中はこの向きを向く
    infiniteAmmo: false,   // 「おまかせ操作」では弾切れなし
    model,
    stats: { damage: 0, shots: 0 },
  };

  p.reset = function () {
    p.x = 0; p.z = 4; p.facing = Math.PI;
    p.hp = PLAYER.maxHp;
    p.down = false;
    p.invuln = 0; p.hurtFlash = 0;
    p.dash = 0; p.dashCd = 0; p.cooldown = 0;
    p.ammo = { shuriken: 0, pistol: 0, machinegun: 0 };
    p.ammo[START_WEAPON.id] = START_WEAPON.ammo;
    p.current = START_WEAPON.id;
    p.aimYaw = null;
    p.stats = { damage: 0, shots: 0 };
    model.setWeapon(p.current);
    model.root.visible = true;
    model.shadow.visible = true;
  };

  /** アイテムを拾ったとき */
  p.give = function (kind) {
    if (kind === 'heart') {
      p.hp = Math.min(PLAYER.maxHp, p.hp + 1);
      audio.play('heal');
      return;
    }
    const w = WEAPONS[kind];
    if (!w) return;
    p.ammo[kind] = Math.min(w.maxAmmo, p.ammo[kind] + w.pickupAmmo);
    p.current = kind;                 // 拾ったらすぐ使える
    model.setWeapon(kind);
    audio.play('pickup');
  };

  /** 弾のある武器に持ち替える(dir=+1で次、-1で前) */
  p.switchWeapon = function (dir = 1) {
    const start = ORDER.indexOf(p.current);
    for (let i = 1; i <= ORDER.length; i++) {
      const id = ORDER[(start + dir * i + ORDER.length * 2) % ORDER.length];
      if (p.ammo[id] > 0) {
        if (id !== p.current) { p.current = id; model.setWeapon(id); audio.play('pickup'); }
        return;
      }
    }
  };

  p.selectWeapon = function (index) {
    const id = ORDER[index];
    if (id && p.ammo[id] > 0 && id !== p.current) {
      p.current = id;
      model.setWeapon(id);
      audio.play('pickup');
    }
  };

  /** 攻撃。撃てたら true */
  p.fire = function (world) {
    if (p.down || p.cooldown > 0) return false;
    const w = WEAPONS[p.current];
    if (!w) return false;
    if (p.ammo[p.current] <= 0 && !p.infiniteAmmo) {
      p.cooldown = 0.25;
      audio.play('empty');
      p.switchWeapon(1);
      return false;
    }
    if (!p.infiniteAmmo) p.ammo[p.current]--;
    p.cooldown = w.cooldown;
    p.stats.shots++;

    const dirX = Math.sin(p.facing), dirZ = Math.cos(p.facing);
    const mx = p.x + dirX * 0.85, mz = p.z + dirZ * 0.85, my = 1.0;
    for (let i = 0; i < w.count; i++) {
      const off = (i - (w.count - 1) / 2) * w.spread * 2 + (Math.random() - 0.5) * w.spread;
      const a = p.facing + off;
      world.projectiles.spawn({
        kind: w.kind, from: 'player',
        x: mx, y: my, z: mz,
        dx: Math.sin(a), dz: Math.cos(a),
        speed: w.speed, damage: w.damage, life: w.life,
        radius: w.radius, pierce: w.pierce,
      });
    }
    effects.burst(mx, my, mz, w.kind === 'bullet' ? 6 : 3, w.color,
      { speed: 3.2, size: 0.11, life: 0.22, dir: { x: dirX, z: dirZ }, up: 0.2 });
    model.recoil();
    audio.play(p.current === 'machinegun' ? 'machinegun' : (p.current === 'pistol' ? 'pistol' : 'shuriken'));
    return true;
  };

  /** ダメージを受ける。戻り値: 実際に受けたか */
  p.takeDamage = function (n, fromX, fromZ, world) {
    if (p.down || p.invuln > 0) return false;
    p.hp -= n;
    p.invuln = PLAYER.invuln;
    p.hurtFlash = 1;
    const dx = p.x - fromX, dz = p.z - fromZ;
    const d = Math.hypot(dx, dz) || 1;
    p.knockX = (dx / d) * 6;
    p.knockZ = (dz / d) * 6;
    effects.burst(p.x, 1.0, p.z, 12, [1, 0.35, 0.4], { speed: 5, size: 0.14, life: 0.5 });
    audio.play('quack');
    audio.play('hurt');
    if (p.hp <= 0) {
      p.hp = 0;
      p.down = true;
    }
    return true;
  };

  p.update = function (dt, input, camYaw, world) {
    p.cooldown = Math.max(0, p.cooldown - dt);
    p.invuln = Math.max(0, p.invuln - dt);
    p.hurtFlash = Math.max(0, p.hurtFlash - dt * 3);
    p.dashCd = Math.max(0, p.dashCd - dt);

    let vx = 0, vz = 0;
    if (!p.down) {
      // カメラの向きを基準に動く
      const f = { x: Math.sin(camYaw), z: Math.cos(camYaw) };
      const r = { x: Math.cos(camYaw), z: -Math.sin(camYaw) };
      vx = f.x * input.move.y + r.x * input.move.x;
      vz = f.z * input.move.y + r.z * input.move.x;
      const l = Math.hypot(vx, vz);
      if (l > 1) { vx /= l; vz /= l; }
    }

    // ダッシュ(短い無敵つきの回避)
    if (p.dash > 0) {
      p.dash -= dt;
      vx = p.dashDir.x; vz = p.dashDir.z;
    }
    const moveLen = Math.hypot(vx, vz);
    const speed = p.dash > 0 ? PLAYER.dashSpeed : PLAYER.speed;
    p.speed = moveLen * speed;

    let nx = p.x + vx * speed * dt;
    let nz = p.z + vz * speed * dt;

    // ノックバック
    if (p.knockX || p.knockZ) {
      nx += p.knockX * dt; nz += p.knockZ * dt;
      p.knockX *= Math.max(0, 1 - dt * 7);
      p.knockZ *= Math.max(0, 1 - dt * 7);
      if (Math.abs(p.knockX) < 0.05) p.knockX = 0;
      if (Math.abs(p.knockZ) < 0.05) p.knockZ = 0;
    }

    // 障害物を押しのけない(すり抜けない)ように位置を補正
    for (const o of world.obstacles) {
      const dx = nx - o.x, dz = nz - o.z;
      const d = Math.hypot(dx, dz);
      const min = o.r + p.radius;
      if (d < min && d > 0.0001) {
        nx = o.x + (dx / d) * min;
        nz = o.z + (dz / d) * min;
      }
    }
    const lim = ARENA.half - 1.2;
    p.x = clamp(nx, -lim, lim);
    p.z = clamp(nz, -lim, lim);

    // 向き: オートエイム中は敵の方、撃っているときはカメラの向き、ふだんは進行方向
    let want = p.facing;
    if (p.aimYaw != null && !p.down) want = p.aimYaw;
    else if (input.fire && !p.down) want = camYaw;
    else if (moveLen > 0.05) want = Math.atan2(vx, vz);
    p.facing = turnToward(p.facing, want, dt * PLAYER.turnSpeed);

    model.root.pos.x = p.x;
    model.root.pos.z = p.z;
    model.root.rot.y = p.facing;
    model.shadow.pos.x = p.x;
    model.shadow.pos.z = p.z;

    if (p.down) {
      model.root.rot.z = Math.min(1.5, (model.root.rot.z || 0) + dt * 4);
      model.root.pos.y = 0;
    } else {
      model.root.rot.z = 0;
    }
    model.update(dt, {
      speed: p.speed,
      dashing: p.dash > 0,
      invuln: p.invuln,
      hurtFlash: p.hurtFlash,
    });
  };

  /** ダッシュ開始(押した瞬間に呼ぶ) */
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
    p.dash = PLAYER.dashTime;
    p.dashCd = PLAYER.dashCooldown;
    p.invuln = Math.max(p.invuln, PLAYER.dashTime + 0.12);   // 回避できる
    effects.burst(p.x, 0.4, p.z, 10, [0.8, 0.9, 1], { speed: 3.5, size: 0.1, life: 0.35, up: 0.2 });
    audio.play('dash');
    return true;
  };

  p.reset();
  return p;
}
