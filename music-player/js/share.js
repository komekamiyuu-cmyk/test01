// 再生中の曲をSNS用のスクショ画像(PNG)として描画・共有する
// カセットは再生画面のSVGと同じ 400x252 座標系で描き、拡大して配置する

const PAPER = '#E8E2D5';
const INK = '#33322E';
const INK2 = '#5C5A54';
const FLAME = '#EE3B12';
const SHELL = '#3A3936';
const STRIPES = ['#F5B415', '#F0930E', '#F07C10', '#E2371F', '#B32036', '#7B1F42'];

/** ラベルのシリアル番号は曲名から決定的に組み立てる(同じ曲なら常に同じ番号) */
export function serialOf(track) {
  let h = 0;
  for (const ch of track.key ?? track.title ?? '') h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const A = 'ABCDEFGHJKLMNPRSTUVWXYZ';
  const l = (n) => A[(h >>> n) % A.length];
  return `${l(3)}${l(7)}${l(11)}R-${String(h % 10000).padStart(4, '0')}-CA${(h % 90) + 10}`;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function ellipsize(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  while (text.length > 1 && ctx.measureText(text + '…').width > maxW) text = text.slice(0, -1);
  return text + '…';
}

/** 指定幅で折り返し、行数を超えた分は最終行を省略記号で締める */
function wrapLines(ctx, text, maxW, maxLines) {
  const lines = [];
  let rest = text || '';
  while (rest && lines.length < maxLines) {
    if (ctx.measureText(rest).width <= maxW) { lines.push(rest); rest = ''; break; }
    let cut = rest.length;
    while (cut > 1 && ctx.measureText(rest.slice(0, cut)).width > maxW) cut--;
    if (lines.length === maxLines - 1) {
      lines.push(ellipsize(ctx, rest, maxW));
      rest = '';
    } else {
      lines.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
  }
  return lines.length ? lines : [''];
}

const display = (size) => `${size}px 'Archivo Black', 'Arial Black', sans-serif`;
const util = (size, w = 500) => `${w} ${size}px Oswald, 'Arial Narrow', sans-serif`;

// 歯付きハブ
function drawHub(ctx, cx, cy) {
  ctx.beginPath();
  ctx.arc(cx, cy, 13, 0, Math.PI * 2);
  ctx.fillStyle = '#98958E';
  ctx.fill();
  ctx.fillStyle = '#2B2A27';
  for (let i = 0; i < 6; i++) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((i * Math.PI) / 3 + 0.4);
    ctx.fillRect(-1.4, -12.5, 2.8, 5.5);
    ctx.restore();
  }
  ctx.beginPath();
  ctx.arc(cx, cy, 6, 0, Math.PI * 2);
  ctx.fill();
}

async function loadImage(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/** カセット本体(400x252 座標系) */
function drawCassette(ctx, track, p, artImg, counter) {
  // ---- シェル(メカ部) ----
  roundRect(ctx, 0, 0, 400, 252, 10);
  ctx.fillStyle = SHELL;
  ctx.fill();

  // 成形のリブ
  ctx.strokeStyle = '#4A4844';
  ctx.lineWidth = 2;
  for (const y of [20, 28, 226, 234]) {
    ctx.beginPath();
    ctx.moveTo(52, y);
    ctx.lineTo(196, y);
    ctx.stroke();
  }

  // 縦組みテキスト
  ctx.save();
  ctx.translate(30, 212);
  ctx.rotate(-Math.PI / 2);
  ctx.fillStyle = '#6B6862';
  ctx.font = util(10);
  ctx.letterSpacing = '3px';
  ctx.fillText('COMPACT CASSETTE', 0, 0);
  ctx.letterSpacing = '0px';
  ctx.restore();

  // ---- テープ窓(淡いシアンの覗き窓) ----
  roundRect(ctx, 44, 84, 156, 88, 44);
  ctx.fillStyle = '#C8DDE0';
  ctx.fill();
  ctx.save();
  roundRect(ctx, 44, 84, 156, 88, 44);
  ctx.clip();
  ctx.fillStyle = FLAME;
  ctx.fillRect(52, 84, 19, 88);
  ctx.fillStyle = '#2B2A27';
  ctx.fillRect(84, 124, 76, 8);
  ctx.beginPath();
  ctx.arc(84, 128, 20 + 16 * (1 - p), 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(160, 128, 20 + 16 * p, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  drawHub(ctx, 84, 128);
  drawHub(ctx, 160, 128);

  // ヘッド開口部
  ctx.fillStyle = '#2B2A27';
  ctx.beginPath();
  ctx.moveTo(62, 252); ctx.lineTo(182, 252); ctx.lineTo(170, 206); ctx.lineTo(74, 206);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#141413';
  for (const cx of [96, 148]) {
    ctx.beginPath();
    ctx.arc(cx, 232, 6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillRect(112, 214, 20, 12);

  // 赤いネジ
  for (const cy of [20, 232]) {
    ctx.beginPath();
    ctx.arc(20, cy, 8, 0, Math.PI * 2);
    ctx.fillStyle = '#2B2A27';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(20, cy, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = FLAME;
    ctx.fill();
  }

  // ---- ラベル面(切り欠き付き) ----
  ctx.beginPath();
  ctx.moveTo(214, 0);
  ctx.lineTo(390, 0);
  ctx.quadraticCurveTo(400, 0, 400, 10);
  ctx.lineTo(400, 242);
  ctx.quadraticCurveTo(400, 252, 390, 252);
  ctx.lineTo(214, 252);
  ctx.lineTo(214, 146);
  ctx.quadraticCurveTo(204, 138, 214, 128);
  ctx.closePath();
  ctx.fillStyle = PAPER;
  ctx.fill();

  // タグ
  ctx.fillStyle = INK2;
  ctx.font = util(6);
  ctx.letterSpacing = '1.1px';
  ctx.textAlign = 'left';
  ctx.fillText('PLAYER SYSTEM', 228, 13);
  ctx.letterSpacing = '0px';
  ctx.fillStyle = FLAME;
  ctx.fillRect(228, 18, 34, 22);
  ctx.fillStyle = PAPER;
  ctx.font = display(13);
  ctx.textAlign = 'center';
  ctx.fillText('CP', 245, 34);
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.arc(272, 34, 3.5, 0, Math.PI * 2);
  ctx.fill();

  // ハッチング(斜めストライプ)
  ctx.save();
  ctx.beginPath();
  ctx.rect(286, 18, 100, 22);
  ctx.clip();
  ctx.fillStyle = FLAME;
  ctx.transform(1, 0, -Math.tan(0.35), 1, 0, 0);
  for (const x of [286, 308, 330, 352, 374]) ctx.fillRect(x + 12, 10, 13, 38);
  ctx.restore();

  // ---- 曲名(ラベル面の主役) ----
  ctx.textAlign = 'left';
  const lx = 228, lw = 158;
  ctx.fillStyle = INK;
  ctx.font = display(22);
  // 曲名は再生中画面と同じく2行まで
  const lines = wrapLines(ctx, track.title, lw, 2);
  const firstY = lines.length > 1 ? 62 : 74;
  lines.forEach((line, i) => ctx.fillText(line, lx, firstY + i * 23));
  ctx.fillStyle = INK2;
  ctx.font = util(11);
  ctx.letterSpacing = '1px';
  ctx.fillText(ellipsize(ctx, track.artist || 'UNKNOWN ARTIST', lw), lx, 100);
  ctx.letterSpacing = '0px';

  // ジャケットと罫線(再生中画面と同じ配置にする)
  ctx.strokeStyle = INK2;
  ctx.lineWidth = 1.6;
  if (artImg) {
    ctx.drawImage(artImg, 228, 116, 58, 58);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.6;
    ctx.strokeRect(228, 116, 58, 58);
    ctx.strokeStyle = INK2;
    ctx.lineWidth = 1.6;
    for (const y of [126, 134, 142, 150, 164]) {
      ctx.beginPath();
      ctx.moveTo(296, y);
      ctx.lineTo(386, y);
      ctx.stroke();
    }
  } else {
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      ctx.moveTo(228, 150 + i * 6);
      ctx.lineTo(386, 150 + i * 6);
      ctx.stroke();
    }
  }

  // シリアル番号
  ctx.fillStyle = FLAME;
  ctx.font = util(8, 600);
  ctx.letterSpacing = '1.3px';
  ctx.fillText('SERIAL NUMBER', 228, 192);
  ctx.font = util(8.5);
  ctx.letterSpacing = '1px';
  ctx.fillText(serialOf(track), 228, 204);
  ctx.letterSpacing = '0px';

  // SIDE A + 巨大な A
  ctx.save();
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = INK;
  ctx.font = display(52);
  ctx.textAlign = 'right';
  ctx.fillText('A', 386, 242);
  ctx.restore();
  ctx.textAlign = 'left';
  ctx.fillStyle = INK;
  ctx.font = util(11, 600);
  ctx.letterSpacing = '2px';
  ctx.fillText('SIDE A', 228, 240);
  ctx.letterSpacing = '0px';
  ctx.fillStyle = FLAME;
  ctx.beginPath();
  ctx.moveTo(300, 228); ctx.lineTo(316, 228); ctx.lineTo(308, 240);
  ctx.closePath();
  ctx.fill();

  // カウンター(テープ位置)
  ctx.fillStyle = INK2;
  ctx.font = util(7);
  ctx.letterSpacing = '1.4px';
  ctx.textAlign = 'right';
  ctx.fillText(`COUNTER ${counter}`, 386, 192);
  ctx.letterSpacing = '0px';
  ctx.textAlign = 'left';
}

/**
 * 再生中の曲情報からシェア用画像(1080x1080 PNG)を作る。
 * @returns {Promise<Blob>}
 */
export async function drawShareCard(track, progress, counter = '000') {
  const S = 1080;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d');

  // 埋め込み書体の読み込みを待ってから描く(待たないとフォールバックで焼き付いてしまう)
  try { await document.fonts.ready; } catch { /* 未対応環境ではそのまま描く */ }

  // 地
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, S, S);

  // 上部: 見出し + ストライプ帯
  ctx.fillStyle = FLAME;
  ctx.fillRect(64, 96, 96, 10);
  ctx.fillStyle = INK;
  ctx.font = display(58);
  ctx.textAlign = 'left';
  ctx.fillText('NOW PLAYING', 64, 176);
  ctx.fillStyle = INK2;
  ctx.font = util(22);
  ctx.letterSpacing = '6px';
  ctx.fillText('AUDIO COMPACT CASSETTE / TYPE-Ⅰ', 66, 212);
  ctx.letterSpacing = '0px';

  const bandW = (S - 128) / STRIPES.length;
  STRIPES.forEach((c, i) => {
    ctx.fillStyle = c;
    ctx.fillRect(64 + i * bandW, 240, bandW + 1, 18);
  });

  const artImg = track.artUrl ? await loadImage(track.artUrl) : null;
  const p = Math.min(Math.max(progress || 0, 0), 1);

  // カセット(400x252 → 2.38倍、ハードシャドウ付き)
  const scale = 2.38;
  const cw = 400 * scale, chh = 252 * scale;
  const cx0 = (S - cw) / 2, cy0 = 330;
  ctx.fillStyle = INK;
  roundRect(ctx, cx0 + 14, cy0 + 14, cw, chh, 10 * scale);
  ctx.fill();

  ctx.save();
  ctx.translate(cx0, cy0);
  ctx.scale(scale, scale);
  drawCassette(ctx, track, p, artImg, counter);
  ctx.restore();

  // フッター
  ctx.fillStyle = INK;
  ctx.fillRect(64, S - 132, S - 128, 3);
  ctx.font = util(24, 600);
  ctx.letterSpacing = '3px';
  ctx.textAlign = 'left';
  ctx.fillText('CASSETTE PLAYER', 64, S - 92);
  ctx.fillStyle = INK2;
  ctx.textAlign = 'right';
  ctx.fillText(new Date().toLocaleDateString('ja-JP'), S - 64, S - 92);
  ctx.letterSpacing = '0px';

  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}
