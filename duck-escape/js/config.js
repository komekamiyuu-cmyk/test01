/* ============================================================
   ゲームバランスの設定
   「強すぎる/弱すぎる」の調整は、基本すべてこのファイルで行う。
   ============================================================ */

export const ARENA = {
  half: 30,        // 遊べる範囲(中心から±30m)
  wallH: 3.2,
};

export const PLAYER = {
  maxHp: 5,
  speed: 8.4,
  radius: 0.62,
  turnSpeed: 12,
  dashSpeed: 19,
  dashTime: 0.2,
  dashCooldown: 1.15,
  invuln: 1.15,      // 被弾後の無敵時間(秒)
  eyeHeight: 1.0,
};

/* 武器。落ちているものを拾うと使えるようになる */
export const WEAPONS = {
  shuriken: {
    id: 'shuriken', name: '手裏剣', icon: '✴️', kind: 'shuriken',
    pickupAmmo: 8, maxAmmo: 30, cooldown: 0.4, damage: 11,
    speed: 27, count: 3, spread: 0.17, pierce: 2, life: 1.5, radius: 0.42,
    color: [0.72, 0.78, 0.9],
  },
  pistol: {
    id: 'pistol', name: 'ピストル', icon: '🔫', kind: 'bullet',
    pickupAmmo: 14, maxAmmo: 48, cooldown: 0.24, damage: 17,
    speed: 46, count: 1, spread: 0.015, pierce: 0, life: 1.2, radius: 0.3,
    color: [1, 0.86, 0.42],
  },
  machinegun: {
    id: 'machinegun', name: 'マシンガン', icon: '💥', kind: 'bullet',
    pickupAmmo: 45, maxAmmo: 120, cooldown: 0.085, damage: 9,
    speed: 54, count: 1, spread: 0.075, pierce: 0, life: 1.1, radius: 0.28,
    color: [1, 0.7, 0.35],
  },
};

/** 最初から持っている武器(いきなり無防備だとつらいので少しだけ) */
export const START_WEAPON = { id: 'shuriken', ammo: 5 };

/* 鬼2体。赤は金棒で殴りにくる、青は鬼火を投げてくる */
export const ONI = {
  red: {
    id: 'red', name: '赤鬼', hp: 180, speed: 5.5, radius: 1.05,
    color: [0.86, 0.24, 0.2], skin2: [0.62, 0.13, 0.12],
    style: 'melee',
    attackRange: 3.1, attackWindup: 0.5, attackDamage: 1, attackCooldown: 1.25,
    knockback: 3.2,
  },
  blue: {
    id: 'blue', name: '青鬼', hp: 145, speed: 4.5, radius: 1.0,
    color: [0.27, 0.44, 0.9], skin2: [0.17, 0.28, 0.66],
    style: 'ranged',
    keepDistance: 11, attackRange: 22, attackWindup: 0.62, attackDamage: 1, attackCooldown: 2.0,
    projectileSpeed: 15, knockback: 2.2,
  },
};

/** ラウンドが進むほど鬼が強くなる */
export const ROUNDS = 3;
export const roundScale = (round) => ({
  hp: 1 + 0.4 * (round - 1),
  speed: 1 + 0.09 * (round - 1),
  rate: 1 - 0.12 * (round - 1),   // 攻撃間隔の倍率(小さいほど速い)
});

/** むずかしさ(タイトルで選ぶ) */
export const DIFFICULTY = {
  easy:   { label: 'やさしい', oniHp: 0.8, oniSpeed: 0.88, oniRate: 1.25, itemRate: 0.78, scoreMul: 0.8 },
  normal: { label: 'ふつう',   oniHp: 1.0, oniSpeed: 1.0,  oniRate: 1.0,  itemRate: 1.0,  scoreMul: 1.0 },
  hard:   { label: 'おに',     oniHp: 1.3, oniSpeed: 1.12, oniRate: 0.8,  itemRate: 1.35, scoreMul: 1.6 },
};

/* 落ちているアイテム */
export const PICKUPS = {
  spawnInterval: 6.5,   // 何秒ごとに1個わいてくるか
  maxOnField: 6,
  startCount: 4,
  heartChance: 0.22,    // ハート(回復)が出る確率
  machinegunRound: 2,   // マシンガンが出はじめるラウンド
  machinegunChance: 0.22,
  radius: 1.15,         // これだけ近づくと拾える
};

export const SCORE = {
  perDamage: 2,
  oniDefeated: 600,
  roundClear: 400,
  hpLeft: 300,
  escape: 1500,
  timeBonusMax: 2400,
  timeBonusPerSec: 12,
};

export const CAMERA = {
  distance: 9.2,
  height: 4.4,
  pitch: -0.28,
  minPitch: -0.95,
  maxPitch: 0.35,
  mouseSens: 0.0026,
  touchSens: 0.006,
  shakeDecay: 4.5,
};

/** 見た目の色(夜の里のイメージ) */
export const PALETTE = {
  ground:     [0.16, 0.28, 0.19],
  groundDark: [0.10, 0.19, 0.14],
  path:       [0.34, 0.30, 0.22],
  wall:       [0.30, 0.24, 0.20],
  wood:       [0.42, 0.28, 0.18],
  rock:       [0.34, 0.36, 0.42],
  leaf:       [0.14, 0.35, 0.24],
  duck:       [1.0, 0.98, 0.93],
  beak:       [1.0, 0.68, 0.16],
  lantern:    [1.0, 0.72, 0.35],
  torii:      [0.82, 0.20, 0.18],
};
