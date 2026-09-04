/* ============================================================
   アヒル逃走記 3D — エントリポイント
   「どのモジュールが何を知っているか」を決めて配線する場所。
   ゲームの進行(ラウンド管理・スコア・カメラ)もここが持つ。
   ============================================================ */

import { createRenderer } from './engine/gl.js';
import { node, add, collect, createCamera } from './engine/scene.js';
import { clamp, lerp } from './engine/math.js';
import { createMeshes } from './models/meshes.js';
import { createWorld } from './models/world.js';
import { createEffects } from './game/effects.js';
import { createProjectiles } from './game/projectiles.js';
import { createPickups } from './game/pickups.js';
import { createPlayer } from './game/player.js';
import { createOniEntity } from './game/enemy.js';
import { createInput } from './game/input.js';
import { createAudio } from './game/audio.js';
import { createHud } from './hud.js';
import { ARENA, CAMERA, DIFFICULTY, ONI, PICKUPS, ROUNDS, SCORE, roundScale } from './config.js';

const BEST_KEY = 'duck-escape-best';
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
const player = createPlayer(M, scene, audio, effects);
const hud = createHud();

// 敵/ゲートの方向を示す矢印(アヒルの真上に浮かぶ)
const guideArrow = add(scene, node({ mesh: M.cone, sx: 0.4, sz: 0.4, sy: 0.75, rx: Math.PI / 2, emissive: 0.85, visible: false }));

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
  phase: 'round',             // round(戦闘中) / interval(次の準備) / escape(ゲートへ) / over
  round: 1,
  difficulty: 'normal',
  score: 0,
  time: 0,
  timer: 0,
  onis: [],
  spawnTimer: 0,
  best: Number(localStorage.getItem(BEST_KEY) || 0),
  camYaw: Math.PI,
  camPitch: CAMERA.pitch,
  shake: 0,
  won: false,
};

hud.setBest(G.best);

/** 鬼や弾から見た「世界」。各モジュールはこのオブジェクト越しに触り合う */
const worldRef = {
  obstacles: world3d.obstacles,
  onis: G.onis,
  player,
  projectiles,
  round: 1,
  camYaw: 0,
  onHitOni(oni, p) {
    const dirX = p.vx, dirZ = p.vz;
    const l = Math.hypot(dirX, dirZ) || 1;
    const dealt = oni.takeDamage(p.damage, dirX / l, dirZ / l, worldRef);
    player.stats.damage += dealt;
    addScore(dealt * SCORE.perDamage);
    if (oni.dead) {
      addScore(SCORE.oniDefeated);
      hud.toast(`${oni.def.name} をたおした!`, 1400);
      G.shake = Math.max(G.shake, 0.5);
    }
  },
  onHitPlayer(p) {
    if (player.takeDamage(p.damage, p.x, p.z, worldRef)) onPlayerHurt();
  },
  onPlayerHurt: () => onPlayerHurt(),
};

function onPlayerHurt() {
  hud.damageFlash();
  G.shake = Math.max(G.shake, 0.75);
  if (player.down) {
    G.phase = 'over';
    G.timer = 1.8;
    audio.play('gameover');
    audio.stopBgm();
  }
}

function addScore(v) { G.score += v * DIFFICULTY[G.difficulty].scoreMul; }

/* ---------------- ラウンド進行 ---------------- */

function clearOnis() {
  for (const o of G.onis) o.dispose();
  G.onis.length = 0;
}

function startRound(n) {
  clearOnis();
  G.round = n;
  worldRef.round = n;
  G.phase = 'round';
  const rs = roundScale(n);
  const df = DIFFICULTY[G.difficulty];
  const mul = { hp: rs.hp * df.oniHp, speed: rs.speed * df.oniSpeed, rate: rs.rate * df.oniRate };

  const spots = [[-1, -1], [1, 1]];
  [ONI.red, ONI.blue].forEach((def, i) => {
    const e = createOniEntity(M, scene, def, mul, audio, effects);
    const [sx, sz] = spots[i];
    e.place(sx * (ARENA.half - 7), sz * (ARENA.half - 7));
    G.onis.push(e);
    effects.ring(e.x, 0.08, e.z, def.color, 1, 7, 0.9);
    effects.burst(e.x, 1.5, e.z, 18, def.color, { speed: 7, size: 0.2, life: 0.8 });
  });

  hud.buildOniBars(G.onis);
  hud.setRound(`ラウンド ${n} / ${ROUNDS}`);
  hud.toast(`ラウンド ${n} — 鬼があらわれた!`, 1900);
  audio.play('roundStart');
  audio.play('oniRoar');

  // 開始時のアイテム
  const picker = pickups.picker(n);
  const count = Math.round(PICKUPS.startCount * DIFFICULTY[G.difficulty].itemRate);
  for (let i = 0; i < count; i++) pickups.spawnRandom(picker, worldRef, player);
  G.spawnTimer = PICKUPS.spawnInterval;
}

function finishRound() {
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
    player.hp = Math.min(5, player.hp + 1);       // 少し回復してひと息
    hud.toast('鬼を2体ともたおした!<br>つぎのラウンドがくるぞ…', 2600);
    audio.play('clear');
  }
}

function endGame(win) {
  G.mode = 'result';
  G.won = win;
  audio.stopBgm();
  input.setEnabled(false);

  let detail = '';
  if (win) {
    const timeBonus = Math.max(0, SCORE.timeBonusMax - G.time * SCORE.timeBonusPerSec);
    addScore(SCORE.escape + player.hp * SCORE.hpLeft + timeBonus);
    detail = `タイム <b>${G.time.toFixed(1)}秒</b> / のこり体力 <b>${player.hp}</b><br>` +
             `あたえたダメージ <b>${Math.round(player.stats.damage)}</b>`;
    audio.play('clear');
  } else {
    detail = `ラウンド <b>${G.round}</b> でつかまった…<br>` +
             `あたえたダメージ <b>${Math.round(player.stats.damage)}</b> / タイム <b>${G.time.toFixed(1)}秒</b>`;
  }
  const score = Math.round(G.score);
  if (score > G.best) {
    G.best = score;
    localStorage.setItem(BEST_KEY, String(score));
    detail += '<br>🏆 ハイスコア更新!';
  }
  hud.setBest(G.best);
  hud.showResult(win, score, G.best, detail);
  hud.showScreen('result', input.state.isTouch);
}

function startGame() {
  audio.unlock();
  G.mode = 'playing';
  G.score = 0;
  G.time = 0;
  G.won = false;
  G.camYaw = Math.PI;
  G.camPitch = CAMERA.pitch;
  projectiles.clear();
  pickups.clear();
  player.reset();
  world3d.gate.setOpen(false);
  startRound(1);
  hud.setHp(player.hp);
  hud.showScreen('game', input.state.isTouch);
  input.setEnabled(true);
  audio.startBgm();
}

/* ---------------- カメラ ---------------- */

function updateCamera(dt, look) {
  const sens = input.state.isTouch ? CAMERA.touchSens : CAMERA.mouseSens;
  G.camYaw -= look.dx * sens;
  G.camPitch = clamp(G.camPitch - look.dy * sens, CAMERA.minPitch, CAMERA.maxPitch);

  const tx = player.x, tz = player.z;
  const wantDist = CAMERA.distance * (1 - G.camPitch * 0.35);
  const height = CAMERA.height + G.camPitch * 6;

  // 壁や木にカメラがめり込まないよう、当たる手前まで引き寄せる
  const dirX = -Math.sin(G.camYaw), dirZ = -Math.cos(G.camYaw);
  const lim = ARENA.half - 1.4;
  let ratio = 0.45;
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

  const cx = tx + dirX * G.camDist;
  const cz = tz + dirZ * G.camDist;
  const near = G.camDist / wantDist;
  const cy = Math.max(1.6, 1.2 + height * (1.3 - 0.3 * near));   // 近づいたぶん見おろす

  G.shake = Math.max(0, G.shake - dt * CAMERA.shakeDecay);
  const sh = G.shake * G.shake * 0.9;
  camera.pos.x = cx + (Math.random() - 0.5) * sh;
  camera.pos.y = cy + (Math.random() - 0.5) * sh;
  camera.pos.z = cz + (Math.random() - 0.5) * sh;
  camera.target.x = tx;
  camera.target.y = 1.4 + G.camPitch * 1.2;
  camera.target.z = tz;
  worldRef.camYaw = G.camYaw;
}

/** 追ってくる鬼(または脱出ゲート)の方向を、アヒルの上の矢印で知らせる */
function updateGuideArrow() {
  let target = null, color = null;
  if (G.phase === 'escape') {
    target = { x: world3d.gate.x, z: world3d.gate.z };
    color = [1, 0.85, 0.35];
  } else {
    let best = 1e9;
    for (const o of G.onis) {
      if (o.dead) continue;
      const d = Math.hypot(o.x - player.x, o.z - player.z);
      if (d < best) { best = d; target = o; color = o.def.color; }
    }
  }
  if (!target || player.down) { guideArrow.visible = false; return; }
  guideArrow.visible = true;
  guideArrow.color = color;
  guideArrow.pos.x = player.x;
  guideArrow.pos.z = player.z;
  guideArrow.pos.y = 2.9 + Math.sin(elapsed * 4) * 0.14;
  guideArrow.rot.y = Math.atan2(target.x - player.x, target.z - player.z);
}

function titleCamera(t) {
  guideArrow.visible = false;
  const a = t * 0.12;
  camera.pos.x = Math.sin(a) * 17;
  camera.pos.z = Math.cos(a) * 17;
  camera.pos.y = 7.5;
  camera.target.x = 0; camera.target.y = 1.6; camera.target.z = 0;
  worldRef.camYaw = a + Math.PI;
  player.model.root.rot.y = a + Math.PI + 0.4;
  player.model.update(1 / 60, { speed: 0, dashing: false, invuln: 0, hurtFlash: 0 });
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

  const st = input.sample();
  const look = input.consumeLook();
  const edges = input.consumeEdges();

  if (edges.pause) { pause(); return; }
  if (edges.dash) player.tryDash(st, G.camYaw);
  if (edges.swap) player.switchWeapon(1);
  if (edges.pick !== undefined) player.selectWeapon(edges.pick);

  updateCamera(dt, look);

  const beforeX = player.x, beforeZ = player.z;
  player.update(dt, st, G.camYaw, worldRef);
  player.lastVx = (player.x - beforeX) / dt;
  player.lastVz = (player.z - beforeZ) / dt;

  if (st.fire) player.fire(worldRef);

  for (const o of G.onis) o.update(dt, worldRef);
  updateGuideArrow();
  projectiles.update(dt, worldRef);
  pickups.update(dt, player, (kind) => player.give(kind));
  effects.update(dt);

  // アイテムの補充
  if (G.phase === 'round') {
    G.spawnTimer -= dt;
    if (G.spawnTimer <= 0) {
      G.spawnTimer = PICKUPS.spawnInterval / DIFFICULTY[G.difficulty].itemRate;
      pickups.spawnRandom(pickups.picker(G.round), worldRef, player);
    }
  }

  // BGMの緊張度は「一番近い鬼との距離」で決める
  let near = 999;
  for (const o of G.onis) if (!o.dead) near = Math.min(near, Math.hypot(o.x - player.x, o.z - player.z));
  audio.setTension(near < 20 ? 1 - (near - 4) / 16 : 0);

  // 進行判定
  if (G.phase === 'round' && G.onis.length && G.onis.every(o => o.dead)) finishRound();
  else if (G.phase === 'interval') {
    G.timer -= dt;
    if (G.timer <= 0) startRound(G.round + 1);
  } else if (G.phase === 'escape') {
    const d = Math.hypot(player.x - world3d.gate.x, player.z - world3d.gate.z);
    if (d < 3.4) {
      effects.burst(player.x, 1.2, player.z, 30, [1, 0.9, 0.5], { speed: 8, size: 0.2, life: 1 });
      endGame(true);
      return;
    }
  } else if (G.phase === 'over') {
    G.timer -= dt;
    if (G.timer <= 0) { endGame(false); return; }
  }

  // HUD更新
  hud.setHp(player.hp);
  hud.setScore(G.score);
  hud.setDash(1 - player.dashCd / 1.15);
  hud.setWeapon(player.current, player.ammo[player.current]);
  hud.setWeaponList(player.ammo, player.current);
  hud.updateOniBars(G.onis);
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
  clearOnis();
  projectiles.clear();
  pickups.clear();
  player.reset();
  world3d.gate.setOpen(false);
  input.setEnabled(false);
  audio.stopBgm();
  hud.showScreen('title', input.state.isTouch);
}

/* ---------------- ボタンの配線 ---------------- */

document.getElementById('startBtn').addEventListener('click', startGame);
document.getElementById('retryBtn').addEventListener('click', startGame);
document.getElementById('titleBtn').addEventListener('click', toTitle);
document.getElementById('resumeBtn').addEventListener('click', resume);
document.getElementById('quitBtn').addEventListener('click', toTitle);
document.getElementById('pauseBtn').addEventListener('click', pause);

document.getElementById('difficultySeg').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  G.difficulty = b.dataset.diff;
  for (const el of e.currentTarget.children) el.classList.toggle('on', el === b);
});

addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
addEventListener('contextmenu', (e) => { if (G.mode === 'playing') e.preventDefault(); });

hud.showScreen('title', input.state.isTouch);
player.reset();
window.__duckEscapeReady = true;   // 読み込みチェック用(index.html が見ている)
requestAnimationFrame(frame);
