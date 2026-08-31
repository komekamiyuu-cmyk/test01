// DJミキサー — 2デッキ + クロスフェーダーの、いわゆる普通のDJ機材の構成。
//
// 音はすべて Web Audio で組む。デッキごとの信号の流れは
//   <audio> → LOW → MID → HI → ローパス → ハイパス → チャンネルフェーダー
//           → クロスフェーダー → マスター → 出力
// で、これは実機のミキサーの並びと同じ。
//
// Android版の通常再生はネイティブ(ExoPlayer)側で鳴らしているが、
// DJ画面は2曲を同時に鳴らして混ぜる必要があるので、ここだけは WebView 内の
// Web Audio で完結させる。画面を開くときにネイティブ側の再生は止める。

import { analyzeTrack } from './analyze.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

const TEMPO_RANGE = 16;      // テンポフェーダーの可動範囲(±%)
const BEND_AMOUNT = 0.04;    // ピッチベンドで一時的に変える割合
const AUTOMIX_TAIL = 24;     // 残りこの秒数を切ったら自動でつなぐ
const AUTOMIX_TIME = 8;      // つなぎにかける秒数

let ui = null;               // 一度だけ組み立てる

/**
 * DJ画面を開く。
 * @param {object} opts
 * @param {() => Array} opts.getTracks   今読み込まれている曲を返す
 * @param {AudioContext} [opts.audioContext] 既にある AudioContext があれば使い回す
 * @param {(msg:string) => void} opts.toast
 * @param {() => void} [opts.onOpen]     開くときに通常再生を止めるなど
 */
export async function openDJ(opts) {
  ui ??= build(opts);
  ui.getTracks = opts.getTracks;
  opts.onOpen?.();
  await ui.ctx.resume().catch(() => {});
  $('djScreen').classList.remove('hidden');
  ui.start();
}

export function closeDJ() {
  const screen = $('djScreen');
  if (!screen || screen.classList.contains('hidden')) return false;
  // 画面から消えたまま鳴り続けると止め方が分からなくなるので、両デッキを止める
  ui?.decks.forEach((d) => d.el.pause());
  ui?.stop();
  screen.classList.add('hidden');
  return true;
}

export const isDJOpen = () => !$('djScreen')?.classList.contains('hidden');

// ---------- 組み立て ----------

function build(opts) {
  const ctx = opts.audioContext ?? new (window.AudioContext || window.webkitAudioContext)();
  const toast = opts.toast ?? (() => {});

  const master = ctx.createGain();
  master.gain.value = 0.85;
  const meter = ctx.createAnalyser();
  meter.fftSize = 512;
  const meterData = new Uint8Array(meter.fftSize);
  // 録音用の分岐。出力とは別の枝なので、録音していなくても音には影響しない
  const recDest = ctx.createMediaStreamDestination();
  master.connect(meter);
  meter.connect(ctx.destination);
  master.connect(recDest);

  const decks = ['A', 'B'].map((id) => makeDeck(id, ctx, master, $(`deck${id}`), toast));

  const self = {
    ctx, master, meter, meterData, recDest, decks,
    xfCurve: 'smooth',
    autoMix: false,
    autoMixing: null,
    autoMixReadyAt: 0,
    getTracks: opts.getTracks,
    toast,
    raf: 0,
    start() { if (!this.raf) this.raf = requestAnimationFrame(frame); },
    stop() { cancelAnimationFrame(this.raf); this.raf = 0; },
  };

  decks.forEach((d) => { d.dj = self; wireDeck(d); });
  wireMixer(self);
  wirePicker(self);
  wireRecorder(self);

  function frame() {
    self.raf = requestAnimationFrame(frame);
    for (const d of decks) tickDeck(d);
    tickMeter(self);
    tickAutoMix(self);
  }
  return self;
}

function makeDeck(id, ctx, master, host, toast) {
  const el = document.createElement('audio');
  el.preload = 'auto';
  // 音程を変えずに速さだけ変えるのは既定では有効。実機のターンテーブルは
  // 速さを変えると音程も変わるので、こちらを既定にして KEY LOCK で切り替える
  el.preservesPitch = false;
  host.appendChild(el);

  const src = ctx.createMediaElementSource(el);
  const low = ctx.createBiquadFilter();
  low.type = 'lowshelf';
  low.frequency.value = 120;
  const mid = ctx.createBiquadFilter();
  mid.type = 'peaking';
  mid.frequency.value = 1000;
  mid.Q.value = 0.9;
  const hi = ctx.createBiquadFilter();
  hi.type = 'highshelf';
  hi.frequency.value = 4000;
  const lpf = ctx.createBiquadFilter();
  lpf.type = 'lowpass';
  lpf.frequency.value = 22050;
  const hpf = ctx.createBiquadFilter();
  hpf.type = 'highpass';
  hpf.frequency.value = 10;
  const chGain = ctx.createGain();
  const xfGain = ctx.createGain();

  src.connect(low); low.connect(mid); mid.connect(hi); hi.connect(lpf);
  lpf.connect(hpf); hpf.connect(chGain); chGain.connect(xfGain); xfGain.connect(master);

  const node = $('deckTemplate').content.firstElementChild.cloneNode(true);
  node.dataset.deck = id;
  node.querySelector('.deck-id').textContent = id;
  host.appendChild(node);

  return {
    id, el, node, toast,
    low, mid, hi, lpf, hpf, chGain, xfGain,
    track: null,
    bpm: 0, baseBpm: 0, beatOffset: 0, confident: false,
    peaks: null, waveImg: null,
    cue: 0,
    hot: [null, null, null],
    loop: null,
    tempo: 0,
    bend: 0,
    synced: false,
    tapTimes: [],
    q: (sel) => node.querySelector(sel),
  };
}

// ---------- デッキの操作 ----------

const beatSec = (d) => (d.bpm > 0 ? 60 / d.bpm : 0.5);
const rateOf = (d) => (1 + d.tempo / 100) * (1 + d.bend);
const playedBpm = (d) => d.bpm * rateOf(d);

function applyRate(d) {
  d.el.playbackRate = clamp(rateOf(d), 0.25, 4);
  d.q('.tempo-val').textContent = `${d.tempo >= 0 ? '+' : ''}${d.tempo.toFixed(1)}%`;
  showBpm(d);
}

function showBpm(d) {
  d.q('.bpm-value').textContent = d.bpm ? playedBpm(d).toFixed(1) : '--.-';
  d.q('.bpm-value').classList.toggle('guess', !!d.bpm && !d.confident);
}

async function loadTrack(d, track) {
  d.track = track;
  d.q('.deck-title').textContent = track.title;
  d.q('.deck-sub').textContent = `${track.artist} — ${track.album}`;
  d.q('.bpm-value').textContent = '···';
  d.node.classList.add('analyzing');

  d.el.pause();
  d.el.src = srcUrl(track);
  d.cue = 0;
  d.hot = [null, null, null];
  d.loop = null;
  d.synced = false;
  d.peaks = null;
  d.waveImg = null;
  paintPads(d);

  try {
    const buf = await bytesOf(track);
    const info = await analyzeTrack(buf);
    d.bpm = info.bpm;
    d.baseBpm = info.bpm;
    d.beatOffset = info.beatOffset;
    d.confident = info.confident;
    d.peaks = info.peaks;
    d.waveImg = renderWave(d);
    if (!info.confident) d.toast(`デッキ${d.id}: BPMを推定しました。ずれていたら ×2 / ÷2 や TAP で直せます`);
  } catch (e) {
    d.bpm = 0;
    d.confident = false;
    d.toast(`デッキ${d.id}: 解析できませんでした(再生はできます)`);
  } finally {
    d.node.classList.remove('analyzing');
    showBpm(d);
    applyRate(d);
  }
}

/** 曲の実体の場所。ブラウザ版は File から、Android版は端末内のURLから取る */
function srcUrl(track) {
  if (track.url) return track.url;
  track.url = URL.createObjectURL(track.file);
  return track.url;
}

async function bytesOf(track) {
  if (track.file) return track.file.arrayBuffer();
  const res = await fetch(srcUrl(track));
  return res.arrayBuffer();
}

function playDeck(d) {
  if (!d.track) return;
  d.dj.ctx.resume().catch(() => {});
  d.el.play().catch(() => {});
}

function togglePlay(d) {
  if (!d.track) return;
  if (d.el.paused) playDeck(d);
  else d.el.pause();
}

/**
 * CUE。実機と同じふるまいにしてある。
 *  - 再生中に押す → キュー点へ戻って止まる
 *  - 止まっている間は、押している間だけ頭出しを聴ける(離すとキュー点へ戻る)
 *  - 止まっていて既にキュー点にいれば、そこを新しいキュー点にする
 */
function cueDown(d) {
  if (!d.track) return;
  if (!d.el.paused) {
    d.el.pause();
    d.el.currentTime = d.cue;
    return;
  }
  if (Math.abs(d.el.currentTime - d.cue) > 0.02) d.cue = d.el.currentTime;
  d.cuePreview = true;
  playDeck(d);
}

function cueUp(d) {
  if (!d.cuePreview) return;
  d.cuePreview = false;
  d.el.pause();
  d.el.currentTime = d.cue;
}

/** 相手デッキにテンポと拍を合わせる */
function sync(d) {
  const other = d.dj.decks.find((x) => x !== d);
  if (!d.bpm || !other.bpm || !other.track) { d.toast('相手のデッキに曲が入っていません'); return; }

  const targetRate = clamp((other.bpm * (1 + other.tempo / 100)) / d.bpm, 0.5, 2);
  d.tempo = clamp((targetRate - 1) * 100, -50, 50);
  d.bend = 0;
  applyRate(d);
  d.q('.tempo').value = String(clamp(d.tempo, -TEMPO_RANGE, TEMPO_RANGE));

  // 拍の頭を合わせる。互いの「1拍のどこにいるか」を揃えれば、
  // テンポが同じである以上そのまま合い続ける
  if (other.el.readyState > 0) {
    const phase = (x) => {
      const b = beatSec(x);
      const p = ((x.el.currentTime - x.beatOffset) / b) % 1;
      return p < 0 ? p + 1 : p;
    };
    let diff = phase(other) - phase(d);
    if (diff > 0.5) diff -= 1;
    if (diff < -0.5) diff += 1;
    const t = d.el.currentTime + diff * beatSec(d);
    if (t >= 0 && t < (d.el.duration || Infinity)) d.el.currentTime = t;
  }

  d.synced = true;
  d.node.classList.add('synced');
  showBpm(d);
}

function releaseSync(d) {
  d.synced = false;
  d.node.classList.remove('synced');
}

function setLoop(d, beats) {
  if (!d.track || !d.bpm) return;
  if (d.loop?.beats === beats) { d.loop = null; paintPads(d); return; }
  const len = beats * beatSec(d);
  d.loop = { start: d.el.currentTime, end: d.el.currentTime + len, beats };
  paintPads(d);
}

function hitHot(d, i) {
  if (!d.track) return;
  if (d.hot[i] == null) d.hot[i] = d.el.currentTime;
  else d.el.currentTime = d.hot[i];
  paintPads(d);
}

function clearHot(d, i) {
  d.hot[i] = null;
  paintPads(d);
}

function paintPads(d) {
  d.node.querySelectorAll('.pad.hot').forEach((p, i) => {
    p.classList.toggle('set', d.hot[i] != null);
  });
  d.node.querySelectorAll('.pad.loop').forEach((p) => {
    p.classList.toggle('on', d.loop?.beats === Number(p.dataset.beats));
  });
}

/** 叩いた間隔から BPM を決める(自動検出がずれたときの直し方) */
function tapTempo(d) {
  const now = performance.now();
  if (d.tapTimes.length && now - d.tapTimes[d.tapTimes.length - 1] > 2000) d.tapTimes = [];
  d.tapTimes.push(now);
  if (d.tapTimes.length > 8) d.tapTimes.shift();
  if (d.tapTimes.length < 3) return;
  const span = d.tapTimes[d.tapTimes.length - 1] - d.tapTimes[0];
  const bpm = (60000 * (d.tapTimes.length - 1)) / span;
  if (bpm < 40 || bpm > 220) return;
  d.bpm = Math.round(bpm * 10) / 10;
  d.confident = true;
  // 叩いた最後の瞬間を拍の頭とみなす
  d.beatOffset = d.el.currentTime % (60 / d.bpm);
  d.waveImg = d.peaks ? renderWave(d) : null;
  showBpm(d);
}

function scaleBpm(d, factor) {
  if (!d.bpm) return;
  d.bpm = Math.round(d.bpm * factor * 10) / 10;
  d.confident = true;
  d.waveImg = d.peaks ? renderWave(d) : null;
  showBpm(d);
}

// ---------- EQ・フィルター ----------

/**
 * EQ。つまみは中央が素通しで、下げ切ると -26dB(実機の「切る」に相当)、
 * 上げ切って +6dB。上下で効き幅が違うので、位置(-100〜100)から dB へ変換する。
 */
function setEq(d, band, v) {
  const node = { hi: d.hi, mid: d.mid, low: d.low }[band];
  node.gain.value = (v / 100) * (v < 0 ? 26 : 6);
}

/**
 * フィルターは1本のつまみで、中央が素通し。
 * 左へ回すとローパス(高音が減る)、右へ回すとハイパス(低音が減る)。
 */
function setFilter(d, v) {
  const t = v / 100;
  if (t < -0.02) {
    d.lpf.frequency.value = 20000 * Math.pow(180 / 20000, -t);
    d.hpf.frequency.value = 10;
  } else if (t > 0.02) {
    d.lpf.frequency.value = 22050;
    d.hpf.frequency.value = 20 * Math.pow(9000 / 20, t);
  } else {
    d.lpf.frequency.value = 22050;
    d.hpf.frequency.value = 10;
  }
}

// ---------- 波形 ----------

const WAVE_W = 1200;
const WAVE_H = 120;

function renderWave(d) {
  const c = document.createElement('canvas');
  c.width = WAVE_W;
  c.height = WAVE_H;
  const g = c.getContext('2d');
  const css = getComputedStyle(document.documentElement);
  const wave = css.getPropertyValue('--flame').trim() || '#EE3B12';
  const dim = css.getPropertyValue('--ink-3').trim() || '#8A867C';

  g.fillStyle = dim;
  const n = d.peaks.length;
  const bw = WAVE_W / n;
  for (let i = 0; i < n; i++) {
    const h = Math.max(1, Math.pow(d.peaks[i], 0.7) * WAVE_H * 0.92);
    g.fillRect(i * bw, (WAVE_H - h) / 2, Math.max(1, bw - 0.5), h);
  }

  // ビートグリッド。4拍ごと(小節の頭)を濃く出す
  if (d.bpm && d.el.duration && isFinite(d.el.duration)) {
    const b = 60 / d.bpm;
    let k = 0;
    for (let t = d.beatOffset; t < d.el.duration; t += b, k++) {
      const x = (t / d.el.duration) * WAVE_W;
      g.fillStyle = k % 4 === 0 ? wave : 'rgba(128,128,128,0.45)';
      g.fillRect(x, k % 4 === 0 ? 0 : WAVE_H * 0.36, 1, k % 4 === 0 ? WAVE_H : WAVE_H * 0.28);
    }
  }
  return c;
}

function drawWave(d) {
  const canvas = d.q('.deck-wave');
  const g = canvas.getContext('2d');
  const dur = d.el.duration;
  g.clearRect(0, 0, WAVE_W, WAVE_H);
  if (!d.waveImg || !dur || !isFinite(dur)) {
    g.fillStyle = 'rgba(128,128,128,0.25)';
    g.fillRect(0, WAVE_H / 2 - 1, WAVE_W, 2);
    return;
  }
  g.drawImage(d.waveImg, 0, 0);

  const css = getComputedStyle(document.documentElement);
  const flame = css.getPropertyValue('--flame').trim() || '#EE3B12';
  const x = (d.el.currentTime / dur) * WAVE_W;

  // 再生済みを暗く落とす
  g.fillStyle = 'rgba(0,0,0,0.45)';
  g.fillRect(0, 0, x, WAVE_H);

  if (d.loop) {
    g.fillStyle = 'rgba(245,180,21,0.22)';
    const a = (d.loop.start / dur) * WAVE_W;
    g.fillRect(a, 0, ((d.loop.end - d.loop.start) / dur) * WAVE_W, WAVE_H);
  }
  g.fillStyle = '#F5B415';
  d.hot.forEach((t) => {
    if (t == null) return;
    g.fillRect((t / dur) * WAVE_W - 1, 0, 3, WAVE_H);
  });
  g.fillStyle = '#7B1F42';
  g.fillRect((d.cue / dur) * WAVE_W - 1, 0, 2, WAVE_H);

  g.fillStyle = flame;
  g.fillRect(x - 1.5, 0, 3, WAVE_H);
}

// ---------- 毎フレームの処理 ----------

function fmt(s) {
  if (!isFinite(s) || s < 0) s = 0;
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

function tickDeck(d) {
  if (d.loop && d.el.currentTime >= d.loop.end) d.el.currentTime = d.loop.start;
  drawWave(d);
  d.q('.deck-time').textContent = `${fmt(d.el.currentTime)} / ${fmt(d.el.duration)}`;
  const playing = !d.el.paused;
  d.node.classList.toggle('playing', playing);
  d.q('.deck-play .k-ico').textContent = playing ? '❚❚' : '▶';
  d.q('.deck-play .k-label').textContent = playing ? 'PAUSE' : 'PLAY';
}

function tickMeter(self) {
  self.meter.getByteTimeDomainData(self.meterData);
  let sum = 0;
  for (let i = 0; i < self.meterData.length; i++) {
    const v = (self.meterData[i] - 128) / 128;
    sum += v * v;
  }
  const level = clamp(Math.sqrt(sum / self.meterData.length) * 3.2, 0, 1);
  $('djMeter').style.setProperty('--lv', `${(level * 100).toFixed(1)}%`);
}

/** 再生中のデッキが終わりに近づいたら、もう片方を出しながらつまみを送る */
function tickAutoMix(self) {
  if (!self.autoMix) return;
  const [a, b] = self.decks;

  // つなぎの最中。経過時間でつまみを送る(残り時間から逆算すると、
  // 尾が短い曲で一瞬にして渡り切ってしまう)
  if (self.autoMixing) {
    const m = self.autoMixing;
    const p = clamp((performance.now() - m.t0) / m.ms, 0, 1);
    // 今つまみがある所から動かす。端に飛ばしてから送ると音が途切れる
    $('xfader').value = String((m.x0 + ((m.toB ? 1 : 0) - m.x0) * p) * 100);
    applyCrossfade(self);
    if (p >= 1) {
      m.from.el.pause();
      self.autoMixing = null;
      // 渡した直後にまた反応して往復しないよう、少し置く
      self.autoMixReadyAt = performance.now() + 4000;
    }
    return;
  }

  if (performance.now() < self.autoMixReadyAt) return;
  const from = !a.el.paused && a.track ? a : (!b.el.paused && b.track ? b : null);
  if (!from) return;
  const to = from === a ? b : a;
  if (!to.track || !to.el.paused) return;

  const dur = from.el.duration;
  if (!isFinite(dur) || dur <= 0) return;
  // 尾に24秒も無い短い曲では、曲の長さに合わせて詰める
  const tail = Math.min(AUTOMIX_TAIL, dur * 0.4);
  const fade = Math.min(AUTOMIX_TIME, tail);
  if (dur - from.el.currentTime > tail || from.el.currentTime < fade) return;

  to.el.currentTime = to.cue;
  playDeck(to);
  if (to.bpm && from.bpm) sync(to);
  self.autoMixing = {
    from, toB: to === b, t0: performance.now(), ms: fade * 1000,
    x0: Number($('xfader').value) / 100,
  };
}

// ---------- ミキサー ----------

function applyCrossfade(self) {
  const x = Number($('xfader').value) / 100;
  let ga;
  let gb;
  if (self.xfCurve === 'sharp') {
    ga = clamp(1 - Math.max(0, x - 0.45) / 0.1, 0, 1);
    gb = clamp(1 - Math.max(0, 0.55 - x) / 0.1, 0, 1);
  } else {
    // 等パワー。中央で音量が落ち込まない、いちばん普通のカーブ
    ga = Math.cos((x * Math.PI) / 2);
    gb = Math.sin((x * Math.PI) / 2);
  }
  self.decks[0].xfGain.gain.value = ga;
  self.decks[1].xfGain.gain.value = gb;
}

// ---------- 配線 ----------

function hold(btn, down, up) {
  btn.addEventListener('pointerdown', (e) => { e.preventDefault(); btn.setPointerCapture?.(e.pointerId); down(); });
  btn.addEventListener('pointerup', up);
  btn.addEventListener('pointercancel', up);
  btn.addEventListener('lostpointercapture', up);
}

function wireDeck(d) {
  d.q('.deck-load').onclick = () => openPicker(d);
  d.q('.deck-play').onclick = () => togglePlay(d);
  hold(d.q('.deck-cue'), () => cueDown(d), () => cueUp(d));
  d.q('.deck-sync').onclick = () => sync(d);
  hold(d.q('.deck-bend-back'), () => { d.bend = -BEND_AMOUNT; applyRate(d); }, () => { d.bend = 0; applyRate(d); });
  hold(d.q('.deck-bend-fwd'), () => { d.bend = BEND_AMOUNT; applyRate(d); }, () => { d.bend = 0; applyRate(d); });

  d.q('.bpm-half').onclick = () => scaleBpm(d, 0.5);
  d.q('.bpm-double').onclick = () => scaleBpm(d, 2);
  d.q('.bpm-tap').onclick = () => tapTempo(d);

  d.node.querySelectorAll('.pad.hot').forEach((p) => {
    const i = Number(p.dataset.i);
    let held = 0;
    p.addEventListener('pointerdown', () => { held = setTimeout(() => { held = 0; clearHot(d, i); }, 600); });
    const cancel = () => { if (held) { clearTimeout(held); held = 0; hitHot(d, i); } };
    p.addEventListener('pointerup', cancel);
    p.addEventListener('pointercancel', () => { clearTimeout(held); held = 0; });
  });
  d.node.querySelectorAll('.pad.loop').forEach((p) => {
    p.onclick = () => setLoop(d, Number(p.dataset.beats));
  });

  const tempo = d.q('.tempo');
  tempo.oninput = () => { d.tempo = Number(tempo.value); releaseSync(d); applyRate(d); };
  d.q('.keylock').onclick = (e) => {
    d.el.preservesPitch = !d.el.preservesPitch;
    e.currentTarget.classList.toggle('on', d.el.preservesPitch);
  };

  // つまみは二度押しで中央(素通し)に戻す。実機のノブを戻す感覚に近づける
  for (const [sel, band] of [['.eq-hi', 'hi'], ['.eq-mid', 'mid'], ['.eq-low', 'low']]) {
    const r = d.q(sel);
    r.oninput = () => setEq(d, band, Number(r.value));
    r.ondblclick = () => { r.value = '0'; setEq(d, band, 0); };
  }
  const flt = d.q('.filter');
  flt.oninput = () => setFilter(d, Number(flt.value));
  flt.ondblclick = () => { flt.value = '0'; setFilter(d, 0); };

  d.q('.deck-wave').onclick = (e) => {
    if (!d.el.duration || !isFinite(d.el.duration)) return;
    const rect = e.currentTarget.getBoundingClientRect();
    d.el.currentTime = ((e.clientX - rect.left) / rect.width) * d.el.duration;
    d.loop = null;
    paintPads(d);
  };

  d.el.addEventListener('loadedmetadata', () => { if (d.peaks) d.waveImg = renderWave(d); });
  d.el.addEventListener('ended', () => { d.node.classList.remove('playing'); });
}

function wireMixer(self) {
  const bind = (id, fn) => { const el = $(id); el.oninput = fn; fn(); };
  bind('chA', () => { self.decks[0].chGain.gain.value = Number($('chA').value) / 100; });
  bind('chB', () => { self.decks[1].chGain.gain.value = Number($('chB').value) / 100; });
  bind('masterVol', () => { self.master.gain.value = Number($('masterVol').value) / 100; });
  bind('xfader', () => applyCrossfade(self));

  $('xfCurve').onclick = (e) => {
    self.xfCurve = self.xfCurve === 'smooth' ? 'sharp' : 'smooth';
    e.currentTarget.textContent = self.xfCurve === 'smooth' ? 'SMOOTH' : 'SHARP';
    applyCrossfade(self);
  };
  $('autoMixBtn').onclick = (e) => {
    self.autoMix = !self.autoMix;
    self.autoMixing = null;
    self.autoMixReadyAt = 0;
    e.currentTarget.classList.toggle('on', self.autoMix);
    self.toast(self.autoMix ? 'オートミックス ON' : 'オートミックス OFF');
  };
  $('djCloseBtn').onclick = () => closeDJ();
}

// ---------- 曲を選ぶ ----------

let pickTarget = null;

function openPicker(d) {
  pickTarget = d;
  $('djPickDeck').textContent = d.id;
  $('djPickSearch').value = '';
  fillPicker(d.dj, '');
  $('djPickDialog').showModal();
}

function fillPicker(self, query) {
  const list = $('djPickList');
  list.innerHTML = '';
  const q = query.trim().toLowerCase();
  const tracks = self.getTracks().filter((t) => !q
    || t.title.toLowerCase().includes(q)
    || t.artist.toLowerCase().includes(q)
    || t.album.toLowerCase().includes(q));

  if (tracks.length === 0) {
    const p = document.createElement('p');
    p.className = 'empty-note';
    p.textContent = self.getTracks().length === 0
      ? '先に曲を読み込んでください'
      : '見つかりませんでした';
    list.appendChild(p);
    return;
  }
  for (const t of tracks.slice(0, 300)) {
    const row = document.createElement('button');
    row.className = 'dj-pick-row';
    row.innerHTML = '<span class="p-title"></span><span class="p-sub"></span>';
    row.querySelector('.p-title').textContent = t.title;
    row.querySelector('.p-sub').textContent = `${t.artist} — ${t.album}`;
    row.onclick = () => {
      $('djPickDialog').close();
      loadTrack(pickTarget, t);
    };
    list.appendChild(row);
  }
}

function wirePicker(self) {
  $('djPickSearch').oninput = (e) => fillPicker(self, e.target.value);
  $('djPickCancel').onclick = () => $('djPickDialog').close();
}

// ---------- ミックスの録音 ----------

function wireRecorder(self) {
  const btn = $('djRecBtn');
  let rec = null;
  let chunks = [];

  btn.onclick = () => {
    if (rec && rec.state === 'recording') { rec.stop(); return; }
    if (typeof MediaRecorder === 'undefined') {
      self.toast('この環境では録音に対応していません');
      return;
    }
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
      .find((m) => MediaRecorder.isTypeSupported?.(m)) ?? '';
    try {
      rec = new MediaRecorder(self.recDest.stream, mime ? { mimeType: mime } : undefined);
    } catch {
      self.toast('この環境では録音に対応していません');
      return;
    }
    chunks = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    rec.onstop = () => {
      btn.classList.remove('on');
      btn.textContent = 'REC';
      offerMix(self, new Blob(chunks, { type: rec.mimeType || 'audio/webm' }));
    };
    rec.start();
    btn.classList.add('on');
    btn.textContent = '■ STOP';
    self.toast('ミックスの録音を始めました');
  };

  $('djMixCloseBtn').onclick = () => $('djMixDialog').close();
}

let mixUrl = null;

function offerMix(self, blob) {
  if (blob.size === 0) { self.toast('録音できませんでした'); return; }
  if (mixUrl) URL.revokeObjectURL(mixUrl);
  mixUrl = URL.createObjectURL(blob);

  const ext = blob.type.includes('mp4') ? 'm4a' : 'webm';
  const name = `dj-mix-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '')}.${ext}`;
  $('djMixAudio').src = mixUrl;
  $('djMixSize').textContent = blob.size >= 1048576
    ? `${(blob.size / 1048576).toFixed(1)} MB`
    : `${Math.max(1, Math.round(blob.size / 1024))} KB`;

  const native = window.AndroidLibrary;
  const saveBtn = $('djMixSaveBtn');
  saveBtn.textContent = native?.shareFile ? '共有 / 保存' : '保存';
  saveBtn.onclick = async () => {
    if (native?.shareFile) {
      const dataUrl = await new Promise((res) => {
        const r = new FileReader();
        r.onload = () => res(r.result);
        r.readAsDataURL(blob);
      });
      native.shareFile(dataUrl, blob.type, name, 'DJミックス');
      return;
    }
    const file = new File([blob], name, { type: blob.type });
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title: 'DJミックス' }); return; } catch { /* 下の保存に回す */ }
    }
    const a = document.createElement('a');
    a.href = mixUrl;
    a.download = name;
    a.click();
  };
  $('djMixDialog').showModal();
}
