// 曲を解析して BPM・拍の位置・波形を求める。DJ機能のビート合わせと波形表示に使う。
//
// 解析は 8kHz モノラルに落としてから行う。キックの検出にも波形の描画にもこれで十分で、
// 5分の曲でも扱う配列が数百KBに収まる。元の 44.1kHz ステレオのまま持つと
// 100MB を超えてしまい、スマホでは落ちる。

const RATE = 8000;
const HOP = 32;                  // 包絡線は 250Hz(1フレーム4ms)
const BPM_MIN = 70;
const BPM_MAX = 180;
const FOLD_LO = 85;              // この範囲に収まるよう倍/半分を折り返す
const FOLD_HI = 170;
const PEAKS = 1400;              // 波形の本数
const TEMPO_SECONDS = 240;       // BPMは長くても頭から4分だけ見る

/**
 * @param {ArrayBuffer} arrayBuffer 音楽ファイルの中身(呼び出し後は使えなくなる)
 * @returns {Promise<{duration:number, peaks:Float32Array, bpm:number, beatOffset:number, confident:boolean}>}
 */
export async function analyzeTrack(arrayBuffer) {
  const ctx = new OfflineAudioContext(1, RATE, RATE);
  const buf = await ctx.decodeAudioData(arrayBuffer);
  const mono = downmix(buf);
  const tempoSlice = mono.length > TEMPO_SECONDS * RATE
    ? mono.subarray(0, TEMPO_SECONDS * RATE)
    : mono;
  return {
    duration: buf.duration,
    peaks: peaksOf(mono),
    ...tempoOf(tempoSlice),
  };
}

function downmix(buf) {
  const n = buf.length;
  const out = new Float32Array(n);
  const ch = buf.numberOfChannels;
  for (let c = 0; c < ch; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < n; i++) out[i] += d[i];
  }
  if (ch > 1) for (let i = 0; i < n; i++) out[i] /= ch;
  return out;
}

/** 表示用の波形。1本あたりの区間で最大の振幅を拾う */
function peaksOf(x) {
  const out = new Float32Array(PEAKS);
  const step = x.length / PEAKS;
  for (let i = 0; i < PEAKS; i++) {
    const from = Math.floor(i * step);
    const to = Math.min(x.length, Math.floor((i + 1) * step));
    let m = 0;
    for (let j = from; j < to; j++) {
      const v = x[j] < 0 ? -x[j] : x[j];
      if (v > m) m = v;
    }
    out[i] = m;
  }
  return out;
}

/** 山の前後の値から頂点を推定し、フレーム未満の精度を出す */
function parabolic(y, i) {
  const a = y[i - 1] ?? y[i];
  const b = y[i];
  const c = y[i + 1] ?? y[i];
  const d = a - 2 * b + c;
  return d === 0 ? i : i - ((c - a) / (2 * d));
}

function tempoOf(x) {
  const fallback = { bpm: 120, beatOffset: 0, confident: false };
  if (x.length < RATE * 4) return fallback;

  // 低音側(キック)だけを残す一次のローパス。拍の手がかりはほぼここにある
  const a = Math.exp((-2 * Math.PI * 180) / RATE);
  let y = 0;
  const frames = Math.floor(x.length / HOP);
  const env = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let s = 0;
    for (let i = f * HOP, e = i + HOP; i < e; i++) {
      y = a * y + (1 - a) * x[i];
      s += y * y;
    }
    env[f] = Math.sqrt(s / HOP);
  }

  // 立ち上がりだけを取り出す(音が大きい所ではなく、音が「始まった」所が拍)
  const onset = new Float32Array(frames);
  let mean = 0;
  for (let f = 1; f < frames; f++) {
    const d = env[f] - env[f - 1];
    if (d > 0) { onset[f] = d; mean += d; }
  }
  mean /= Math.max(1, frames);
  if (mean <= 0) return fallback;
  // 平均を引いておくと、相関が「どのくらい規則的か」だけを見るようになる
  for (let f = 0; f < frames; f++) onset[f] -= mean;

  const fps = RATE / HOP;
  const lagMin = Math.max(2, Math.floor((fps * 60) / BPM_MAX));
  const lagMax = Math.ceil((fps * 60) / BPM_MIN);
  if (frames <= 4 * lagMax) return fallback;

  // 1拍先だけを見ると裏拍に引っ張られるので、2拍先・4拍先とも合うかを重ねて見る
  const score = new Float64Array(lagMax + 2);
  let best = -Infinity;
  let bestLag = 0;
  let scoreSum = 0;
  for (let lag = lagMin; lag <= lagMax; lag++) {
    const last = frames - 4 * lag;
    let s = 0;
    for (let f = 0; f < last; f++) {
      s += onset[f] * (onset[f + lag] + 0.7 * onset[f + 2 * lag] + 0.5 * onset[f + 4 * lag]);
    }
    s /= last;
    score[lag] = s;
    scoreSum += s;
    if (s > best) { best = s; bestLag = lag; }
  }
  if (!bestLag || best <= 0) return fallback;

  const period = parabolic(score, bestLag);        // フレーム単位の1拍
  let bpm = (60 * fps) / period;
  while (bpm < FOLD_LO) bpm *= 2;
  while (bpm > FOLD_HI) bpm /= 2;
  if (bpm < BPM_MIN || bpm > BPM_MAX) return fallback;

  // 拍の位置。1周期ぶんの位相を総当たりで試し、立ち上がりの合計が最大の所を選ぶ
  let bestPhase = 0;
  let bestSum = -Infinity;
  for (let p = 0; p < period; p += 0.25) {
    let s = 0;
    for (let f = p; f < frames; f += period) s += onset[Math.round(f)];
    if (s > bestSum) { bestSum = s; bestPhase = p; }
  }

  const avg = scoreSum / (lagMax - lagMin + 1);
  return {
    bpm: Math.round(bpm * 10) / 10,
    beatOffset: bestPhase / fps,
    // 山が平均よりはっきり高いときだけ「拾えた」と見なす
    confident: avg > 0 ? best / avg > 1.6 : false,
  };
}
