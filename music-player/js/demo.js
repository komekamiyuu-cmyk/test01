// デモ曲。ファイルを一切用意しなくても、アプリの全機能を試せるようにするためのもの。
//
// 音もジャケットもその場で合成するので、外部ファイルも通信も要らない。
// 埋め込み枠の中などファイル選択が使えない環境でも動作確認ができる。

const RATE = 16000;

// ---------- 音を作る ----------

function wavBlob(samples) {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (off, s) => [...s].forEach((c, i) => v.setUint8(off + i, c.charCodeAt(0)));

  str(0, 'RIFF');
  v.setUint32(4, 36 + samples.length * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);   // PCM
  v.setUint16(22, 1, true);   // モノラル
  v.setUint32(24, RATE, true);
  v.setUint32(28, RATE * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, samples.length * 2, true);

  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s * 32767, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

const noteHz = (semitone) => 440 * Math.pow(2, semitone / 12);

/**
 * 音階の中から音を選んで並べ、簡単な音色で鳴らす。
 * 曲ごとに音階・速さ・音色を変えているので、聴き分けられる。
 */
function renderTune({ scale, root, bpm, seconds, timbre, seed }) {
  const total = Math.floor(RATE * seconds);
  const out = new Float32Array(total);
  const beat = 60 / bpm;
  const steps = Math.floor(seconds / (beat / 2));

  // 同じ曲なら毎回同じ並びになるよう、簡単な擬似乱数を使う
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

  for (let i = 0; i < steps; i++) {
    const degree = scale[Math.floor(rnd() * scale.length)];
    const octave = rnd() < 0.25 ? 12 : 0;
    const freq = noteHz(root + degree + octave);
    const start = Math.floor(i * (beat / 2) * RATE);
    const len = Math.floor((beat / 2) * RATE * 0.95);

    for (let n = 0; n < len && start + n < total; n++) {
      const t = n / RATE;
      const env = Math.exp(-t * timbre.decay) * Math.min(1, t * 400); // 立ち上がりを丸めて雑音を防ぐ
      let v = Math.sin(2 * Math.PI * freq * t) * timbre.fund;
      v += Math.sin(2 * Math.PI * freq * 2 * t) * timbre.second;
      v += Math.sin(2 * Math.PI * freq * 3 * t) * timbre.third;
      out[start + n] += v * env * 0.32;
    }
  }

  // 低音を重ねて曲らしくする
  const bars = Math.floor(seconds / (beat * 2));
  for (let i = 0; i < bars; i++) {
    const freq = noteHz(root + scale[i % scale.length] - 24);
    const start = Math.floor(i * beat * 2 * RATE);
    const len = Math.floor(beat * 2 * RATE * 0.9);
    for (let n = 0; n < len && start + n < total; n++) {
      const t = n / RATE;
      const env = Math.exp(-t * 1.2) * Math.min(1, t * 200);
      out[start + n] += Math.sin(2 * Math.PI * freq * t) * env * 0.22;
    }
  }

  // 最後を絞って、曲の終わりでぶつっと切れないようにする
  const fade = Math.floor(RATE * 0.4);
  for (let n = 0; n < fade; n++) out[total - 1 - n] *= n / fade;

  return wavBlob(out);
}

// ---------- ジャケットを作る ----------

function coverBlob({ letter, band, ground, ink }) {
  const S = 400;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const x = c.getContext('2d');

  x.fillStyle = ground;
  x.fillRect(0, 0, S, S);

  // 上部のストライプ帯(アプリ全体と同じ意匠)
  const w = S / band.length;
  band.forEach((col, i) => {
    x.fillStyle = col;
    x.fillRect(i * w, 40, w + 1, 34);
  });

  // 大きな一文字
  x.fillStyle = ink;
  x.font = "700 250px 'Archivo Black', 'Arial Black', sans-serif";
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText(letter, S / 2, S / 2 + 40);

  // 斜めのハッチング
  x.save();
  x.beginPath();
  x.rect(0, S - 60, S, 60);
  x.clip();
  x.fillStyle = band[3];
  x.transform(1, 0, -0.4, 1, 0, 0);
  for (let i = 0; i < 14; i++) x.fillRect(i * 44 + 40, S - 60, 22, 60);
  x.restore();

  return new Promise((resolve) => c.toBlob(resolve, 'image/png'));
}

const BAND = ['#F5B415', '#F0930E', '#F07C10', '#E2371F', '#B32036', '#7B1F42'];

const SONGS = [
  { title: 'ネオンの夜', artist: 'ナイトクルーズ', album: 'ミッドナイト・テープ', genre: 'Electronic',
    scale: [0, 2, 3, 5, 7, 10], root: -5, bpm: 104, timbre: { decay: 4.5, fund: 1, second: 0.3, third: 0.1 }, seed: 7 },
  { title: '雨上がりの街', artist: 'ナイトクルーズ', album: 'ミッドナイト・テープ', genre: 'Electronic',
    scale: [0, 2, 4, 7, 9], root: -2, bpm: 88, timbre: { decay: 3.2, fund: 1, second: 0.18, third: 0.05 }, seed: 21 },
  { title: '氷の遊歩道', artist: 'グレイシャー', album: 'フローズン', genre: 'Ambient',
    scale: [0, 3, 5, 7, 10], root: -9, bpm: 72, timbre: { decay: 2.0, fund: 1, second: 0.5, third: 0.22 }, seed: 44 },
  { title: 'レトロ・ドライヴ', artist: 'グレイシャー', album: 'フローズン', genre: 'City Pop',
    scale: [0, 2, 4, 5, 7, 9, 11], root: 0, bpm: 118, timbre: { decay: 5.5, fund: 1, second: 0.4, third: 0.15 }, seed: 92 },
];

/**
 * デモ曲を組み立てて、読み込み済みトラックと同じ形で返す。
 * @returns {Promise<Array>}
 */
export async function buildDemoTracks() {
  const covers = {
    'ミッドナイト・テープ': await coverBlob({ letter: 'M', band: BAND, ground: '#33322E', ink: '#E8E2D5' }),
    'フローズン': await coverBlob({ letter: 'F', band: BAND, ground: '#C8DDE0', ink: '#33322E' }),
  };
  const coverUrls = Object.fromEntries(
    Object.entries(covers).map(([k, blob]) => [k, blob ? URL.createObjectURL(blob) : null]),
  );

  return SONGS.map((song, i) => {
    const audio = renderTune({ ...song, seconds: 14 });
    return {
      key: `demo:${i}`,
      file: null,
      url: URL.createObjectURL(audio),
      title: song.title,
      artist: song.artist,
      album: song.album,
      genre: song.genre,
      artUrl: coverUrls[song.album] ?? null,
    };
  });
}
