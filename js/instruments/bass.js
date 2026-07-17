/* ベース: スケール1オクターブぶんの低音 */

import { pitchedRows, midiToFreq } from '../config.js';

export default {
  id: 'bass',
  name: 'ベース',
  color: 'var(--c-bass)',
  hint: '低い音で曲を支えます。コードと同じタイミングが合いやすい',
  maxRows: 8, // メジャースケール1オクターブ+1音ぶんの保存領域
  defaultVol: 0.85,

  getRows(song) { return pitchedRows(song, 36, 1); }, // C2基準

  noteOn(ctx, channel, dataRow, time, dur, song) {
    const row = pitchedRows(song, 36, 1).find(r => r.dataRow === dataRow);
    if (!row) return;
    const gate = dur * 0.9;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = midiToFreq(row.midi);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(900, time);
    filter.frequency.exponentialRampToValueAtTime(280, time + gate);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(0.5, time + 0.01);
    g.gain.setTargetAtTime(0.0001, time + gate * 0.9, 0.04);
    osc.connect(filter).connect(g).connect(channel.input);
    osc.start(time);
    osc.stop(time + gate + 0.3);
  },
};
