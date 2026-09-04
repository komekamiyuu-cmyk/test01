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
    id: 'red', name: '赤鬼', hp: 180, speed: 4.6, radius: 1.05,
    color: [0.86, 0.24, 0.2], skin2: [0.62, 0.13, 0.12],
    style: 'melee',
    attackRange: 3.1, attackWindup: 0.5, attackDamage: 1, attackCooldown: 1.25,
    knockback: 3.2,
  },
  blue: {
    id: 'blue', name: '青鬼', hp: 145, speed: 3.8, radius: 1.0,
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
  speed: 1 + 0.06 * (round - 1),
  rate: 1 - 0.12 * (round - 1),   // 攻撃間隔の倍率(小さいほど速い)
});

/** むずかしさ(タイトルで選ぶ) */
export const DIFFICULTY = {
  // duckAim/duckRate は鬼モードで「逃げるアヒルのねらいの正確さと撃つ間隔」
  easy:   { label: 'やさしい', oniHp: 0.7, oniSpeed: 0.82, oniRate: 1.35, itemRate: 0.75, scoreMul: 0.8, duckAim: 1.5, duckRate: 1.3 },
  normal: { label: 'ふつう',   oniHp: 1.0, oniSpeed: 1.0,  oniRate: 1.0,  itemRate: 1.0,  scoreMul: 1.0, duckAim: 1.0, duckRate: 1.0 },
  hard:   { label: 'おに',     oniHp: 1.3, oniSpeed: 1.15, oniRate: 0.8,  itemRate: 1.35, scoreMul: 1.6, duckAim: 0.6, duckRate: 0.75 },
};

/**
 * そうさ方法。
 * auto は「動かすだけ」で遊べる子ども向け。ねらう・撃つ・カメラはぜんぶおまかせ。
 */
export const CONTROLS = {
  auto:   { label: 'おまかせ', autoAim: true,  autoFire: true,  cameraAssist: true,  infiniteAmmo: true },
  manual: { label: 'じぶんで', autoAim: false, autoFire: false, cameraAssist: false, infiniteAmmo: false },
};

/** どちらを操作するか */
export const SIDES = {
  duck: { label: 'アヒル', icon: '🦆' },
  oni:  { label: '鬼',     icon: '👹' },
};

/* ============================================================
   鬼モード(あなたが鬼になってアヒルを追いかける)
   ============================================================ */

/** あなたが操作する赤鬼 */
export const ONI_PLAYER = {
  maxHp: 5,
  speed: 8.2,          // 逃げるアヒルより速い(追いつけるように)
  radius: 1.0,
  turnSpeed: 9,
  dashSpeed: 16,
  dashTime: 0.32,
  dashCooldown: 1.2,
  invuln: 1.5,
  attackRange: 4.6,        // 金棒はリーチが長い(子どもでも当てやすく)
  attackWindup: 0.1,
  attackHit: 0.1,
  attackTotal: 0.38,
  attackCooldown: 0.42,
  attackDamage: 1,
  attackAngle: 1.5,
  autoSwingMargin: 1.2,    // おまかせ操作は少し早めに振りはじめる
};

/** 逃げるアヒル(AI) */
export const DUCK_AI = {
  maxHp: 5,
  speed: 6.2,             // 鬼(8.2)より遅い。ジグザグとダッシュでかわす
  radius: 0.62,
  invuln: 0.9,
  panicDistance: 13,      // これより鬼が近いと全力で逃げる
  itemSeek: 18,           // これ以内に落ちているアイテムは取りに行く
  shootRange: 17,
  shootCooldown: 2.0,
  aimError: 0.25,         // AIはすこし雑にねらう(当たりすぎないように)
  firstShotDelay: 2.6,
  dashCooldown: 4.0,
};

export const ONI_MODE = {
  rounds: 3,
  timeLimit: 75,          // 1ラウンドの制限時間(秒)
  duckSpeedPerRound: 0.07,
  duckHpPerRound: 0,
  helperFromRound: 1,     // 青鬼(なかま)が手伝ってくれるラウンド
  catchScore: 1200,
  timeLeftScore: 25,
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
