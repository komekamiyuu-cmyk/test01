/* ============================================================
   かんたんDAW - 初心者向けブラウザDAW
   Web Audio API のみで動作(外部ライブラリ不要)
   Windows / Android のモダンブラウザ対応
   ============================================================ */
'use strict';

/* ---------------- 定数定義 ---------------- */

const MAX_STEPS = 32;
const NOTE_NAMES = ['ド', 'ド♯', 'レ', 'レ♯', 'ミ', 'ファ', 'ファ♯', 'ソ', 'ソ♯', 'ラ', 'ラ♯', 'シ'];
const KEY_NAMES  = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

// スケール(使ってよい音)。初心者が音を外さないための仕組み
const SCALES = {
  penta: [0, 2, 4, 7, 9],           // メジャーペンタトニック
  major: [0, 2, 4, 5, 7, 9, 11],    // メジャー
  minor: [0, 2, 3, 5, 7, 8, 10],    // ナチュラルマイナー
};

// コードトラックで使う4つのコード(ポップスの定番進行が作れる組み合わせ)
const CHORD_SETS = {
  major: [
    { deg: 0,  minor: false, offsets: [0, 4, 7] },    // I
    { deg: 7,  minor: false, offsets: [7, 11, 14] },  // V
    { deg: 9,  minor: true,  offsets: [9, 12, 16] },  // vi
    { deg: 5,  minor: false, offsets: [5, 9, 12] },   // IV
  ],
  minor: [
    { deg: 0,  minor: true,  offsets: [0, 3, 7] },    // i
    { deg: 8,  minor: false, offsets: [8, 12, 15] },  // ♭VI
    { deg: 3,  minor: false, offsets: [3, 7, 10] },   // ♭III
    { deg: 10, minor: false, offsets: [10, 14, 17] }, // ♭VII
  ],
};

// ドラムの行(上から順に表示)
const DRUM_ROWS = [
  { id: 'ohat',  name: 'シャーン' },
  { id: 'hat',   name: 'チッ' },
  { id: 'clap',  name: 'パン(手拍子)' },
  { id: 'snare', name: 'タン(スネア)' },
  { id: 'kick',  name: 'ドン(キック)' },
];

// メロディの音色
const INSTRUMENTS = {
  soft:  { label: 'やさしい音' },
  synth: { label: 'シンセ' },
  pico:  { label: 'ピコピコ' },
};

const MELODY_OCTAVES = 2;  // メロディは2オクターブ
const MELODY_ROW_MAX = 15; // メジャー2オクターブ+1音ぶんの保存領域
const BASS_ROW_MAX   = 8;  // ベースは1オクターブ+1音

const TRACKS = [
  { id: 'drums',  name: 'ドラム',  color: 'var(--c-drums)',  hint: 'リズムの土台。まずは「ドン」と「チッ」を置いてみよう' },
  { id: 'chords', name: 'コード',  color: 'var(--c-chords)', hint: '曲の雰囲気をつくる和音。4マスごとに置くのがおすすめ' },
  { id: 'bass',   name: 'ベース',  color: 'var(--c-bass)',   hint: '低い音で曲を支えます。コードと同じタイミングが合いやすい' },
  { id: 'melody', name: 'メロディ', color: 'var(--c-melody)', hint: '主役のメロディ。自由に置いてOK、どの音もキレイに響きます' },
];

const SAVE_KEY = 'kantan-daw-song-v1';
const HELP_KEY = 'kantan-daw-help-shown';

/* ---------------- 曲データ ---------------- */

function makeGrid(rows, cols) {
  return Array.from({ length: rows }, () => new Array(cols).fill(false));
}

function defaultState() {
  return {
    bpm: 110,
    steps: 16,
    key: 0,          // 0 = C
    scale: 'penta',
    tracks: {
      drums:  { grid: makeGrid(DRUM_ROWS.length, MAX_STEPS), vol: 0.9,  mute: false },
      chords: { grid: makeGrid(4, MAX_STEPS),                vol: 0.7,  mute: false },
      bass:   { grid: makeGrid(BASS_ROW_MAX, MAX_STEPS),     vol: 0.85, mute: false },
      melody: { grid: makeGrid(MELODY_ROW_MAX, MAX_STEPS),   vol: 0.8,  mute: false, inst: 'soft' },
    },
  };
}

let state = defaultState();
let activeTrackId = 'drums';

/* ---------------- 保存と読み込み ---------------- */

let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch (e) { /* 容量超過などは無視 */ }
  }, 300);
}

function loadSaved() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    applyImportedState(data);
  } catch (e) { /* 壊れた保存データは無視して初期状態で開始 */ }
}

function applyImportedState(data) {
  const fresh = defaultState();
  if (!data || typeof data !== 'object' || !data.tracks) throw new Error('形式が違います');
  fresh.bpm   = clamp(Number(data.bpm) || 110, 60, 180);
  fresh.steps = data.steps === 32 ? 32 : 16;
  fresh.key   = clamp(Number(data.key) || 0, 0, 11);
  fresh.scale = SCALES[data.scale] ? data.scale : 'penta';
  for (const t of TRACKS) {
    const src = data.tracks[t.id];
    const dst = fresh.tracks[t.id];
    if (!src) continue;
    dst.vol  = clamp(Number(src.vol), 0, 1);
    if (Number.isNaN(dst.vol)) dst.vol = 0.8;
    dst.mute = !!src.mute;
    if (t.id === 'melody') dst.inst = INSTRUMENTS[src.inst] ? src.inst : 'soft';
    if (Array.isArray(src.grid)) {
      for (let r = 0; r < dst.grid.length; r++) {
        if (!Array.isArray(src.grid[r])) continue;
        for (let c = 0; c < MAX_STEPS; c++) dst.grid[r][c] = !!src.grid[r][c];
      }
    }
  }
  state = fresh;
}

function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

/* ---------------- 音階の計算 ---------------- */

// スケール上のn番目の音(度数)→ 半音数
function scaleOffset(scaleName, degree) {
  const s = SCALES[scaleName];
  const oct = Math.floor(degree / s.length);
  return oct * 12 + s[degree % s.length];
}

function midiToFreq(m) { return 440 * Math.pow(2, (m - 69) / 12); }

// メロディの行(上が高い音)→ MIDIノート番号
function melodyRows() {
  const s = SCALES[state.scale];
  const count = s.length * MELODY_OCTAVES + 1;
  const rows = [];
  for (let i = count - 1; i >= 0; i--) {
    const midi = 60 + state.key + scaleOffset(state.scale, i); // C4基準
    rows.push({ midi, label: NOTE_NAMES[midi % 12], strong: i % s.length === 0 });
  }
  return rows;
}

// ベースの行(1オクターブ+ルート)
function bassRows() {
  const s = SCALES[state.scale];
  const count = s.length + 1;
  const rows = [];
  for (let i = count - 1; i >= 0; i--) {
    const midi = 36 + state.key + scaleOffset(state.scale, i); // C2基準
    rows.push({ midi, label: NOTE_NAMES[midi % 12], strong: i % s.length === 0 });
  }
  return rows;
}

// コードの行(名前つき)
function chordRows() {
  const set = CHORD_SETS[state.scale === 'minor' ? 'minor' : 'major'];
  return set.map(ch => ({
    offsets: ch.offsets,
    label: KEY_NAMES[(state.key + ch.deg) % 12] + (ch.minor ? 'm' : ''),
  }));
}

/* ============================================================
   音声エンジン(Web Audio API)
   すべての発音関数は ctx と出力先を受け取る作りにして、
   リアルタイム再生と WAV 書き出し(オフライン描画)で共用する
   ============================================================ */

let audioCtx = null;
let liveBus = null; // { master, tracks: {id: GainNode} }

function ensureAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    liveBus = createBus(audioCtx);
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

// マスター(コンプレッサーで音割れ防止)+ トラックごとの音量
function createBus(ctx) {
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.ratio.value = 6;
  const master = ctx.createGain();
  master.gain.value = 0.9;
  master.connect(comp);
  comp.connect(ctx.destination);

  const tracks = {};
  for (const t of TRACKS) {
    const g = ctx.createGain();
    g.connect(master);
    tracks[t.id] = g;
  }
  return { master, tracks };
}

function syncBusVolumes(bus) {
  for (const t of TRACKS) {
    const tr = state.tracks[t.id];
    bus.tracks[t.id].gain.value = tr.mute ? 0 : tr.vol;
  }
}

/* ---- ドラム音(すべてシンセ合成、音源ファイル不要) ---- */

function noiseBuffer(ctx) {
  if (!ctx.__noise) {
    const len = Math.floor(ctx.sampleRate * 0.5);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    ctx.__noise = buf;
  }
  return ctx.__noise;
}

function playKick(ctx, dest, t) {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.frequency.setValueAtTime(150, t);
  osc.frequency.exponentialRampToValueAtTime(40, t + 0.12);
  g.gain.setValueAtTime(1.0, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
  osc.connect(g).connect(dest);
  osc.start(t);
  osc.stop(t + 0.3);
}

function playSnare(ctx, dest, t) {
  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuffer(ctx);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 1800;
  bp.Q.value = 0.8;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(0.7, t);
  ng.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
  noise.connect(bp).connect(ng).connect(dest);
  noise.start(t);
  noise.stop(t + 0.2);

  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.value = 190;
  const og = ctx.createGain();
  og.gain.setValueAtTime(0.5, t);
  og.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
  osc.connect(og).connect(dest);
  osc.start(t);
  osc.stop(t + 0.1);
}

function playHat(ctx, dest, t, open) {
  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuffer(ctx);
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 7500;
  const g = ctx.createGain();
  const dur = open ? 0.35 : 0.06;
  g.gain.setValueAtTime(open ? 0.4 : 0.5, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  noise.connect(hp).connect(g).connect(dest);
  noise.start(t);
  noise.stop(t + dur + 0.02);
}

function playClap(ctx, dest, t) {
  // 短いノイズを3連発して「パンッ」という手拍子感を出す
  for (let i = 0; i < 3; i++) {
    const tt = t + i * 0.012;
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer(ctx);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1200;
    bp.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(i === 2 ? 0.6 : 0.3, tt);
    g.gain.exponentialRampToValueAtTime(0.001, tt + (i === 2 ? 0.16 : 0.03));
    noise.connect(bp).connect(g).connect(dest);
    noise.start(tt);
    noise.stop(tt + 0.2);
  }
}

const DRUM_PLAYERS = {
  kick:  (ctx, dest, t) => playKick(ctx, dest, t),
  snare: (ctx, dest, t) => playSnare(ctx, dest, t),
  hat:   (ctx, dest, t) => playHat(ctx, dest, t, false),
  ohat:  (ctx, dest, t) => playHat(ctx, dest, t, true),
  clap:  (ctx, dest, t) => playClap(ctx, dest, t),
};

/* ---- 音程のある音(メロディ・ベース・コード) ---- */

function playMelodyNote(ctx, dest, freq, t, dur, inst) {
  const osc = ctx.createOscillator();
  const filter = ctx.createBiquadFilter();
  const g = ctx.createGain();
  filter.type = 'lowpass';

  if (inst === 'synth') {
    osc.type = 'sawtooth';
    filter.frequency.setValueAtTime(3500, t);
    filter.frequency.exponentialRampToValueAtTime(700, t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.35, t + 0.01);
    g.gain.setTargetAtTime(0.0001, t + dur, 0.05);
  } else if (inst === 'pico') {
    osc.type = 'square';
    filter.frequency.value = 3200;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.22, t + 0.005);
    g.gain.setValueAtTime(0.22, t + dur * 0.7);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
  } else { // soft
    osc.type = 'triangle';
    filter.frequency.value = 2400;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.4, t + 0.02);
    g.gain.setTargetAtTime(0.0001, t + dur * 0.8, 0.08);
  }

  osc.frequency.value = freq;
  osc.connect(filter).connect(g).connect(dest);
  osc.start(t);
  osc.stop(t + dur + 0.4);
}

function playBassNote(ctx, dest, freq, t, dur) {
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.value = freq;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(900, t);
  filter.frequency.exponentialRampToValueAtTime(280, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.5, t + 0.01);
  g.gain.setTargetAtTime(0.0001, t + dur * 0.9, 0.04);
  osc.connect(filter).connect(g).connect(dest);
  osc.start(t);
  osc.stop(t + dur + 0.3);
}

function playChord(ctx, dest, offsets, t, dur) {
  for (const off of offsets) {
    const midi = 48 + state.key + off; // C3基準
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = midiToFreq(midi);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1800;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.16, t + 0.03);
    g.gain.setTargetAtTime(0.0001, t + dur * 0.85, 0.1);
    osc.connect(filter).connect(g).connect(dest);
    osc.start(t);
    osc.stop(t + dur + 0.5);
  }
}

/* ---- 1ステップ分の発音(再生・書き出し共用) ---- */

function scheduleStepSounds(ctx, bus, step, time, stepDur) {
  // ドラム
  const drums = state.tracks.drums;
  DRUM_ROWS.forEach((row, r) => {
    if (drums.grid[r][step]) DRUM_PLAYERS[row.id](ctx, bus.tracks.drums, time);
  });

  // コード(2ステップぶん伸ばす)
  const chords = state.tracks.chords;
  chordRows().forEach((row, r) => {
    if (chords.grid[r][step]) playChord(ctx, bus.tracks.chords, row.offsets, time, stepDur * 2);
  });

  // ベース
  const bass = state.tracks.bass;
  bassRows().forEach((row, r) => {
    if (bass.grid[r][step]) playBassNote(ctx, bus.tracks.bass, midiToFreq(row.midi), time, stepDur * 0.9);
  });

  // メロディ
  const melody = state.tracks.melody;
  melodyRows().forEach((row, r) => {
    if (melody.grid[r][step]) playMelodyNote(ctx, bus.tracks.melody, midiToFreq(row.midi), time, stepDur * 0.9, melody.inst);
  });
}

/* ---------------- 再生スケジューラー ---------------- */

let isPlaying = false;
let currentStep = 0;
let nextNoteTime = 0;
let schedulerTimer = null;
let notesInQueue = [];
let lastDrawnStep = -1;

const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD = 0.12;

function stepDuration() { return (60 / state.bpm) / 4; } // 16分音符

function schedulerTick() {
  const ctx = audioCtx;
  while (nextNoteTime < ctx.currentTime + SCHEDULE_AHEAD) {
    syncBusVolumes(liveBus);
    scheduleStepSounds(ctx, liveBus, currentStep, nextNoteTime, stepDuration());
    notesInQueue.push({ step: currentStep, time: nextNoteTime });
    nextNoteTime += stepDuration();
    currentStep = (currentStep + 1) % state.steps;
  }
}

function drawLoop() {
  if (!isPlaying) return;
  const now = audioCtx.currentTime;
  let step = lastDrawnStep;
  while (notesInQueue.length && notesInQueue[0].time <= now) {
    step = notesInQueue.shift().step;
  }
  if (step !== lastDrawnStep) {
    highlightStep(step);
    lastDrawnStep = step;
  }
  requestAnimationFrame(drawLoop);
}

function startPlayback() {
  const ctx = ensureAudio();
  syncBusVolumes(liveBus);
  isPlaying = true;
  currentStep = 0;
  nextNoteTime = ctx.currentTime + 0.06;
  notesInQueue = [];
  lastDrawnStep = -1;
  schedulerTimer = setInterval(schedulerTick, LOOKAHEAD_MS);
  requestAnimationFrame(drawLoop);
  els.playBtn.textContent = '■ 停止';
  els.playBtn.classList.add('playing');
}

function stopPlayback() {
  isPlaying = false;
  clearInterval(schedulerTimer);
  notesInQueue = [];
  highlightStep(-1);
  lastDrawnStep = -1;
  els.playBtn.textContent = '▶ 再生';
  els.playBtn.classList.remove('playing');
}

/* ---------------- UI 構築 ---------------- */

const els = {
  playBtn: document.getElementById('playBtn'),
  bpmSlider: document.getElementById('bpmSlider'),
  bpmValue: document.getElementById('bpmValue'),
  demoBtn: document.getElementById('demoBtn'),
  helpBtn: document.getElementById('helpBtn'),
  helpDialog: document.getElementById('helpDialog'),
  helpCloseBtn: document.getElementById('helpCloseBtn'),
  trackTabs: document.getElementById('trackTabs'),
  trackHint: document.getElementById('trackHint'),
  instLabel: document.getElementById('instLabel'),
  instSelect: document.getElementById('instSelect'),
  volSlider: document.getElementById('volSlider'),
  muteBtn: document.getElementById('muteBtn'),
  clearTrackBtn: document.getElementById('clearTrackBtn'),
  grid: document.getElementById('grid'),
  keySelect: document.getElementById('keySelect'),
  scaleSelect: document.getElementById('scaleSelect'),
  lenSelect: document.getElementById('lenSelect'),
  wavBtn: document.getElementById('wavBtn'),
  exportBtn: document.getElementById('exportBtn'),
  importBtn: document.getElementById('importBtn'),
  importFile: document.getElementById('importFile'),
  clearAllBtn: document.getElementById('clearAllBtn'),
};

// 表示中トラックの行定義を取得
function rowsForTrack(trackId) {
  switch (trackId) {
    case 'drums':  return DRUM_ROWS.map(r => ({ label: r.name, strong: r.id === 'kick' }));
    case 'chords': return chordRows().map(r => ({ label: r.label, strong: true }));
    case 'bass':   return bassRows();
    case 'melody': return melodyRows();
  }
}

// グリッド行番号 → 保存データの行番号
// (メロディ・ベースは表示が上下逆&スケールで行数が変わるため変換する)
function dataRowIndex(trackId, uiRow, rowCount) {
  if (trackId === 'drums' || trackId === 'chords') return uiRow;
  return rowCount - 1 - uiRow; // 下の行ほど低い音 = データは度数順
}

let columnCells = []; // 再生ハイライト用: columnCells[step] = [セル要素...]

function renderGrid() {
  const trackId = activeTrackId;
  const track = TRACKS.find(t => t.id === trackId);
  const rows = rowsForTrack(trackId);
  const steps = state.steps;
  const grid = els.grid;

  grid.innerHTML = '';
  grid.style.gridTemplateColumns = `var(--label-w) repeat(${steps}, var(--cell-size))`;
  columnCells = Array.from({ length: steps }, () => []);

  // 上段: 拍の目盛り(1・2・3・4)
  const corner = document.createElement('div');
  corner.className = 'row-label';
  grid.appendChild(corner);
  for (let s = 0; s < steps; s++) {
    const c = document.createElement('div');
    c.className = 'ruler-cell' + (s % 4 === 0 ? ' beat' : '');
    c.textContent = s % 4 === 0 ? String(s / 4 + 1) : '・';
    c.dataset.rulerStep = s;
    grid.appendChild(c);
    columnCells[s].push(c);
  }

  // 各行
  rows.forEach((row, uiRow) => {
    const label = document.createElement('div');
    label.className = 'row-label' + (row.strong ? ' strong' : '');
    label.textContent = row.label;
    grid.appendChild(label);

    const dataRow = dataRowIndex(trackId, uiRow, rows.length);
    for (let s = 0; s < steps; s++) {
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'cell' + (Math.floor(s / 4) % 2 === 0 ? '' : ' beat');
      cell.style.setProperty('--row-color', track.color);
      cell.dataset.row = dataRow;
      cell.dataset.step = s;
      if (state.tracks[trackId].grid[dataRow][s]) cell.classList.add('on');
      grid.appendChild(cell);
      columnCells[s].push(cell);
    }
  });
}

function highlightStep(step) {
  const prev = els.grid.querySelectorAll('.playing');
  prev.forEach(el => el.classList.remove('playing'));
  if (step >= 0 && columnCells[step]) {
    columnCells[step].forEach(el => el.classList.add('playing'));
  }
}

/* ---- グリッドのタップ&なぞり入力 ---- */

let painting = false;
let paintValue = true;
let paintedCells = new Set();

function applyPaint(cell) {
  if (!cell || !cell.classList.contains('cell')) return;
  const key = cell.dataset.row + ':' + cell.dataset.step;
  if (paintedCells.has(key)) return;
  paintedCells.add(key);

  const row = Number(cell.dataset.row);
  const step = Number(cell.dataset.step);
  const grid = state.tracks[activeTrackId].grid;
  if (grid[row][step] === paintValue) return;
  grid[row][step] = paintValue;
  cell.classList.toggle('on', paintValue);
  scheduleSave();

  // 置いた瞬間に音を鳴らして確認できるようにする(初心者向けフィードバック)
  if (paintValue) previewCell(row, step);
}

function previewCell(dataRow) {
  const ctx = ensureAudio();
  syncBusVolumes(liveBus);
  const t = ctx.currentTime + 0.01;
  const dur = stepDuration() * 2;
  if (activeTrackId === 'drums') {
    DRUM_PLAYERS[DRUM_ROWS[dataRow].id](ctx, liveBus.tracks.drums, t);
  } else if (activeTrackId === 'chords') {
    const row = chordRows()[dataRow];
    if (row) playChord(ctx, liveBus.tracks.chords, row.offsets, t, dur);
  } else if (activeTrackId === 'bass') {
    const rows = bassRows();
    const row = rows[rows.length - 1 - dataRow];
    if (row) playBassNote(ctx, liveBus.tracks.bass, midiToFreq(row.midi), t, dur * 0.6);
  } else {
    const rows = melodyRows();
    const row = rows[rows.length - 1 - dataRow];
    if (row) playMelodyNote(ctx, liveBus.tracks.melody, midiToFreq(row.midi), t, dur * 0.6, state.tracks.melody.inst);
  }
}

els.grid.addEventListener('pointerdown', (e) => {
  const cell = e.target.closest('.cell');
  if (!cell) return;
  e.preventDefault();
  painting = true;
  paintedCells = new Set();
  const row = Number(cell.dataset.row);
  const step = Number(cell.dataset.step);
  paintValue = !state.tracks[activeTrackId].grid[row][step];
  applyPaint(cell);
});

els.grid.addEventListener('pointermove', (e) => {
  if (!painting) return;
  e.preventDefault();
  const el = document.elementFromPoint(e.clientX, e.clientY);
  if (el) applyPaint(el.closest('.cell'));
});

window.addEventListener('pointerup', () => { painting = false; });
window.addEventListener('pointercancel', () => { painting = false; });
// なぞり入力中はスクロールさせない
els.grid.addEventListener('touchmove', (e) => { if (painting) e.preventDefault(); }, { passive: false });

/* ---- トラックタブ ---- */

function renderTabs() {
  els.trackTabs.innerHTML = '';
  for (const t of TRACKS) {
    const btn = document.createElement('button');
    btn.className = 'track-tab'
      + (t.id === activeTrackId ? ' active' : '')
      + (state.tracks[t.id].mute ? ' muted' : '');
    btn.style.setProperty('--tab-color', t.color);
    btn.innerHTML = `<span class="dot"></span>${t.name}`;
    btn.addEventListener('click', () => {
      activeTrackId = t.id;
      renderTabs();
      renderTrackControls();
      renderGrid();
    });
    els.trackTabs.appendChild(btn);
  }
}

function renderTrackControls() {
  const t = TRACKS.find(x => x.id === activeTrackId);
  const tr = state.tracks[activeTrackId];
  els.trackHint.textContent = t.hint;
  els.volSlider.value = Math.round(tr.vol * 100);
  els.muteBtn.textContent = tr.mute ? '🔇' : '🔊';

  const isMelody = activeTrackId === 'melody';
  els.instSelect.hidden = !isMelody;
  els.instLabel.hidden = !isMelody;
  if (isMelody) els.instSelect.value = tr.inst;
}

els.volSlider.addEventListener('input', () => {
  state.tracks[activeTrackId].vol = Number(els.volSlider.value) / 100;
  if (liveBus) syncBusVolumes(liveBus);
  scheduleSave();
});

els.muteBtn.addEventListener('click', () => {
  const tr = state.tracks[activeTrackId];
  tr.mute = !tr.mute;
  if (liveBus) syncBusVolumes(liveBus);
  renderTabs();
  renderTrackControls();
  scheduleSave();
});

els.clearTrackBtn.addEventListener('click', () => {
  const grid = state.tracks[activeTrackId].grid;
  for (const row of grid) row.fill(false);
  renderGrid();
  scheduleSave();
});

els.instSelect.addEventListener('change', () => {
  state.tracks.melody.inst = els.instSelect.value;
  scheduleSave();
});

/* ---- ヘッダー操作 ---- */

els.playBtn.addEventListener('click', () => {
  if (isPlaying) stopPlayback(); else startPlayback();
});

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && !['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(e.target.tagName)) {
    e.preventDefault();
    els.playBtn.click();
  }
});

els.bpmSlider.addEventListener('input', () => {
  state.bpm = Number(els.bpmSlider.value);
  els.bpmValue.textContent = state.bpm;
  scheduleSave();
});

/* ---- くわしい設定 ---- */

function initSelectors() {
  KEY_NAMES.forEach((name, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = name;
    els.keySelect.appendChild(opt);
  });
  for (const [id, inst] of Object.entries(INSTRUMENTS)) {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = inst.label;
    els.instSelect.appendChild(opt);
  }
}

function syncControlsFromState() {
  els.bpmSlider.value = state.bpm;
  els.bpmValue.textContent = state.bpm;
  els.keySelect.value = state.key;
  els.scaleSelect.value = state.scale;
  els.lenSelect.value = state.steps;
}

els.keySelect.addEventListener('change', () => {
  state.key = Number(els.keySelect.value);
  renderGrid();
  scheduleSave();
});

els.scaleSelect.addEventListener('change', () => {
  state.scale = els.scaleSelect.value;
  renderGrid();
  scheduleSave();
});

els.lenSelect.addEventListener('change', () => {
  state.steps = Number(els.lenSelect.value);
  if (currentStep >= state.steps) currentStep = 0;
  renderGrid();
  scheduleSave();
});

els.clearAllBtn.addEventListener('click', () => {
  if (!confirm('すべてのトラックの打ち込みを消します。よろしいですか?')) return;
  for (const t of TRACKS) {
    for (const row of state.tracks[t.id].grid) row.fill(false);
  }
  renderGrid();
  scheduleSave();
});

/* ---- 書き出し・読み込み ---- */

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

els.exportBtn.addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  downloadBlob(blob, 'kantan-daw-song.json');
});

els.importBtn.addEventListener('click', () => els.importFile.click());

els.importFile.addEventListener('change', async () => {
  const file = els.importFile.files[0];
  els.importFile.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    applyImportedState(data);
    refreshAllUI();
    scheduleSave();
  } catch (e) {
    alert('読み込めませんでした。かんたんDAWで書き出したファイルを選んでください。');
  }
});

/* ---- WAV 書き出し(オフラインレンダリング) ---- */

els.wavBtn.addEventListener('click', async () => {
  els.wavBtn.disabled = true;
  els.wavBtn.textContent = '🎛️ 作成中…';
  try {
    const loops = 2;
    const dur = stepDuration() * state.steps * loops + 1.2; // 余韻ぶん
    const sampleRate = 44100;
    const offline = new OfflineAudioContext(2, Math.ceil(sampleRate * dur), sampleRate);
    const bus = createBus(offline);
    syncBusVolumes(bus);
    let t = 0.05;
    for (let l = 0; l < loops; l++) {
      for (let s = 0; s < state.steps; s++) {
        scheduleStepSounds(offline, bus, s, t, stepDuration());
        t += stepDuration();
      }
    }
    const rendered = await offline.startRendering();
    downloadBlob(encodeWav(rendered), 'kantan-daw.wav');
  } catch (e) {
    alert('書き出しに失敗しました: ' + e.message);
  } finally {
    els.wavBtn.disabled = false;
    els.wavBtn.textContent = '💾 音声ファイル(WAV)で保存';
  }
});

// AudioBuffer → WAV (16bit PCM)
function encodeWav(buffer) {
  const numCh = buffer.numberOfChannels;
  const len = buffer.length;
  const rate = buffer.sampleRate;
  const bytesPerSample = 2;
  const dataSize = len * numCh * bytesPerSample;
  const ab = new ArrayBuffer(44 + dataSize);
  const view = new DataView(ab);

  const writeStr = (off, str) => { for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i)); };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numCh, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * numCh * bytesPerSample, true);
  view.setUint16(32, numCh * bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  const channels = [];
  for (let c = 0; c < numCh; c++) channels.push(buffer.getChannelData(c));
  let off = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < numCh; c++) {
      const v = Math.max(-1, Math.min(1, channels[c][i]));
      view.setInt16(off, v < 0 ? v * 0x8000 : v * 0x7fff, true);
      off += 2;
    }
  }
  return new Blob([ab], { type: 'audio/wav' });
}

/* ---- デモ曲 ---- */

function loadDemo() {
  const fresh = defaultState();
  fresh.bpm = 112;
  fresh.steps = 16;
  fresh.key = 0;
  fresh.scale = 'penta';
  const T = fresh.tracks;

  // ドラム: 王道の8ビート
  const set = (grid, row, steps) => { for (const s of steps) grid[row][s] = true; };
  set(T.drums.grid, 4, [0, 6, 8, 14]);                       // キック
  set(T.drums.grid, 3, [4, 12]);                             // スネア
  set(T.drums.grid, 1, [0, 2, 4, 6, 8, 10, 12, 14]);         // ハイハット
  set(T.drums.grid, 0, [15]);                                // オープン
  set(T.drums.grid, 2, [4, 12]);                             // クラップ

  // コード: I → vi → IV → V(4マスごと)
  T.chords.grid[0][0] = true;
  T.chords.grid[2][4] = true;
  T.chords.grid[3][8] = true;
  T.chords.grid[1][12] = true;

  // ベース: コードに合わせてルート弾き(ペンタ度数: 0=ド,1=レ,2=ミ,3=ソ,4=ラ)
  set(T.bass.grid, 0, [0, 3]);   // ド
  set(T.bass.grid, 4, [4, 7]);   // ラ
  set(T.bass.grid, 3, [8, 11]);  // (IVの代わりにソ→ペンタ内で相性良)
  set(T.bass.grid, 3, [12, 15]); // ソ

  // メロディ(ペンタ度数、0=ド4 … 5=ド5, 6=レ5, 7=ミ5)
  const mel = [[0, 5], [2, 7], [4, 6], [6, 5], [8, 3], [10, 4], [12, 5], [14, 2]];
  for (const [step, deg] of mel) T.melody.grid[deg][step] = true;

  state = fresh;
  refreshAllUI();
  scheduleSave();
  if (!isPlaying) startPlayback();
}

els.demoBtn.addEventListener('click', () => {
  ensureAudio();
  loadDemo();
});

/* ---- ヘルプ ---- */

els.helpBtn.addEventListener('click', () => els.helpDialog.showModal());
els.helpCloseBtn.addEventListener('click', () => {
  els.helpDialog.close();
  try { localStorage.setItem(HELP_KEY, '1'); } catch (e) {}
});

/* ---------------- 初期化 ---------------- */

function refreshAllUI() {
  syncControlsFromState();
  renderTabs();
  renderTrackControls();
  renderGrid();
}

initSelectors();
loadSaved();
refreshAllUI();

// はじめて開いたときだけ使い方を表示
try {
  if (!localStorage.getItem(HELP_KEY)) els.helpDialog.showModal();
} catch (e) {}
