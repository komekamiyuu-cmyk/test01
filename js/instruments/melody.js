/* メロディ: スケール2オクターブ、音色を選べるリードシンセ */

import { pitchedRows, midiToFreq } from '../config.js';
import { makeSelect } from '../ui/controls.js';

const TONES = {
  soft:  'やさしい音',
  synth: 'シンセ',
  pico:  'ピコピコ',
};

function playTone(ctx, dest, freq, t, dur, inst) {
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

export default {
  id: 'melody',
  name: 'メロディ',
  color: 'var(--c-melody)',
  hint: '主役のメロディ。自由に置いてOK、どの音もキレイに響きます',
  maxRows: 15, // メジャースケール2オクターブ+1音ぶんの保存領域
  defaultVol: 0.8,

  defaultParams() { return { inst: 'soft' }; },
  sanitizeParams(p) { if (!TONES[p.inst]) p.inst = 'soft'; },

  getRows(song) { return pitchedRows(song, 60, 2); }, // C4基準

  noteOn(ctx, channel, dataRow, time, dur, song, params) {
    const row = pitchedRows(song, 60, 2).find(r => r.dataRow === dataRow);
    if (!row) return;
    playTone(ctx, channel.input, midiToFreq(row.midi), time, dur * 0.9, params.inst);
  },

  buildControls(container, params, api) {
    makeSelect(container, '音色', TONES, params.inst, (v) => {
      params.inst = v;
      api.onChange();
    });
  },
};
