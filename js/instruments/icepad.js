/* ============================================================
   ICE PAD - 氷系ドラムマシン(単体版 icepad.html からの移植)
   16ボイス × 3キット(ICE / VAPORWAVE / テクスチャ)× 4バンク。
   全音色は数式で波形を直接生成し AudioBuffer にキャッシュする。
   AudioBuffer はコンテキスト非依存なので、リアルタイム再生と
   WAV書き出し(OfflineAudioContext)で同じキャッシュを共有できる。
   ============================================================ */

import { makeImpulse } from '../audio/bus.js';
import { makeSelect, makeSlider } from '../ui/controls.js';

const BANKS = [
  { id: 'glacier', label: 'グレイシャー', pitch: 0 },
  { id: 'metal',   label: 'メタル',       pitch: 5 },
  { id: 'deep',    label: 'ディープ',     pitch: -5 },
  { id: 'shatter', label: 'シャター',     pitch: 7 },
];

const ICE_VOICES = [
  { id: 'kick_deep',  label: 'キック(深氷)',        strong: true },
  { id: 'kick_snap',  label: 'キック(鋭氷)',        strong: true },
  { id: 'snare_ice',  label: 'スネア(氷塊)' },
  { id: 'snare_rim',  label: 'スネア(リム)' },
  { id: 'hh_closed',  label: 'ハイハット(クローズ)' },
  { id: 'hh_open',    label: 'ハイハット(オープン)' },
  { id: 'hh_pedal',   label: 'ハイハット(ペダル)' },
  { id: 'crash',      label: 'クラッシュ' },
  { id: 'ride_bell',  label: 'ライド(ベル)' },
  { id: 'ride_bow',   label: 'ライド(ボウ)' },
  { id: 'tom_hi',     label: 'タム(ハイ)' },
  { id: 'tom_mid',    label: 'タム(ミッド)' },
  { id: 'tom_lo',     label: 'タム(ロウ)' },
  { id: 'clap_ice',   label: 'クラップ(氷)' },
  { id: 'perc_clave', label: 'クレイブ' },
  { id: 'shaker_ice', label: 'シェイカー(氷粉)' },
];

const VAPOR_VOICES = [
  { id: 'v808_kick',    label: '808キック(サブ)',   strong: true },
  { id: 'v808_kick2',   label: '808キック(パンチ)', strong: true },
  { id: 'v808_snare',   label: '808スネア' },
  { id: 'v808_clap',    label: '808クラップ' },
  { id: 'v808_hh_c',    label: '808ハット(クローズ)' },
  { id: 'v808_hh_o',    label: '808ハット(オープン)' },
  { id: 'v808_cowbell', label: 'カウベル' },
  { id: 'v808_tom_hi',  label: '808タム(ハイ)' },
  { id: 'v808_tom_lo',  label: '808タム(ロウ)' },
  { id: 'vlofi_kick',   label: 'ローファイキック', strong: true },
  { id: 'vlofi_snare',  label: 'ローファイスネア' },
  { id: 'vtape_clap',   label: 'テープクラップ' },
  { id: 'vvinyl_crack', label: 'バイナルクラック' },
  { id: 'vtape_hiss',   label: 'テープヒス' },
  { id: 'vecho_snare',  label: 'エコースネア' },
  { id: 'v808_bass',    label: '808ベース(ロング)', strong: true },
];

const TEXTURE_VOICES = [
  { id: 'ping',     label: 'ピング' },      { id: 'crackle', label: 'クラック' },
  { id: 'shatter2', label: 'シャター' },    { id: 'drip',    label: 'ドリップ' },
  { id: 'chime',    label: 'チャイム' },    { id: 'scrape',  label: 'スクレイプ' },
  { id: 'hiss',     label: 'ヒス' },        { id: 'tap',     label: 'タップ' },
  { id: 'snap2',    label: 'スナップ' },    { id: 'groan',   label: 'グローン' },
  { id: 'tinkle',   label: 'ティンクル' },  { id: 'crack2',  label: 'クラック2' },
  { id: 'breath',   label: 'ブレス' },      { id: 'melt',    label: 'メルト' },
  { id: 'freeze',   label: 'フリーズ' },    { id: 'glide',   label: 'グライド' },
];

const KITS = {
  ice:     { label: 'ICE(氷)',       voices: ICE_VOICES },
  vapor:   { label: 'VAPORWAVE(808)', voices: VAPOR_VOICES },
  texture: { label: 'テクスチャ',      voices: TEXTURE_VOICES },
};

// 各ボイスの音量バランス調整テーブル(単体版のRMS測定値から)
const VOICE_GAIN = {
  kick_deep: 0.62, kick_snap: 0.80, snare_ice: 0.88, snare_rim: 1.15,
  hh_closed: 1.30, hh_open: 1.05, hh_pedal: 1.20, crash: 1.20,
  ride_bell: 0.92, ride_bow: 1.05, tom_hi: 0.90, tom_mid: 0.90, tom_lo: 0.88,
  clap_ice: 1.10, perc_clave: 0.95, shaker_ice: 0.48,
  v808_kick: 0.40, v808_kick2: 0.65, v808_snare: 0.90, v808_clap: 0.55,
  v808_hh_c: 1.25, v808_hh_o: 1.10, v808_cowbell: 0.95,
  v808_tom_hi: 0.88, v808_tom_lo: 0.85,
  vlofi_kick: 0.72, vlofi_snare: 0.90, vtape_clap: 0.85,
  vvinyl_crack: 1.05, vtape_hiss: 0.50, vecho_snare: 0.88, v808_bass: 0.35,
};

/* ---------------- 波形生成(コンテキスト非依存) ---------------- */

function fill(sr, dur, fn) {
  const buf = new AudioBuffer({ length: Math.max(1, Math.floor(sr * dur)), sampleRate: sr, numberOfChannels: 1 });
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.max(-1, Math.min(1, fn(i, i / d.length, d.length)));
  return buf;
}

// 単純なローパス(warmth用)とテープサチュレーション(単体版と同じ処理)
function warm(d, sr, cutHz) {
  const pi2 = Math.PI * 2;
  const rc = 1 / (pi2 * cutHz), dt = 1 / sr, a = dt / (rc + dt);
  let prev = 0;
  for (let i = 0; i < d.length; i++) { prev = prev + a * (d[i] - prev); d[i] = prev; }
}
function sat(d, amt = 0.4) {
  for (let i = 0; i < d.length; i++) d[i] = Math.tanh(d[i] * (1 + amt * 3)) / (1 + amt * 0.5);
}

function synthIce(sr, voiceId, bankPitch) {
  const pi2 = Math.PI * 2;
  const note = st => 440 * Math.pow(2, (bankPitch + st) / 12);
  switch (voiceId) {
    case 'kick_deep': return fill(sr, .55, (i, x) => {
      const env = Math.pow(1 - x, 1.4), f = note(-14) * (1 - x * .7);
      return Math.sin(pi2 * f * i / sr) * env * .9
           + (Math.random() * 2 - 1) * Math.pow(Math.max(0, 1 - x * 30), 2) * .5
           + Math.sin(pi2 * note(12) * i / sr) * Math.pow(1 - x, 8) * .15;
    });
    case 'kick_snap': return fill(sr, .35, (i, x) => {
      const env = Math.pow(1 - x, 2.5), f = note(-10) * (1 - x * .5);
      const snapEnv = x < .03 ? Math.pow(1 - x / .03, .5) : 0;
      return Math.sin(pi2 * f * i / sr) * env * .85
           + (Math.random() * 2 - 1) * snapEnv * .7
           + Math.sin(pi2 * note(24) * i / sr) * Math.pow(1 - x, 10) * .2;
    });
    case 'snare_ice': return fill(sr, .28, (i, x) => {
      const e1 = Math.pow(1 - x, 1.8), e2 = Math.pow(1 - x, 3.5);
      return (Math.random() * 2 - 1) * e1 * .55
           + Math.sin(pi2 * note(-2) * i / sr) * e2 * .5
           + (Math.sin(pi2 * note(14) * i / sr) + Math.sin(pi2 * note(19) * i / sr)) * .5 * Math.pow(1 - x, 6) * .25
           + (x < .04 ? (Math.random() * 2 - 1) * 1.5 * Math.pow(1 - x / .04, 1) : 0);
    });
    case 'snare_rim': return fill(sr, .18, (i, x) => {
      const env = Math.pow(1 - x, 4);
      return (Math.sin(pi2 * note(7) * i / sr) + Math.sin(pi2 * note(14) * i / sr)) * .5 * env * .7
           + (x < .02 ? (Math.random() * 2 - 1) * 1.5 : 0);
    });
    case 'hh_closed': return fill(sr, .09, (i, x) => {
      const env = Math.pow(1 - x, 4); let s = 0;
      for (let h = 0; h < 6; h++) s += Math.sin(pi2 * note(24 + h * 5) * i / sr + Math.random() * .1);
      return (s / 6 + (Math.random() * 2 - 1) * .3) * env * .7;
    });
    case 'hh_open': return fill(sr, .55, (i, x) => {
      const env = x < .02 ? x / .02 : Math.pow(1 - (x - .02) / .98, 1.5); let s = 0;
      for (let h = 0; h < 8; h++) s += Math.sin(pi2 * note(22 + h * 4.3) * i / sr);
      return (s / 8 + (Math.random() * 2 - 1) * .2) * env * .65;
    });
    case 'hh_pedal': return fill(sr, .07, (i, x) => (Math.random() * 2 - 1) * Math.pow(1 - x, 6) * .45);
    case 'crash': return fill(sr, 2.0, (i, x) => {
      const env = x < .01 ? x / .01 : Math.pow(1 - (x - .01) / 1.99, 1.2); let s = 0;
      for (let h = 0; h < 10; h++) s += Math.sin(pi2 * note(20 + h * 3.7 + h * .11) * i / sr + h);
      return (s / 10 + (Math.random() * 2 - 1) * .4) * env * .7;
    });
    case 'ride_bell': return fill(sr, .9, (i, x) => {
      const env = Math.pow(1 - x, 1.2), f = note(16);
      return (Math.sin(pi2 * f * i / sr) * .6 + Math.sin(pi2 * f * 2.76 * i / sr) * .25 + Math.sin(pi2 * f * 5.4 * i / sr) * .1) * env * .75;
    });
    case 'ride_bow': return fill(sr, 1.2, (i, x) => {
      const env = x < .05 ? x / .05 : Math.pow(1 - (x - .05) / 1.15, 1.4); let s = 0;
      for (let h = 0; h < 7; h++) s += Math.sin(pi2 * note(18 + h * 3.1) * i / sr);
      return (s / 7 + (Math.random() * 2 - 1) * .15) * env * .55;
    });
    case 'tom_hi': return fill(sr, .32, (i, x) => {
      const env = Math.pow(1 - x, 2), f = note(2) * (1 - x * .4);
      return Math.sin(pi2 * f * i / sr) * env * .8 + (x < .03 ? (Math.random() * 2 - 1) * .4 : 0);
    });
    case 'tom_mid': return fill(sr, .42, (i, x) => {
      const env = Math.pow(1 - x, 1.8), f = note(-5) * (1 - x * .35);
      return Math.sin(pi2 * f * i / sr) * env * .85 + (x < .04 ? (Math.random() * 2 - 1) * .3 : 0);
    });
    case 'tom_lo': return fill(sr, .55, (i, x) => {
      const env = Math.pow(1 - x, 1.6), f = note(-12) * (1 - x * .3);
      return Math.sin(pi2 * f * i / sr) * env * .9 + (x < .05 ? (Math.random() * 2 - 1) * .25 : 0);
    });
    case 'clap_ice': return fill(sr, .32, (i, x) => {
      let s = 0;
      [0, .008, .016].forEach((off, k) => {
        const xi = Math.max(0, x - off / .32), e = Math.pow(Math.max(0, 1 - xi * 5), 2.5);
        s += (Math.random() * 2 - 1) * e * (1 / (k + 1));
      });
      return s * .7 + Math.sin(pi2 * note(10) * i / sr) * Math.pow(1 - x, 5) * .2;
    });
    case 'perc_clave': return fill(sr, .12, (i, x) => {
      const env = Math.pow(1 - x, 5);
      return (Math.sin(pi2 * note(20) * i / sr) * .7 + (Math.random() * 2 - 1) * .15) * env * .8;
    });
    case 'shaker_ice': return fill(sr, .18, (i, x) => (Math.random() * 2 - 1) * Math.sin(Math.PI * x) * .5);
    default: return synthTexture(sr, voiceId, 0, bankPitch);
  }
}

function synthVapor(sr, voiceId) {
  const pi2 = Math.PI * 2;
  switch (voiceId) {
    case 'v808_kick': {
      const buf = fill(sr, 2.0, (i, x) => {
        const f = 55 * Math.pow(1 - Math.pow(x, .25) * .9, 2) + 28;
        const env = Math.pow(1 - x, 0.3);
        const click = x < .015 ? (Math.random() * 2 - 1) * Math.pow(1 - x / .015, 2) * .6 : 0;
        return Math.sin(pi2 * f * i / sr) * env * .95 + click;
      });
      sat(buf.getChannelData(0), 0.2); return buf;
    }
    case 'v808_kick2': {
      const buf = fill(sr, 0.8, (i, x) => {
        const f = 80 * Math.pow(1 - x * .9, 2.5) + 30;
        const env = Math.pow(1 - x, 0.7);
        const click = x < .01 ? (Math.random() * 2 - 1) * Math.pow(1 - x / .01, 1.5) * .8 : 0;
        return Math.sin(pi2 * f * i / sr) * env * .9 + click;
      });
      sat(buf.getChannelData(0), 0.35); return buf;
    }
    case 'v808_snare': {
      const buf = fill(sr, 0.7, (i, x) => {
        const toneEnv = Math.pow(1 - x, 4);
        const noiseEnv = Math.pow(1 - x, 1.5);
        const tone = Math.sin(pi2 * 220 * i / sr) * toneEnv * .5 + Math.sin(pi2 * 175 * i / sr) * toneEnv * .3;
        const noise = (Math.random() * 2 - 1) * noiseEnv * .55;
        const click = x < .008 ? (Math.random() * 2 - 1) * 1.2 : 0;
        return tone + noise + click;
      });
      warm(buf.getChannelData(0), sr, 5000); sat(buf.getChannelData(0), 0.15); return buf;
    }
    case 'v808_clap': {
      const buf = fill(sr, 0.6, (i, x) => {
        let s = 0;
        [[0, .012, .016], [0.35, 0.018, 0.014], [0.45, 0.015, 0.012]].forEach(([off, spd, lvl]) => {
          const xi = Math.max(0, x - off);
          if (xi < spd * 3) s += (Math.random() * 2 - 1) * Math.pow(Math.max(0, 1 - xi / spd), 1.8) * lvl * 60;
        });
        const tail = x > .04 ? (Math.random() * 2 - 1) * Math.pow(Math.max(0, 1 - (x - .04) / .56), 2.5) * .2 : 0;
        return s + tail;
      });
      warm(buf.getChannelData(0), sr, 8000); return buf;
    }
    case 'v808_hh_c': return fill(sr, 0.08, (i, x) => {
      const env = Math.pow(1 - x, 5); let s = 0;
      for (let h = 0; h < 6; h++) s += Math.sin(pi2 * (4000 + h * 1500) * i / sr + h * 2.3);
      return (s / 6 + (Math.random() * 2 - 1) * .25) * env * .75;
    });
    case 'v808_hh_o': return fill(sr, 0.8, (i, x) => {
      const env = x < .01 ? x / .01 : Math.pow(Math.max(0, 1 - (x - .01) / .79), 1.3); let s = 0;
      for (let h = 0; h < 8; h++) s += Math.sin(pi2 * (3800 + h * 1200) * i / sr + h * 1.7);
      return (s / 8 + (Math.random() * 2 - 1) * .2) * env * .65;
    });
    case 'v808_cowbell': return fill(sr, 0.55, (i, x) => {
      const env = Math.pow(1 - x, 1.8);
      return (Math.sin(pi2 * 562 * i / sr) * .55 + Math.sin(pi2 * 845 * i / sr) * .45) * env * .8;
    });
    case 'v808_tom_hi': {
      const buf = fill(sr, 0.45, (i, x) => {
        const f = 200 * Math.pow(1 - x * .7, 2.5) + 80;
        return Math.sin(pi2 * f * i / sr) * Math.pow(1 - x, 1.6) * .85 + (x < .01 ? (Math.random() * 2 - 1) * .3 : 0);
      });
      sat(buf.getChannelData(0), 0.1); return buf;
    }
    case 'v808_tom_lo': {
      const buf = fill(sr, 0.75, (i, x) => {
        const f = 120 * Math.pow(1 - x * .75, 2.5) + 45;
        return Math.sin(pi2 * f * i / sr) * Math.pow(1 - x, 1.4) * .9 + (x < .012 ? (Math.random() * 2 - 1) * .25 : 0);
      });
      sat(buf.getChannelData(0), 0.15); return buf;
    }
    case 'vlofi_kick': {
      const buf = fill(sr, 0.5, (i, x) => {
        const f = 70 * Math.pow(1 - x * .85, 2) + 30;
        const raw = Math.sin(pi2 * f * i / sr) * Math.pow(1 - x, 1.2) * .9;
        const bits = 6, step = 2 / (Math.pow(2, bits) - 1);
        return Math.round(raw / step) * step;
      });
      warm(buf.getChannelData(0), sr, 3500); sat(buf.getChannelData(0), 0.5); return buf;
    }
    case 'vlofi_snare': {
      const buf = fill(sr, 0.35, (i, x) => {
        const noise = (Math.random() * 2 - 1) * Math.pow(1 - x, 2.2) * .7;
        const tone = Math.sin(pi2 * 200 * i / sr) * Math.pow(1 - x, 5) * .4;
        const raw = noise + tone;
        const rate = Math.floor(sr / 8000);
        return i % rate === 0 ? raw : 0;
      });
      warm(buf.getChannelData(0), sr, 4000); sat(buf.getChannelData(0), 0.6); return buf;
    }
    case 'vtape_clap': {
      const buf = fill(sr, 0.4, (i, x) => {
        const env = Math.pow(Math.max(0, 1 - x * 4), 2) + (x > .08 ? Math.pow(Math.max(0, 1 - (x - .08) / .32), 2.5) * .18 : 0);
        return Math.tanh((Math.random() * 2 - 1) * env * 3) * .7;
      });
      warm(buf.getChannelData(0), sr, 7000); return buf;
    }
    case 'vvinyl_crack': {
      const buf = fill(sr, 0.12, (i, x) => {
        const pop = x < .04 ? (Math.random() * 2 - 1) * Math.pow(1 - x / .04, .5) * .9 : 0;
        const crack = (Math.random() > .97 ? (Math.random() * 2 - 1) * Math.pow(1 - x, 1.5) * .4 : 0);
        return pop + crack;
      });
      warm(buf.getChannelData(0), sr, 6000); return buf;
    }
    case 'vtape_hiss': {
      const buf = fill(sr, 0.22, (i, x) => {
        const env = Math.sin(Math.PI * x) * .6 + Math.pow(1 - x, 1.5) * .4;
        return (Math.random() * 2 - 1) * env * .45;
      });
      warm(buf.getChannelData(0), sr, 4500); return buf;
    }
    case 'vecho_snare': {
      const buf = fill(sr, 1.0, (i, x) => {
        let s = 0;
        [[0, 1], [0.25, 0.45], [0.5, 0.2]].forEach(([off, gain]) => {
          const xi = Math.max(0, x - off);
          const env = Math.pow(Math.max(0, 1 - xi * 8), 2);
          s += (Math.random() * 2 - 1) * env * gain + (Math.sin(pi2 * 200 * (i - off * sr) / sr) * Math.pow(Math.max(0, 1 - xi * 12), 4) * gain * .4);
        });
        return s;
      });
      warm(buf.getChannelData(0), sr, 6000); sat(buf.getChannelData(0), 0.2); return buf;
    }
    case 'v808_bass': {
      const buf = fill(sr, 3.5, (i, x) => {
        const f = 50 * Math.pow(1 - Math.pow(x, .15) * .92, 3) + 24;
        const env = Math.pow(1 - x, 0.18);
        const click = x < .02 ? (Math.random() * 2 - 1) * Math.pow(1 - x / .02, 2) * .5 : 0;
        return Math.sin(pi2 * f * i / sr) * env * .98 + click;
      });
      sat(buf.getChannelData(0), 0.25); return buf;
    }
    default: return synthIce(sr, voiceId, 0);
  }
}

function synthTexture(sr, texId, padIdx, bankPitch) {
  const f0 = 440 * Math.pow(2, (bankPitch + padIdx * 1.2) / 12);
  const pi2 = Math.PI * 2;
  const dur = .04 + Math.random() * .06;
  return fill(sr, dur, (i, x) => {
    const env = Math.pow(1 - x, 1.8); let s = 0;
    switch (texId) {
      case 'ping':     s = Math.sin(pi2 * f0 * i / sr) * env * .6 + (Math.random() * 2 - 1) * env * .08; break;
      case 'crackle':  s = (Math.random() * 2 - 1) * env * (Math.random() > .9 ? 1 : .04); break;
      case 'shatter2': s = (Math.random() * 2 - 1) * env * (x < .08 ? 1 : .04 + Math.random() * .08); break;
      case 'drip':     { const f = f0 * 1.8; s = Math.sin(pi2 * f * i / sr * (1 - x * .5)) * Math.pow(1 - x, 3) * .8; break; }
      case 'chime':    { const f1 = f0 * 2, f2 = f1 * 2.76; s = (Math.sin(pi2 * f1 * i / sr) * .5 + Math.sin(pi2 * f2 * i / sr) * .3) * env; break; }
      case 'scrape':   s = (Math.random() * 2 - 1) * Math.pow(1 - x, .4) * .7 * (Math.sin(i * .2) * .4 + .6); break;
      case 'hiss':     s = (Math.random() * 2 - 1) * env * .5 * (x < .3 ? 1 : .3); break;
      case 'tap':      { const f = f0 * 3; s = Math.sin(pi2 * f * i / sr) * Math.pow(1 - x, 5) * .9 + (Math.random() * 2 - 1) * Math.pow(1 - x, 6) * .3; break; }
      case 'snap2':    s = (Math.random() * 2 - 1) * (x < .05 ? Math.random() : 0); break;
      case 'groan':    { const f = f0 * .5; s = Math.sin(pi2 * f * i / sr + Math.sin(pi2 * 3 * i / sr) * .5) * env * .7; break; }
      case 'tinkle':   s = [f0 * 4, f0 * 6.2, f0 * 8.1].reduce((a, f) => a + Math.sin(pi2 * f * i / sr), 0) * env * .25; break;
      case 'crack2':   s = (Math.random() * 2 - 1) * (x < .15 ? Math.pow(1 - x / .15, .3) : .02) * .9; break;
      case 'breath':   s = (Math.random() * 2 - 1) * Math.sin(Math.PI * x) * .5; break;
      case 'melt':     { const f = f0 * (1 + x * .3); s = Math.sin(pi2 * f * i / sr) * Math.sin(Math.PI * x) * .6; break; }
      case 'freeze':   { const f = f0 * 5; s = (Math.sin(pi2 * f * i / sr) + (Math.random() * 2 - 1) * .3) * Math.pow(1 - x, .5) * .5; break; }
      case 'glide':    { const f = f0 * (2 - x); s = Math.sin(pi2 * f * i / sr) * env * .65; break; }
      default:         s = (Math.random() * 2 - 1) * env * .5;
    }
    return s;
  });
}

/* ---------------- バッファキャッシュ ---------------- */

const bufferCache = new Map();

function getBuffer(sampleRate, kit, dataRow, bankId) {
  const voice = KITS[kit].voices[dataRow];
  if (!voice) return null;
  const key = `${sampleRate}|${kit}|${voice.id}|${bankId}`;
  if (!bufferCache.has(key)) {
    const bank = BANKS.find(b => b.id === bankId) || BANKS[0];
    let buf;
    if (kit === 'vapor')        buf = synthVapor(sampleRate, voice.id);
    else if (kit === 'texture') buf = synthTexture(sampleRate, voice.id, dataRow, bank.pitch);
    else                        buf = synthIce(sampleRate, voice.id, bank.pitch);
    bufferCache.set(key, buf);
  }
  return bufferCache.get(key);
}

/* ---------------- 楽器インターフェース実装 ---------------- */

export default {
  id: 'icepad',
  name: 'アイスパッド',
  color: 'var(--c-icepad)',
  hint: '氷の質感のドラムマシン。キットとバンクで音色がガラッと変わる',
  maxRows: 16,
  defaultVol: 0.85,

  defaultParams() {
    return { kit: 'ice', bank: 'glacier', pitch: 0, decay: 0.4, reverb: 0.5, filter: 4000 };
  },
  sanitizeParams(p) {
    if (!KITS[p.kit]) p.kit = 'ice';
    if (!BANKS.some(b => b.id === p.bank)) p.bank = 'glacier';
  },

  getRows(song, params) {
    return KITS[params.kit].voices.map((v, i) => ({ dataRow: i, label: v.label, strong: !!v.strong }));
  },

  // トラック専用チャンネル: input → (dry + convolverリバーブ) → ローパス → 出力
  createChannel(ctx, dest, params) {
    const input = ctx.createGain();
    const mix = ctx.createGain();
    const conv = ctx.createConvolver();
    conv.buffer = makeImpulse(ctx, 2.5, 2.2);
    const wet = ctx.createGain();
    wet.gain.value = params.reverb;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = params.filter;
    input.connect(mix);
    input.connect(conv);
    conv.connect(wet);
    wet.connect(mix);
    mix.connect(filter);
    filter.connect(dest);
    return {
      input,
      update(p) {
        wet.gain.value = p.reverb;
        filter.frequency.value = p.filter;
      },
    };
  },

  noteOn(ctx, channel, dataRow, time, dur, song, params) {
    const buf = getBuffer(ctx.sampleRate, params.kit, dataRow, params.bank);
    if (!buf) return;
    const voice = KITS[params.kit].voices[dataRow];
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = Math.pow(2, params.pitch / 12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(VOICE_GAIN[voice.id] ?? 0.85, time);
    g.gain.setTargetAtTime(0, time + params.decay * 1.2, 0.08);
    src.connect(g).connect(channel.input);
    src.start(time);
  },

  buildControls(container, params, api) {
    const kitOptions = Object.fromEntries(Object.entries(KITS).map(([id, k]) => [id, k.label]));
    makeSelect(container, 'キット', kitOptions, params.kit, (v) => {
      params.kit = v;
      api.refreshGrid(); // 行ラベルが変わる
      api.onChange();
    });
    const bankOptions = Object.fromEntries(BANKS.map(b => [b.id, b.label]));
    makeSelect(container, 'バンク', bankOptions, params.bank, (v) => {
      params.bank = v;
      api.onChange();
    });
    makeSlider(container, 'リバーブ', { min: 0, max: 1, step: 0.01, value: params.reverb, fmt: v => v.toFixed(2) }, (v) => {
      params.reverb = v;
      api.onChange();
    });
    makeSlider(container, 'ピッチ', { min: -12, max: 12, step: 1, value: params.pitch, fmt: v => (v > 0 ? '+' : '') + v }, (v) => {
      params.pitch = v;
      api.onChange();
    });
  },
};
