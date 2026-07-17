/* コード: 曲のキーに合った定番コード4つをワンタップで鳴らす */

import { chordRowsFor, midiToFreq } from '../config.js';

export default {
  id: 'chords',
  name: 'コード',
  color: 'var(--c-chords)',
  hint: '曲の雰囲気をつくる和音。4マスごとに置くのがおすすめ',
  maxRows: 4,
  defaultVol: 0.7,

  getRows(song) { return chordRowsFor(song); },

  noteOn(ctx, channel, dataRow, time, dur, song) {
    const row = chordRowsFor(song)[dataRow];
    if (!row) return;
    const hold = dur * 2; // 2ステップぶん伸ばす
    for (const off of row.offsets) {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = midiToFreq(48 + song.key + off); // C3基準
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 1800;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, time);
      g.gain.linearRampToValueAtTime(0.16, time + 0.03);
      g.gain.setTargetAtTime(0.0001, time + hold * 0.85, 0.1);
      osc.connect(filter).connect(g).connect(channel.input);
      osc.start(time);
      osc.stop(time + hold + 0.5);
    }
  },
};
