/* ============================================================
   共通定義: スケール・音名・コードなど
   楽器モジュールとUIの両方から参照される「音楽の知識」を集約
   ============================================================ */

export const MAX_STEPS = 32;

export const NOTE_NAMES = ['ド', 'ド♯', 'レ', 'レ♯', 'ミ', 'ファ', 'ファ♯', 'ソ', 'ソ♯', 'ラ', 'ラ♯', 'シ'];
export const KEY_NAMES  = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

// スケール(使ってよい音)。初心者が音を外さないための仕組み
export const SCALES = {
  penta: [0, 2, 4, 7, 9],           // メジャーペンタトニック
  major: [0, 2, 4, 5, 7, 9, 11],    // メジャー
  minor: [0, 2, 3, 5, 7, 8, 10],    // ナチュラルマイナー
};

// コードトラックで使う4つのコード(ポップスの定番進行が作れる組み合わせ)
export const CHORD_SETS = {
  major: [
    { deg: 0,  minor: false, offsets: [0, 4, 7] },    // I
    { deg: 7,  minor: false, offsets: [7, 11, 14] },  // V
    { deg: 9,  minor: true,  offsets: [9, 12, 16] },  // vi
    { deg: 5,  minor: false, offsets: [5, 9, 12] },   // IV
  ],
  minor: [
    { deg: 0,  minor: true,  offsets: [0, 3, 7] },    // i
    { deg: 8,  minor: false, offsets: [8, 12, 15] },  // ♭VI
    { deg: 3,  minor: false, offsets: [3, 7, 10] },   // ♭III
    { deg: 10, minor: false, offsets: [10, 14, 17] }, // ♭VII
  ],
};

export function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

export function midiToFreq(m) { return 440 * Math.pow(2, (m - 69) / 12); }

// スケール上のn番目の音(度数)→ 半音数
export function scaleOffset(scaleName, degree) {
  const s = SCALES[scaleName];
  const oct = Math.floor(degree / s.length);
  return oct * 12 + s[degree % s.length];
}

/**
 * 音程系トラック共通の行定義を作る。
 * dataRow = 度数(0が最低音)。表示は上が高い音なので降順に並べる。
 * @returns [{ dataRow, midi, label, strong }] 上から順
 */
export function pitchedRows(song, baseMidi, octaves) {
  const s = SCALES[song.scale];
  const count = s.length * octaves + 1;
  const rows = [];
  for (let deg = count - 1; deg >= 0; deg--) {
    const midi = baseMidi + song.key + scaleOffset(song.scale, deg);
    rows.push({ dataRow: deg, midi, label: NOTE_NAMES[midi % 12], strong: deg % s.length === 0 });
  }
  return rows;
}

/** 曲のキー・スケールに応じたコード定義(名前つき) */
export function chordRowsFor(song) {
  const set = CHORD_SETS[song.scale === 'minor' ? 'minor' : 'major'];
  return set.map((ch, i) => ({
    dataRow: i,
    offsets: ch.offsets,
    label: KEY_NAMES[(song.key + ch.deg) % 12] + (ch.minor ? 'm' : ''),
    strong: true,
  }));
}
