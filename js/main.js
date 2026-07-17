/* ============================================================
   かんたんDAW エントリポイント
   各モジュール(曲データ・楽器・オーディオ・グリッド)を配線する。
   「どのモジュールが何を知っているか」はこのファイルだけが知っている。
   ============================================================ */

import { KEY_NAMES } from './config.js';
import { INSTRUMENTS } from './instruments/index.js';
import { defaultSong, songFromData, loadSong, scheduleSave } from './state.js';
import { createBus } from './audio/bus.js';
import { Transport } from './audio/scheduler.js';
import { encodeWav } from './audio/wav.js';
import { GridView } from './ui/grid.js';

const HELP_KEY = 'kantan-daw-help-shown';

/* ---------------- 曲データ ---------------- */

let song = loadSong(INSTRUMENTS) || defaultSong(INSTRUMENTS);
let activeTrackId = INSTRUMENTS[0].id;

const activeInst = () => INSTRUMENTS.find(i => i.id === activeTrackId);
const activeTrack = () => song.tracks[activeTrackId];

/* ---------------- オーディオ ---------------- */

let audioCtx = null;
let liveBus = null;

function ensureAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    liveBus = createBus(audioCtx, INSTRUMENTS, song);
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  liveBus.sync(song);
  return audioCtx;
}

/** 1ステップぶんの発音予約(再生・試聴・WAV書き出しの中核) */
function scheduleStepSounds(ctx, bus, step, time, stepDur) {
  for (const inst of INSTRUMENTS) {
    const tr = song.tracks[inst.id];
    for (let r = 0; r < inst.maxRows; r++) {
      if (tr.grid[r][step]) inst.noteOn(ctx, bus.channels[inst.id], r, time, stepDur, song, tr.params);
    }
  }
}

const transport = new Transport({
  getCtx: ensureAudio,
  getSong: () => song,
  scheduleStep: (ctx, step, time, stepDur) => {
    liveBus.sync(song);
    scheduleStepSounds(ctx, liveBus, step, time, stepDur);
  },
  onStep: (step) => gridView.highlight(step),
  onStateChange: (playing) => {
    els.playBtn.textContent = playing ? '■ 停止' : '▶ 再生';
    els.playBtn.classList.toggle('playing', playing);
  },
});

/** 置いた瞬間の試聴(初心者向けフィードバック) */
function previewNote(dataRow) {
  const ctx = ensureAudio();
  const inst = activeInst();
  const dur = transport.stepDuration() * 1.5;
  inst.noteOn(ctx, liveBus.channels[inst.id], dataRow, ctx.currentTime + 0.01, dur, song, activeTrack().params);
}

/* ---------------- DOM 要素 ---------------- */

const $ = (id) => document.getElementById(id);
const els = {
  playBtn: $('playBtn'), bpmSlider: $('bpmSlider'), bpmValue: $('bpmValue'),
  demoBtn: $('demoBtn'), helpBtn: $('helpBtn'), helpDialog: $('helpDialog'), helpCloseBtn: $('helpCloseBtn'),
  trackTabs: $('trackTabs'), trackHint: $('trackHint'), instControls: $('instControls'),
  volSlider: $('volSlider'), muteBtn: $('muteBtn'), clearTrackBtn: $('clearTrackBtn'),
  grid: $('grid'),
  keySelect: $('keySelect'), scaleSelect: $('scaleSelect'), lenSelect: $('lenSelect'),
  wavBtn: $('wavBtn'), exportBtn: $('exportBtn'), importBtn: $('importBtn'), importFile: $('importFile'),
  clearAllBtn: $('clearAllBtn'),
};

/* ---------------- グリッド ---------------- */

const gridView = new GridView(els.grid, (dataRow, step, value) => {
  scheduleSave(song);
  if (value) previewNote(dataRow);
});

function renderGrid() {
  const inst = activeInst();
  gridView.render({
    steps: song.steps,
    rows: inst.getRows(song, activeTrack().params),
    color: inst.color,
    grid: activeTrack().grid,
  });
}

/* ---------------- トラックタブと設定 ---------------- */

function renderTabs() {
  els.trackTabs.innerHTML = '';
  for (const inst of INSTRUMENTS) {
    const btn = document.createElement('button');
    btn.className = 'track-tab'
      + (inst.id === activeTrackId ? ' active' : '')
      + (song.tracks[inst.id].mute ? ' muted' : '');
    btn.style.setProperty('--tab-color', inst.color);
    btn.innerHTML = `<span class="dot"></span>${inst.name}`;
    btn.addEventListener('click', () => {
      activeTrackId = inst.id;
      renderTabs();
      renderTrackControls();
      renderGrid();
    });
    els.trackTabs.appendChild(btn);
  }
}

// 楽器の buildControls に渡すAPI(楽器はDAW本体の内部を知らなくていい)
const controlsApi = {
  onChange() {
    if (liveBus) liveBus.sync(song);
    scheduleSave(song);
  },
  refreshGrid() { renderGrid(); },
  refreshControls() { renderTrackControls(); },
};

function renderTrackControls() {
  const inst = activeInst();
  const tr = activeTrack();
  els.trackHint.textContent = inst.hint;
  els.volSlider.value = Math.round(tr.vol * 100);
  els.muteBtn.textContent = tr.mute ? '🔇' : '🔊';
  els.instControls.innerHTML = '';
  if (inst.buildControls) inst.buildControls(els.instControls, tr.params, controlsApi);
}

els.volSlider.addEventListener('input', () => {
  activeTrack().vol = Number(els.volSlider.value) / 100;
  controlsApi.onChange();
});

els.muteBtn.addEventListener('click', () => {
  activeTrack().mute = !activeTrack().mute;
  renderTabs();
  renderTrackControls();
  controlsApi.onChange();
});

els.clearTrackBtn.addEventListener('click', () => {
  for (const row of activeTrack().grid) row.fill(false);
  renderGrid();
  scheduleSave(song);
});

/* ---------------- ヘッダー操作 ---------------- */

els.playBtn.addEventListener('click', () => transport.toggle());

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && !['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(e.target.tagName)) {
    e.preventDefault();
    els.playBtn.click();
  }
});

els.bpmSlider.addEventListener('input', () => {
  song.bpm = Number(els.bpmSlider.value);
  els.bpmValue.textContent = song.bpm;
  scheduleSave(song);
});

/* ---------------- くわしい設定 ---------------- */

function initSelectors() {
  KEY_NAMES.forEach((name, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = name;
    els.keySelect.appendChild(opt);
  });
}

function syncControlsFromSong() {
  els.bpmSlider.value = song.bpm;
  els.bpmValue.textContent = song.bpm;
  els.keySelect.value = song.key;
  els.scaleSelect.value = song.scale;
  els.lenSelect.value = song.steps;
}

els.keySelect.addEventListener('change', () => {
  song.key = Number(els.keySelect.value);
  renderGrid();
  scheduleSave(song);
});

els.scaleSelect.addEventListener('change', () => {
  song.scale = els.scaleSelect.value;
  renderGrid();
  scheduleSave(song);
});

els.lenSelect.addEventListener('change', () => {
  song.steps = Number(els.lenSelect.value);
  renderGrid();
  scheduleSave(song);
});

els.clearAllBtn.addEventListener('click', () => {
  if (!confirm('すべてのトラックの打ち込みを消します。よろしいですか?')) return;
  for (const inst of INSTRUMENTS) {
    for (const row of song.tracks[inst.id].grid) row.fill(false);
  }
  renderGrid();
  scheduleSave(song);
});

/* ---------------- 書き出し・読み込み ---------------- */

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
  const blob = new Blob([JSON.stringify(song, null, 2)], { type: 'application/json' });
  downloadBlob(blob, 'kantan-daw-song.json');
});

els.importBtn.addEventListener('click', () => els.importFile.click());

els.importFile.addEventListener('change', async () => {
  const file = els.importFile.files[0];
  els.importFile.value = '';
  if (!file) return;
  try {
    song = songFromData(INSTRUMENTS, JSON.parse(await file.text()));
    refreshAllUI();
    scheduleSave(song);
  } catch (e) {
    alert('読み込めませんでした。かんたんDAWで書き出したファイルを選んでください。');
  }
});

/* ---------------- WAV 書き出し ---------------- */

els.wavBtn.addEventListener('click', async () => {
  els.wavBtn.disabled = true;
  els.wavBtn.textContent = '🎛️ 作成中…';
  try {
    const loops = 2;
    const stepDur = transport.stepDuration();
    const dur = stepDur * song.steps * loops + 2.0; // 余韻ぶん
    const sampleRate = 44100;
    const offline = new OfflineAudioContext(2, Math.ceil(sampleRate * dur), sampleRate);
    const bus = createBus(offline, INSTRUMENTS, song);
    bus.sync(song);
    let t = 0.05;
    for (let l = 0; l < loops; l++) {
      for (let s = 0; s < song.steps; s++) {
        scheduleStepSounds(offline, bus, s, t, stepDur);
        t += stepDur;
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

/* ---------------- デモ曲 ---------------- */

function loadDemo() {
  song = defaultSong(INSTRUMENTS);
  song.bpm = 112;
  const T = song.tracks;
  const set = (grid, row, steps) => { for (const s of steps) grid[row][s] = true; };

  // アイスパッド(ICEキット)が王道の8ビートを叩く
  set(T.icepad.grid, 0,  [0, 6, 8, 14]);                    // キック(深氷)
  set(T.icepad.grid, 2,  [4, 12]);                          // スネア(氷塊)
  set(T.icepad.grid, 4,  [0, 2, 4, 6, 8, 10, 12, 14]);      // ハイハット(クローズ)
  set(T.icepad.grid, 5,  [15]);                             // ハイハット(オープン)
  set(T.icepad.grid, 13, [4, 12]);                          // クラップ(氷)

  // コード: I → vi → IV → V(4マスごと)
  T.chords.grid[0][0] = true;
  T.chords.grid[2][4] = true;
  T.chords.grid[3][8] = true;
  T.chords.grid[1][12] = true;

  // ベース: コードに合わせてルート弾き(ペンタ度数: 0=ド…4=ラ)
  set(T.bass.grid, 0, [0, 3]);
  set(T.bass.grid, 4, [4, 7]);
  set(T.bass.grid, 3, [8, 11, 12, 15]);

  // アイスシンセ(クリスタル)が主役のメロディを弾く
  const mel = [[0, 5], [2, 7], [4, 6], [6, 5], [8, 3], [10, 4], [12, 5], [14, 2]];
  for (const [step, deg] of mel) T.icesynth.grid[deg][step] = true;

  refreshAllUI();
  scheduleSave(song);
  if (!transport.isPlaying) transport.start();
}

els.demoBtn.addEventListener('click', () => {
  ensureAudio();
  loadDemo();
});

/* ---------------- ヘルプ ---------------- */

els.helpBtn.addEventListener('click', () => els.helpDialog.showModal());
els.helpCloseBtn.addEventListener('click', () => {
  els.helpDialog.close();
  try { localStorage.setItem(HELP_KEY, '1'); } catch (e) {}
});

/* ---------------- 初期化 ---------------- */

function refreshAllUI() {
  syncControlsFromSong();
  renderTabs();
  renderTrackControls();
  renderGrid();
}

initSelectors();
refreshAllUI();

try {
  if (!localStorage.getItem(HELP_KEY)) els.helpDialog.showModal();
} catch (e) {}
