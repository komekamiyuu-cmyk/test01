/* ============================================================
   曲データ(Song)の作成・検証・保存・読み込み
   データの形はここだけが知っている。UIや音声エンジンは
   この構造体を読むだけで、直接 localStorage には触れない。

   song = {
     version: 2,
     bpm, steps(16|32), key(0-11), scale('penta'|'major'|'minor'),
     tracks: {
       [trackId]: {
         vol: 0..1, mute: bool,
         grid: bool[instrument.maxRows][MAX_STEPS],
         params: {...楽器固有(音色・キットなど)},
       }
     }
   }
   ============================================================ */

import { MAX_STEPS, SCALES, clamp } from './config.js';

const SAVE_KEY_V2 = 'kantan-daw-song-v2';
const SAVE_KEY_V1 = 'kantan-daw-song-v1';

export function makeGrid(rows) {
  return Array.from({ length: rows }, () => new Array(MAX_STEPS).fill(false));
}

/** 楽器レジストリからまっさらな曲を作る */
export function defaultSong(instruments) {
  const tracks = {};
  for (const inst of instruments) {
    tracks[inst.id] = {
      vol: inst.defaultVol ?? 0.8,
      mute: false,
      grid: makeGrid(inst.maxRows),
      params: inst.defaultParams ? inst.defaultParams() : {},
    };
  }
  return { version: 2, bpm: 110, steps: 16, key: 0, scale: 'penta', tracks };
}

/**
 * 外部データ(保存データ・インポートJSON)を検証しながら曲に変換する。
 * 知らないキーは無視し、欠けた値は初期値で埋めるので、
 * 将来トラックやパラメータが増えても古いデータをそのまま読める。
 */
export function songFromData(instruments, data) {
  if (!data || typeof data !== 'object' || !data.tracks) throw new Error('形式が違います');
  const song = defaultSong(instruments);
  song.bpm   = clamp(Number(data.bpm) || 110, 60, 180);
  song.steps = data.steps === 32 ? 32 : 16;
  song.key   = clamp(Number(data.key) || 0, 0, 11);
  song.scale = SCALES[data.scale] ? data.scale : 'penta';

  for (const inst of instruments) {
    const src = data.tracks[inst.id];
    const dst = song.tracks[inst.id];
    if (!src) continue;
    const vol = Number(src.vol);
    if (!Number.isNaN(vol)) dst.vol = clamp(vol, 0, 1);
    dst.mute = !!src.mute;

    if (Array.isArray(src.grid)) {
      for (let r = 0; r < dst.grid.length; r++) {
        if (!Array.isArray(src.grid[r])) continue;
        for (let c = 0; c < MAX_STEPS; c++) dst.grid[r][c] = !!src.grid[r][c];
      }
    }

    // params: 楽器側の初期値をベースに、保存されていた値だけ上書き
    const savedParams = src.params && typeof src.params === 'object' ? src.params
      : (inst.id === 'melody' && src.inst ? { inst: src.inst } : null); // v1互換
    if (savedParams) {
      for (const k of Object.keys(dst.params)) {
        if (savedParams[k] !== undefined) dst.params[k] = savedParams[k];
      }
      if (inst.sanitizeParams) inst.sanitizeParams(dst.params);
    }
  }
  return song;
}

/** localStorage から読む(v2優先、なければv1から移行)。無ければ null */
export function loadSong(instruments) {
  for (const key of [SAVE_KEY_V2, SAVE_KEY_V1]) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      return songFromData(instruments, JSON.parse(raw));
    } catch (e) { /* 壊れた保存データは無視して次へ */ }
  }
  return null;
}

let saveTimer = null;
export function scheduleSave(song) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(SAVE_KEY_V2, JSON.stringify(song)); } catch (e) { /* 容量超過などは無視 */ }
  }, 300);
}
