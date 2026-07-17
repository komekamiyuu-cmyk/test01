/* かんたんドラム: シンプルな5音のシンセドラム */

const ROWS = [
  { id: 'ohat',  label: 'シャーン' },
  { id: 'hat',   label: 'チッ' },
  { id: 'clap',  label: 'パン(手拍子)' },
  { id: 'snare', label: 'タン(スネア)' },
  { id: 'kick',  label: 'ドン(キック)', strong: true },
];

function noiseBuffer(ctx) {
  if (!ctx.__kantanNoise) {
    const len = Math.floor(ctx.sampleRate * 0.5);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    ctx.__kantanNoise = buf;
  }
  return ctx.__kantanNoise;
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

const PLAYERS = { kick: playKick, snare: playSnare, clap: playClap,
  hat: (ctx, dest, t) => playHat(ctx, dest, t, false),
  ohat: (ctx, dest, t) => playHat(ctx, dest, t, true) };

export default {
  id: 'drums',
  name: 'ドラム',
  color: 'var(--c-drums)',
  hint: 'リズムの土台。まずは「ドン」と「チッ」を置いてみよう',
  maxRows: ROWS.length,
  defaultVol: 0.9,

  getRows() {
    return ROWS.map((r, i) => ({ dataRow: i, label: r.label, strong: !!r.strong }));
  },

  noteOn(ctx, channel, dataRow, time) {
    PLAYERS[ROWS[dataRow].id](ctx, channel.input, time);
  },
};
