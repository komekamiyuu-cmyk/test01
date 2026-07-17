/* ============================================================
   ICE SYNTH - 氷系ポリシンセ(単体版 icesynth.html からの移植)
   デチューン複数ボイス + 2オペレータFM + フィルターエンベロープ
   + リバーブ/シマー。単体版はリアルタイム鍵盤用だったので、
   シーケンサー用に「発音時刻とゲート長を受け取り、リリースまで
   すべて予約する」方式に書き換えてある。音作りの数値は単体版と同じ。
   ============================================================ */

import { pitchedRows } from '../config.js';
import { makeImpulse } from '../audio/bus.js';
import { makeSelect, makeSlider } from '../ui/controls.js';

// 単体版と同じプリセット(P の初期値一式)
export const PRESETS = {
  crystal:  { wave: 'sine',     tune: 0,   detune: 6,  voices: 3, attack: .003, decay: .5,  sustain: .05, release: 1.8, fm1ratio: 3.5, fm1depth: 120, fm1attack: .001, fm1decay: .08, fm2ratio: 7,  fm2depth: 30, fm2attack: .001, fm2decay: .04, cutoff: 8000,  res: 12, fenv: 4000, filterType: 'lowpass', reverb: .7,  shimmer: .35 },
  glacier:  { wave: 'sine',     tune: -12, detune: 2,  voices: 2, attack: .8,   decay: 2,   sustain: .4,  release: 3,   fm1ratio: 1.5, fm1depth: 40,  fm1attack: .5,   fm1decay: 1.5, fm2ratio: 4,  fm2depth: 10, fm2attack: .1,   fm2decay: .5,  cutoff: 3000,  res: 4,  fenv: 800,  filterType: 'lowpass', reverb: .9,  shimmer: .6 },
  shatter:  { wave: 'sawtooth', tune: 0,   detune: 12, voices: 4, attack: .001, decay: .15, sustain: 0,   release: .4,  fm1ratio: 6,   fm1depth: 200, fm1attack: .001, fm1decay: .05, fm2ratio: 11, fm2depth: 80, fm2attack: .001, fm2decay: .03, cutoff: 12000, res: 18, fenv: 6000, filterType: 'lowpass', reverb: .5,  shimmer: .1 },
  frost:    { wave: 'triangle', tune: 0,   detune: 3,  voices: 2, attack: .015, decay: .8,  sustain: .2,  release: 1.5, fm1ratio: 2,   fm1depth: 60,  fm1attack: .01,  fm1decay: .3,  fm2ratio: 5,  fm2depth: 15, fm2attack: .005, fm2decay: .1,  cutoff: 5000,  res: 6,  fenv: 2000, filterType: 'lowpass', reverb: .6,  shimmer: .25 },
  blizzard: { wave: 'sawtooth', tune: -5,  detune: 20, voices: 6, attack: .1,   decay: 1.2, sustain: .3,  release: 2.5, fm1ratio: 1.5, fm1depth: 90,  fm1attack: .05,  fm1decay: .6,  fm2ratio: 3,  fm2depth: 30, fm2attack: .02,  fm2decay: .2,  cutoff: 4000,  res: 5,  fenv: 1500, filterType: 'lowpass', reverb: .85, shimmer: .5 },
  ping:     { wave: 'sine',     tune: 12,  detune: 1,  voices: 1, attack: .001, decay: .25, sustain: 0,   release: .6,  fm1ratio: 4,   fm1depth: 50,  fm1attack: .001, fm1decay: .06, fm2ratio: 9,  fm2depth: 10, fm2attack: .001, fm2decay: .02, cutoff: 14000, res: 20, fenv: 5000, filterType: 'lowpass', reverb: .45, shimmer: .15 },
};

const PRESET_LABELS = {
  crystal: 'クリスタル(きらめき)',
  glacier: 'グレイシャー(ゆったり)',
  shatter: 'シャター(鋭い)',
  frost:   'フロスト(まろやか)',
  blizzard:'ブリザード(分厚い)',
  ping:    'ピング(短い響き)',
};

export default {
  id: 'icesynth',
  name: 'アイスシンセ',
  color: 'var(--c-icesynth)',
  hint: '氷のようにきらめくシンセ。プリセットで音の性格を選ぼう',
  maxRows: 15, // メロディと同じ2オクターブぶんの保存領域
  defaultVol: 0.75,

  defaultParams() {
    return { preset: 'crystal', ...PRESETS.crystal };
  },
  sanitizeParams(p) {
    if (!PRESETS[p.preset]) Object.assign(p, PRESETS.crystal, { preset: 'crystal' });
  },

  getRows(song) { return pitchedRows(song, 60, 2); }, // C4基準(メロディと同じ並び)

  // トラック専用チャンネル: dry/wet リバーブ + シマー(オクターブ上の薄い成分)
  createChannel(ctx, dest, P) {
    const input = ctx.createGain();
    const dry = ctx.createGain();
    dry.gain.value = 1 - P.reverb;
    const wet = ctx.createGain();
    wet.gain.value = P.reverb;
    const conv = ctx.createConvolver();
    conv.buffer = makeImpulse(ctx, 4, 1.5);
    const shimmer = ctx.createGain();
    shimmer.gain.value = P.shimmer * 0.28;
    input.connect(dry);
    dry.connect(dest);
    input.connect(conv);
    conv.connect(wet);
    wet.connect(dest);
    shimmer.connect(wet); // 単体版と同じ: シマーはウェット側にだけ乗る
    return {
      input,
      shimmer,
      update(p) {
        dry.gain.value = 1 - p.reverb;
        wet.gain.value = p.reverb;
        shimmer.gain.value = p.shimmer * 0.28;
      },
    };
  },

  noteOn(ctx, channel, dataRow, time, dur, song, P) {
    const row = pitchedRows(song, 60, 2).find(r => r.dataRow === dataRow);
    if (!row) return;
    const freq = 440 * Math.pow(2, (row.midi - 69 + P.tune) / 12);
    const gate = Math.max(dur * 0.95, 0.04);
    const tRel = time + gate;                        // リリース開始時刻
    const tEnd = tRel + Math.min(P.release * 2, 8);  // オシレータ停止時刻

    // アンプエンベロープ(ADS → 時刻tRelでR)
    const vg = ctx.createGain();
    vg.gain.setValueAtTime(0, time);
    vg.gain.linearRampToValueAtTime(0.85, time + P.attack);
    vg.gain.setTargetAtTime(P.sustain * 0.85, time + P.attack + P.decay, P.decay * 0.3);
    vg.gain.setTargetAtTime(0, tRel, P.release * 0.25);

    // フィルター(エンベロープ付き)
    const filt = ctx.createBiquadFilter();
    filt.type = P.filterType || 'lowpass';
    filt.frequency.setValueAtTime(80, time);
    filt.frequency.linearRampToValueAtTime(Math.min(18000, P.cutoff + P.fenv), time + P.attack + P.decay * 0.5);
    filt.frequency.setTargetAtTime(Math.max(80, P.cutoff), time + P.attack + P.decay, P.decay * 0.5);
    filt.Q.value = P.res;

    // デチューンした複数ボイス
    const oscs = [];
    for (let v = 0; v < P.voices; v++) {
      const o = ctx.createOscillator();
      o.type = P.wave;
      o.detune.value = P.voices > 1 ? (v / (P.voices - 1) * P.detune * 2 - P.detune) * 100 : 0;
      o.frequency.setValueAtTime(freq, time);
      const og = ctx.createGain();
      og.gain.value = 1 / Math.sqrt(P.voices);
      o.connect(og);
      og.connect(filt);
      o.start(time);
      o.stop(tEnd);
      oscs.push(o);
    }

    // FMオペレータ×2(アタック/ディケイ付きで金属的な立ち上がりを作る)
    for (const op of [1, 2]) {
      const ratio = P[`fm${op}ratio`], depth = P[`fm${op}depth`];
      const att = P[`fm${op}attack`], dec = P[`fm${op}decay`];
      const fm = ctx.createOscillator();
      const fmg = ctx.createGain();
      fm.frequency.setValueAtTime(freq * ratio, time);
      fmg.gain.setValueAtTime(0, time);
      fmg.gain.linearRampToValueAtTime(depth * freq / 440, time + att);
      fmg.gain.exponentialRampToValueAtTime(Math.max(.001, depth * .05 * freq / 440), time + att + dec);
      fm.connect(fmg);
      oscs.forEach(o => fmg.connect(o.frequency));
      fm.start(time);
      fm.stop(tEnd);
    }

    // シマー(1オクターブ上の淡いサイン波)
    const shm = ctx.createOscillator();
    shm.type = 'sine';
    shm.frequency.value = freq * 2.001;
    const shmg = ctx.createGain();
    shmg.gain.setValueAtTime(P.shimmer * 0.12, time);
    shmg.gain.setTargetAtTime(0, tRel, P.release * 0.25);
    shm.connect(shmg);
    shmg.connect(channel.shimmer);
    shm.start(time);
    shm.stop(tEnd);

    filt.connect(vg);
    vg.connect(channel.input);
  },

  buildControls(container, params, api) {
    makeSelect(container, 'プリセット', PRESET_LABELS, params.preset, (v) => {
      Object.assign(params, PRESETS[v], { preset: v });
      api.refreshControls(); // スライダー表示をプリセット値に合わせ直す
      api.onChange();
    });
    makeSlider(container, '明るさ', { min: 200, max: 18000, step: 100, value: params.cutoff, fmt: v => v >= 1000 ? (v / 1000).toFixed(1) + 'k' : String(v) }, (v) => {
      params.cutoff = v;
      api.onChange();
    });
    makeSlider(container, 'リバーブ', { min: 0, max: 1, step: 0.01, value: params.reverb, fmt: v => v.toFixed(2) }, (v) => {
      params.reverb = v;
      api.onChange();
    });
    makeSlider(container, '余韻', { min: 0.05, max: 6, step: 0.05, value: params.release, fmt: v => v.toFixed(1) + 's' }, (v) => {
      params.release = v;
      api.onChange();
    });
  },
};
