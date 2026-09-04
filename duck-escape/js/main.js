/* ============================================================
   アヒル逃走記 3D — エントリポイント
   「どのモジュールが何を知っているか」を決めて配線する場所。
   ゲームの進行(モード・ラウンド・スコア・カメラ)もここが持つ。

   モードは2つ:
     アヒル側 … 2体の鬼から逃げながら戦う
     鬼側     … アヒルを追いかけてつかまえる
   ============================================================ */

import { createRenderer } from './engine/gl.js';
import { node, add, collect, createCamera } from './engine/scene.js';
import { clamp, lerp, turnToward, wrapAngle } from './engine/math.js';
import { createMeshes } from './models/meshes.js';
import { createWorld } from './models/world.js';
import { createEffects } from './game/effects.js';
import { createProjectiles } from './game/projectiles.js';
import { createPickups } from './game/pickups.js';
import { createPlayer } from './game/player.js';
import { createOniEntity } from './game/enemy.js';
import { createOniPlayer } from './game/oni-player.js';
import { createDuckAi } from './game/duck-ai.js';
import { createInput } from './game/input.js';
import { createAudio } from './game/audio.js';
import { createHud } from './hud.js';
import {
  ARENA, CAMERA, CONTROLS, DIFFICULTY, ONI, ONI_MODE, ONI_PLAYER,
  PICKUPS, PLAYER, ROUNDS, SCORE, roundScale,
} from './config.js';

const BEST_KEY = { duck: 'duck-escape-best', oni: 'duck-escape-best-oni' };
const canvas = document.getElementById('view');

/* ---------------- 3Dの土台 ---------------- */

let renderer;
try {
  renderer = createRenderer(canvas);
} catch (err) {
  document.body.innerHTML =
    '<div style="color:#fff;font-family:sans-serif;padding:24px;line-height:1.8">' +
    '<h2>3Dを表示できませんでした</h2><p>' + err.message +
    '</p><p>WebGLが使えるブラウザ(Chrome / Edge / Safari の新しいもの)でお試しください。</p></div>';
  throw err;
}

const M = createMeshes(renderer);
const camera = createCamera(58);
const scene = node({});
const world3d = createWorld(M, (Math.random() * 1e9) | 0);
add(scene, world3d.root);

const effects = createEffects(M, scene);
const projectiles = createProjectiles(M, scene, effects);
const pickups = createPickups(M, scene, effects);
const audio = createAudio();
const hud = createHud();

const duckPlayer = createPlayer(M, scene, audio, effects);   // アヒル側であなたが動かすアヒル
const oniPlayer = createOniPlayer(M, scene, audio, effects); // 鬼側であなたが動かす赤鬼
let duckAi = null;                                           // 鬼側で逃げるアヒル(AI)

// 相手(またはゲート)の方向を示す矢印。あなたの真上に浮かぶ
const guideArrow = add(scene, node({ mesh: M.cone, sx: 0.32, sz: 0.32, sy: 0.62, rx: Math.PI / 2, emissive: 0.85, visible: false }));

const input = createInput(canvas, {
  stick: document.getElementById('stick'),
  knob: document.getElementById('stickKnob'),
  fire: document.getElementById('btnFire'),
  dash: document.getElementById('btnDash'),
  swap: document.getElementById('btnSwap'),
});

/* ---------------- ゲームの状態 ---------------- */

const G = {
  mode: 'title',              // title / playing / paused / result
  side: 'duck',               // duck(アヒル側) / oni(鬼側)
  control: 'auto',            // auto(おまかせ) / manual(じぶんで)
  difficulty: 'easy',
  phase: 'round',             // round / interval / escape / over
  round: 1,
  score: 0,
  time: 0,
  timer: 0,
  roundTime: 0,               // 鬼モードののこり時間
  onis: [],                   // AIの鬼
  enemies: [],                // あなたの攻撃が当たる相手
  spawnTimer: 0,
  best: { duck: Number(localStorage.getItem(BEST_KEY.duck) || 0), oni: Number(localStorage.getItem(BEST_KEY.oni) || 0) },
  camYaw: Math.PI,
  camPitch: CAMERA.pitch,
  camDist: null,
  shake: 0,
};

const ctrl = () => CONTROLS[G.control];
const me = () => (G.side === 'duck' ? duckPlayer : oniPlayer);

hud.setBest(G.best[G.side]);

/** 各モジュールが共有する「世界」。ここ越しに触り合う */
const worldRef = {
  obstacles: world3d.obstacles,
  onis: G.onis,
  enemies: G.enemies,
  player: duckPlayer,
  oniTarget: duckPlayer,     // AIの鬼が追いかける相手
  oniFaction: 'enemy',       // AIの鬼の弾がどちら側の攻撃か
  chasers: [],               // AIのアヒルが逃げる相手
  pickupItems: pickups.items,
  projectiles,
  round: 1,
  camYaw: 0,

  /** あなたの飛び道具が相手に当たった */
  onHitEnemy(target, p) {
    const dealt = target.takeDamage(p.damage, p.x - p.vx * 0.05, p.z - p.vz * 0.05, worldRef) || 0;
    me().stats.damage = (me().stats.damage || 0) + dealt;
    addScore(dealt * SCORE.perDamage);
    if (target.dead) onEnemyDown(target);
  },

  /** あなたが飛び道具を受けた */
  onHitPlayer(p) {
    const dmg = G.side === 'oni' ? 1 : p.damage;
    if (worldRef.player.takeDamage(dmg, p.x, p.z, worldRef)) onPlayerHurt();
  },

  /** AIの鬼の攻撃が「追いかけている相手」に当たった */
  onTargetHurt(who) {
    if (who === worldRef.player) onPlayerHurt();
    else if (who.dead) onEnemyDown(who);
  },

  /** あなた(鬼)の金棒が当たった */
  onOniHit(target, dmg) {
    const dealt = target.takeDamage(dmg, oniPlayer.x, oniPlayer.z, worldRef);
    if (dealt) {
      oniPlayer.stats.hits++;
      G.shake = Math.max(G.shake, 0.45);
      audio.play('hitOni');
      if (target.dead) onEnemyDown(target);
    }
  },
};

function onEnemyDown(target) {
  G.shake = Math.max(G.shake, 0.6);
  if (G.side === 'duck') {
    addScore(SCORE.oniDefeated);
    hud.toast(`${target.def.name} をたおした!`, 1400);
  } else {
    hud.toast('アヒルをつかまえた!', 1600);
    audio.play('clear');
  }
}

function onPlayerHurt() {
  hud.damageFlash();
  G.shake = Math.max(G.shake, 0.75);
  if (worldRef.player.down) {
    G.phase = 'over';
    G.timer = 1.8;
    audio.play('gameover');
    audio.stopBgm();
  }
}

function addScore(v) { G.score += v * DIFFICULTY[G.difficulty].scoreMul; }

/* ---------------- ラウンドの用意 ---------------- */

function clearActors() {
  for (const o of G.onis) o.dispose();
  G.onis.length = 0;
  G.enemies.length = 0;
  if (duckAi) { duckAi.dispose(); duckAi = null; }
  worldRef.chasers = [];
}

/** ラウンド開始時に落ちているアイテムをばらまく */
function scatterItems(round) {
  const picker = pickups.picker(round);
  const count = Math.round(PICKUPS.startCount * DIFFICULTY[G.difficulty].itemRate);
  for (let i = 0; i < count; i++) pickups.spawnRandom(picker, worldRef, worldRef.player);
  G.spawnTimer = PICKUPS.spawnInterval;
}

/* ---- アヒル側: 鬼2体からにげる ---- */

function startDuckRound(n) {
  clearActors();
  G.round = n;
  worldRef.round = n;
  G.phase = 'round';
  const rs = roundScale(n);
  const df = DIFFICULTY[G.difficulty];
  const mul = {
    hp: rs.hp * df.oniHp,
    speed: rs.speed * df.oniSpeed * (ctrl().autoAim ? 0.92 : 1),   // おまかせ操作ならもう少しゆっくり
    rate: rs.rate * df.oniRate,
  };

  const spots = [[-1, -1], [1, 1]];
  [ONI.red, ONI.blue].forEach((def, i) => {
    const e = createOniEntity(M, scene, def, mul, audio, effects);
    const [sx, sz] = spots[i];
    e.place(sx * (ARENA.half - 7), sz * (ARENA.half - 7));
    G.onis.push(e);
    G.enemies.push(e);
    effects.ring(e.x, 0.08, e.z, def.color, 1, 7, 0.9);
    effects.burst(e.x, 1.5, e.z, 18, def.color, { speed: 7, size: 0.2, life: 0.8 });
  });

  hud.buildOniBars(G.onis);
  hud.setRound(`ラウンド ${n} / ${ROUNDS}`);
  hud.setTimer(null);
  hud.toast(`ラウンド ${n} — 鬼があらわれた!`, 1900);
  audio.play('roundStart');
  audio.play('oniRoar');
  scatterItems(n);
}

function finishDuckRound() {
  addScore(SCORE.roundClear);
  if (G.round >= ROUNDS) {
    G.phase = 'escape';
    world3d.gate.setOpen(true);
    hud.setRound('ゲートへ逃げろ!');
    hud.toast('鳥居のゲートがひらいた! 🏮<br>逃げきれ!', 2600);
    audio.play('gate');
    effects.ring(world3d.gate.x, 0.08, world3d.gate.z, [1, 0.85, 0.4], 1, 12, 1.2);
  } else {
    G.phase = 'interval';
    G.timer = 3.2;
    duckPlayer.hp = Math.min(PLAYER.maxHp, duckPlayer.hp + 1);   // 少し回復してひと息
    hud.toast('鬼を2体ともたおした!<br>つぎのラウンドがくるぞ…', 2600);
    audio.play('clear');
  }
}

/* ---- 鬼側: アヒルをつかまえる ---- */

function startOniRound(n) {
  clearActors();
  G.round = n;
  worldRef.round = n;
  G.phase = 'round';
  G.roundTime = ONI_MODE.timeLimit;

  const df = DIFFICULTY[G.difficulty];
  const speedMul = (1 + ONI_MODE.duckSpeedPerRound * (n - 1)) * (2 - df.oniSpeed) * (ctrl().autoAim ? 0.94 : 1);
  duckAi = createDuckAi(M, scene, audio, effects, { speed: speedMul, aim: df.duckAim, rate: df.duckRate });
  duckAi.place(oniPlayer.x - 11, oniPlayer.z - 11);   // 近すぎず遠すぎない位置から逃げ出す
  G.enemies.push(duckAi);
  worldRef.oniTarget = duckAi;
  effects.ring(duckAi.x, 0.08, duckAi.z, [1, 0.95, 0.7], 1, 6, 0.9);

  // なかまの青鬼(ラウンドが進むと手伝ってくれる)
  if (n >= ONI_MODE.helperFromRound) {
    const mul = { hp: 99, speed: 0.85 * df.oniSpeed, rate: 1.1 };
    const helper = createOniEntity(M, scene, ONI.blue, mul, audio, effects);
    helper.place(ARENA.half - 9, -(ARENA.half - 9));
    G.onis.push(helper);
  }
  worldRef.chasers = [oniPlayer, ...G.onis];

  hud.buildOniBars([duckAi]);
  hud.setRound(`ラウンド ${n} / ${ONI_MODE.rounds}`);
  hud.setTimer(G.roundTime);
  hud.toast(`ラウンド ${n} — アヒルをつかまえろ!`, 1900);
  audio.play('roundStart');
  audio.play('oniRoar');
  scatterItems(n);
}

function finishOniRound() {
  // つかまえた分の得点は、どうやって倒しても必ずここで入る
  oniPlayer.stats.caught++;
  addScore(ONI_MODE.catchScore + Math.max(0, G.roundTime) * ONI_MODE.timeLeftScore);
  if (G.round >= ONI_MODE.rounds) { endGame(true); return; }
  G.phase = 'interval';
  G.timer = 3.0;
  oniPlayer.hp = Math.min(ONI_PLAYER.maxHp, oniPlayer.hp + 1);
  hud.toast('つぎのアヒルがにげだした!', 2400);
}

/* ---------------- ゲーム開始・終了 ---------------- */

function startGame() {
  audio.unlock();
  G.mode = 'playing';
  G.score = 0;
  G.time = 0;
  G.camYaw = Math.PI;
  G.camPitch = CAMERA.pitch;
  G.camDist = null;
  projectiles.clear();
  pickups.clear();
  clearActors();
  world3d.gate.setOpen(false);

  const c = ctrl();
  duckPlayer.infiniteAmmo = c.infiniteAmmo;
  duckPlayer.reset();
  oniPlayer.reset();

  // 使わない方は画面から消しておく
  duckPlayer.model.root.visible = duckPlayer.model.shadow.visible = (G.side === 'duck');
  oniPlayer.model.root.visible = oniPlayer.model.shadow.visible = (G.side === 'oni');

  worldRef.player = me();
  worldRef.oniTarget = duckPlayer;
  worldRef.oniFaction = G.side === 'duck' ? 'enemy' : 'player';

  if (G.side === 'duck') startDuckRound(1);
  else startOniRound(1);

  hud.setHp(worldRef.player.hp, worldRef.player.maxHp || PLAYER.maxHp);
  hud.showScreen('game', input.state.isTouch);
  hud.setAutoMode(c.autoFire, input.state.isTouch);
  input.setEnabled(true);
  audio.startBgm();
}

function endGame(win) {
  G.mode = 'result';
  audio.stopBgm();
  input.setEnabled(false);

  let detail = '', titles;
  if (G.side === 'duck') {
    titles = { win: '逃げきった!', lose: 'つかまってしまった…', icon: '🎉' };
    if (win) {
      const timeBonus = Math.max(0, SCORE.timeBonusMax - G.time * SCORE.timeBonusPerSec);
      addScore(SCORE.escape + duckPlayer.hp * SCORE.hpLeft + timeBonus);
      detail = `タイム <b>${G.time.toFixed(1)}秒</b> / のこり体力 <b>${duckPlayer.hp}</b><br>` +
               `あたえたダメージ <b>${Math.round(duckPlayer.stats.damage)}</b>`;
    } else {
      detail = `ラウンド <b>${G.round}</b> でつかまった…<br>` +
               `あたえたダメージ <b>${Math.round(duckPlayer.stats.damage || 0)}</b> / タイム <b>${G.time.toFixed(1)}秒</b>`;
    }
  } else {
    titles = { win: 'ぜんぶつかまえた!', lose: 'にげられた…', icon: '👹' };
    if (win) addScore(oniPlayer.hp * SCORE.hpLeft);
    detail = `つかまえたアヒル <b>${oniPlayer.stats.caught}匹</b> / ラウンド <b>${G.round}</b><br>` +
             `なぐった回数 <b>${oniPlayer.stats.hits}</b> / タイム <b>${G.time.toFixed(1)}秒</b>`;
  }
  audio.play(win ? 'clear' : 'gameover');

  const score = Math.round(G.score);
  if (score > G.best[G.side]) {
    G.best[G.side] = score;
    localStorage.setItem(BEST_KEY[G.side], String(score));
    detail += '<br>🏆 ハイスコア更新!';
  }
  hud.setBest(G.best[G.side]);
  hud.showResult(win, score, G.best[G.side], detail, titles);
  hud.showScreen('result', input.state.isTouch);
}

/* ---------------- カメラ ---------------- */

function updateCamera(dt, look, target) {
  const sens = input.state.isTouch ? CAMERA.touchSens : CAMERA.mouseSens;
  G.camYaw -= look.dx * sens;
  G.camPitch = clamp(G.camPitch - look.dy * sens, CAMERA.minPitch, CAMERA.maxPitch);

  // 「おまかせ」では、見たいものの方へカメラがゆっくり自分で回る
  if (ctrl().cameraAssist && target) {
    const want = Math.atan2(target.x - worldRef.player.x, target.z - worldRef.player.z);
    const diff = wrapAngle(want - G.camYaw);
    if (Math.abs(diff) > 0.5) G.camYaw = turnToward(G.camYaw, want, dt * 1.7);
  }

  const tx = worldRef.player.x, tz = worldRef.player.z;
  const tall = G.side === 'oni' ? 1.6 : 1;
  const wantDist = CAMERA.distance * tall * (1 - G.camPitch * 0.35);
  const height = (CAMERA.height + G.camPitch * 6) * tall;

  // 壁や木にカメラがめり込まないよう、当たる手前まで引き寄せる
  const dirX = -Math.sin(G.camYaw), dirZ = -Math.cos(G.camYaw);
  const lim = ARENA.half - 1.4;
  let ratio = 0.42;
  const steps = 10;
  for (let i = steps; i >= 1; i--) {
    const f = i / steps;
    const x = tx + dirX * wantDist * f, z = tz + dirZ * wantDist * f;
    if (Math.abs(x) > lim || Math.abs(z) > lim) continue;
    if (world3d.obstacles.some(o => Math.hypot(o.x - x, o.z - z) < o.r + 0.9)) continue;
    ratio = f;
    break;
  }
  // 急に寄る/離れるとガタつくので、なめらかに追従させる
  G.camDist = lerp(G.camDist == null ? wantDist : G.camDist, wantDist * ratio,
                   Math.min(1, dt * (ratio * wantDist < G.camDist ? 18 : 5)));

  // 塀の外に出てしまわないよう、最後に念のため内側へ押しもどす
  const rawX = tx + dirX * G.camDist, rawZ = tz + dirZ * G.camDist;
  const cx = clamp(rawX, -lim, lim);
  const cz = clamp(rawZ, -lim, lim);
  const near = G.camDist / wantDist;
  let cy = Math.max(1.6, 1.2 + height * (1.3 - 0.3 * near));     // 近づいたぶん見おろす
  // 塀ぎわで押しもどされたときは、塀の上から見おろす高さまで持ち上げる
  if (Math.abs(cx - rawX) + Math.abs(cz - rawZ) > 0.2) cy = Math.max(cy, ARENA.wallH + 3.4);

  G.shake = Math.max(0, G.shake - dt * CAMERA.shakeDecay);
  const sh = G.shake * G.shake * 0.9;
  camera.pos.x = cx + (Math.random() - 0.5) * sh;
  camera.pos.y = cy + (Math.random() - 0.5) * sh;
  camera.pos.z = cz + (Math.random() - 0.5) * sh;
  camera.target.x = tx;
  camera.target.y = (G.side === 'oni' ? 2.4 : 1.4) + G.camPitch * 1.2;
  camera.target.z = tz;
  worldRef.camYaw = G.camYaw;
}

/** いま気にするべき相手(矢印・オートエイム・カメラの向き先) */
function currentTarget() {
  if (G.side === 'duck' && G.phase === 'escape') {
    return { x: world3d.gate.x, z: world3d.gate.z, color: [1, 0.85, 0.35], gate: true };
  }
  let best = null, bestD = 1e9;
  for (const e of G.enemies) {
    if (e.dead || e.down) continue;
    const d = Math.hypot(e.x - worldRef.player.x, e.z - worldRef.player.z);
    if (d < bestD) { bestD = d; best = e; }
  }
  if (!best) return null;
  return { x: best.x, z: best.z, color: best.def.color, entity: best, dist: bestD };
}

function updateGuideArrow(target) {
  const p = worldRef.player;
  if (!target || p.down) { guideArrow.visible = false; return; }
  guideArrow.visible = true;
  guideArrow.color = target.color;
  guideArrow.pos.x = p.x;
  guideArrow.pos.z = p.z;
  guideArrow.pos.y = (G.side === 'oni' ? 5.2 : 3.15) + Math.sin(elapsed * 4) * 0.14;
  guideArrow.rot.y = Math.atan2(target.x - p.x, target.z - p.z);
}

function titleCamera(t) {
  guideArrow.visible = false;
  const a = t * 0.12;
  camera.pos.x = Math.sin(a) * 17;
  camera.pos.z = Math.cos(a) * 17;
  camera.pos.y = 7.5;
  camera.target.x = 0; camera.target.y = 1.6; camera.target.z = 0;
  worldRef.camYaw = a + Math.PI;
  duckPlayer.model.root.rot.y = a + Math.PI + 0.4;
  duckPlayer.model.update(1 / 60, { speed: 0, dashing: false, invuln: 0, hurtFlash: 0 });
}

/* ---------------- メインループ ---------------- */

let last = performance.now();
let elapsed = 0;
const drawList = [];

function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000;
  last = now;
  dt = Math.min(dt, 0.05);            // タブ復帰時に一気に進まないように
  elapsed += dt;

  if (G.mode === 'playing') step(dt);
  else if (G.mode === 'title') titleCamera(elapsed);

  hud.update(dt);
  audio.update();
  world3d.gate.update(elapsed);

  const aspect = renderer.resize();
  camera.update(aspect);
  drawList.length = 0;
  collect(scene, null, drawList);
  renderer.render(camera, drawList);
}

function step(dt) {
  G.time += dt;
  const c = ctrl();
  const p = worldRef.player;

  const st = input.sample();
  const look = input.consumeLook();
  const edges = input.consumeEdges();

  if (edges.pause) { pause(); return; }
  if (edges.dash) p.tryDash(st, G.camYaw);
  if (G.side === 'duck') {
    if (edges.swap) duckPlayer.switchWeapon(1);
    if (edges.pick !== undefined) duckPlayer.selectWeapon(edges.pick);
  }

  const target = currentTarget();
  updateCamera(dt, look, target);

  // ---- ねらい(おまかせなら自動) ----
  const targetDist = target && target.entity ? target.dist : Infinity;
  if (c.autoAim && target && target.entity && targetDist < (G.side === 'duck' ? 30 : 18)) {
    p.aimYaw = Math.atan2(target.x - p.x, target.z - p.z);
  } else {
    p.aimYaw = null;
  }

  const beforeX = p.x, beforeZ = p.z;
  p.update(dt, st, G.camYaw, worldRef);
  p.lastVx = (p.x - beforeX) / dt;
  p.lastVz = (p.z - beforeZ) / dt;

  // ---- ダッシュ(おまかせなら自動。動いている向きへ飛ぶ) ----
  if (c.autoFire && Math.hypot(st.move.x, st.move.y) > 0.2 && targetDist < Infinity) {
    const wantDash = G.side === 'duck' ? targetDist < 5.5 : (targetDist > 4.5 && targetDist < 12);
    if (wantDash) p.tryDash(st, G.camYaw);
  }

  // ---- 攻撃 ----
  if (G.side === 'duck') {
    const auto = c.autoFire && target && target.entity && targetDist < 26;
    if (st.fire || auto) duckPlayer.fire(worldRef);
  } else {
    const auto = c.autoFire && targetDist < ONI_PLAYER.attackRange + ONI_PLAYER.autoSwingMargin;
    if (st.fire || auto) oniPlayer.swing();
  }

  // ---- まわりの更新 ----
  for (const o of G.onis) o.update(dt, worldRef);
  if (duckAi) duckAi.update(dt, worldRef);
  updateGuideArrow(target);
  projectiles.update(dt, worldRef);
  pickups.update(dt, collectors());
  effects.update(dt);

  // アイテムの補充
  if (G.phase === 'round') {
    G.spawnTimer -= dt;
    if (G.spawnTimer <= 0) {
      G.spawnTimer = PICKUPS.spawnInterval / DIFFICULTY[G.difficulty].itemRate;
      pickups.spawnRandom(pickups.picker(G.round), worldRef, p);
    }
  }

  // BGMの緊張度は「相手との距離」で決める
  audio.setTension(targetDist < 20 ? 1 - (targetDist - 4) / 16 : 0);

  // ---- 進行判定 ----
  if (G.phase === 'round') {
    if (G.side === 'duck') {
      if (G.onis.length && G.onis.every(o => o.dead)) finishDuckRound();
    } else {
      G.roundTime -= dt;
      if (duckAi && duckAi.dead) finishOniRound();
      else if (G.roundTime <= 0) { G.phase = 'over'; G.timer = 1.2; audio.stopBgm(); }
    }
  } else if (G.phase === 'interval') {
    G.timer -= dt;
    if (G.timer <= 0) {
      if (G.side === 'duck') startDuckRound(G.round + 1);
      else startOniRound(G.round + 1);
    }
  } else if (G.phase === 'escape') {
    const d = Math.hypot(p.x - world3d.gate.x, p.z - world3d.gate.z);
    if (d < 3.4) {
      effects.burst(p.x, 1.2, p.z, 30, [1, 0.9, 0.5], { speed: 8, size: 0.2, life: 1 });
      endGame(true);
      return;
    }
  } else if (G.phase === 'over') {
    G.timer -= dt;
    if (G.timer <= 0) { endGame(false); return; }
  }

  updateHud(c);
}

/** アイテムを拾える人たち(鬼はハートだけ拾える) */
function collectors() {
  if (G.side === 'duck') {
    return [{ who: duckPlayer, onCollect: (k) => duckPlayer.give(k) }];
  }
  const list = [];
  if (duckAi) list.push({ who: duckAi, onCollect: (k) => duckAi.give(k) });
  list.push({ who: oniPlayer, accept: (k) => k === 'heart', onCollect: (k) => oniPlayer.give(k) });
  return list;
}

function updateHud(c) {
  const p = worldRef.player;
  hud.setScore(G.score);
  if (G.side === 'duck') {
    hud.setHp(p.hp, PLAYER.maxHp);
    hud.setDash(1 - p.dashCd / PLAYER.dashCooldown);
    hud.setWeapon(p.current, c.infiniteAmmo ? null : p.ammo[p.current]);
    hud.setWeaponList(p.ammo, p.current, c.infiniteAmmo);
    hud.updateOniBars(G.onis);
  } else {
    hud.setHp(p.hp, ONI_PLAYER.maxHp);
    hud.setDash(1 - p.dashCd / ONI_PLAYER.dashCooldown);
    hud.setWeapon('club', null);
    hud.setWeaponList(null);
    hud.updateOniBars(duckAi ? [duckAi] : []);
    if (G.phase === 'round') hud.setTimer(G.roundTime);
  }
}

/* ---------------- 画面の出し入れ ---------------- */

function pause() {
  if (G.mode !== 'playing') return;
  G.mode = 'paused';
  input.setEnabled(false);
  audio.stopBgm();
  hud.showScreen('pause', input.state.isTouch);
}

function resume() {
  if (G.mode !== 'paused') return;
  G.mode = 'playing';
  last = performance.now();
  input.setEnabled(true);
  audio.startBgm();
  hud.showScreen('game', input.state.isTouch);
}

function toTitle() {
  G.mode = 'title';
  clearActors();
  projectiles.clear();
  pickups.clear();
  duckPlayer.reset();
  duckPlayer.model.root.visible = duckPlayer.model.shadow.visible = true;
  oniPlayer.model.root.visible = oniPlayer.model.shadow.visible = false;
  worldRef.player = duckPlayer;
  world3d.gate.setOpen(false);
  input.setEnabled(false);
  audio.stopBgm();
  hud.setBest(G.best[G.side]);
  hud.showScreen('title', input.state.isTouch);
}

/* ---------------- ボタンの配線 ---------------- */

document.getElementById('startBtn').addEventListener('click', startGame);
document.getElementById('retryBtn').addEventListener('click', startGame);
document.getElementById('titleBtn').addEventListener('click', toTitle);
document.getElementById('resumeBtn').addEventListener('click', resume);
document.getElementById('quitBtn').addEventListener('click', toTitle);
document.getElementById('pauseBtn').addEventListener('click', pause);

/** タイトルの選択ボタン(3つとも同じ動き) */
function wireSegment(id, apply) {
  const seg = document.getElementById(id);
  seg.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    for (const el of seg.children) el.classList.toggle('on', el === b);
    apply(b.dataset);
  });
}
wireSegment('sideSeg', (d) => { G.side = d.side; hud.setBest(G.best[G.side]); });
wireSegment('controlSeg', (d) => { G.control = d.control; });
wireSegment('difficultySeg', (d) => { G.difficulty = d.diff; });

addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
addEventListener('contextmenu', (e) => { if (G.mode === 'playing') e.preventDefault(); });

oniPlayer.model.root.visible = oniPlayer.model.shadow.visible = false;
hud.showScreen('title', input.state.isTouch);
duckPlayer.reset();
window.__duckEscapeReady = true;   // 読み込みチェック用(index.html が見ている)
requestAnimationFrame(frame);
