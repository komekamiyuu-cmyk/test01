// 再生中の曲をSNS用のスクショ画像(PNG)として描画・共有する
// カセットは再生画面のSVGと同じ 400x252 座標系で描き、拡大して配置する

const PAPER = '#E8E2D5';
const INK = '#33322E';
const INK2 = '#5C5A54';
const FLAME = '#EE3B12';
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

async function loadImage(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/** 刻印(彫り込みの影 + 上面のハイライト)で文字を打つ */
function emboss(ctx, text, x, y, align = 'left') {
  ctx.textAlign = align;
  ctx.fillStyle = '#131210';
  ctx.fillText(text, x, y + 1);
  ctx.fillStyle = '#6E6A61';
  ctx.fillText(text, x, y);
  ctx.textAlign = 'left';
}

/** 歯付きハブ(金属光沢) */
function drawHub(ctx, cx, cy) {
  const g = ctx.createRadialGradient(cx - 5.3, cy - 5.7, 0, cx - 5.3, cy - 5.7, 32.3);
  g.addColorStop(0, '#DAD5C8');
  g.addColorStop(0.5, '#A6A296');
  g.addColorStop(1, '#6B6860');
  ctx.beginPath();
  ctx.arc(cx, cy, 19, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = '#4E4B44';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = '#131210';
  for (let i = 0; i < 6; i++) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((i * Math.PI) / 3 + 0.4);
    ctx.fillRect(-1.6, -14.5, 3.2, 6);
    ctx.restore();
  }
  ctx.beginPath();
  ctx.arc(cx, cy, 9.5, 0, Math.PI * 2);
  ctx.fill();
}

/** 掘り込みに沈んだネジ */
function drawScrew(ctx, cx, cy) {
  ctx.beginPath();
  ctx.arc(cx, cy, 7.5, 0, Math.PI * 2);
  ctx.fillStyle = '#131210';
  ctx.fill();
  ctx.strokeStyle = 'rgba(110,106,97,0.35)';
  ctx.lineWidth = 1;
  ctx.stroke();

  const g = ctx.createRadialGradient(cx - 1.38, cy - 1.84, 0, cx - 1.38, cy - 1.84, 7.82);
  g.addColorStop(0, '#FF8A5E');
  g.addColorStop(0.55, FLAME);
  g.addColorStop(1, '#8E1C06');
  ctx.beginPath();
  ctx.arc(cx, cy, 4.6, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.fillStyle = 'rgba(122,27,5,0.8)';
  ctx.fillRect(cx - 4.1, cy - 0.7, 8.2, 1.4);
}

/** 巻かれたテープ。半径が変わっても巻き層の縞が同じ比率で伸び縮みする */
function drawPack(ctx, cx, cy, r) {
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  for (const [o, c] of [
    [0, '#141209'], [0.40, '#1B1813'], [0.425, '#3C3427'], [0.45, '#1B1813'],
    [0.585, '#211D16'], [0.605, '#473B2B'], [0.625, '#211D16'],
    [0.765, '#26211A'], [0.785, '#4C3E2D'], [0.805, '#26211A'],
    [0.93, '#2A241C'], [0.955, '#55462F'], [0.975, '#241F19'],
    [0.995, '#3E3427'], [1, '#0B0A08'],
  ]) g.addColorStop(o, c);
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = '#0A0907';
  ctx.lineWidth = 1.1;
  ctx.stroke();
}

/** カセット本体(400x252 座標系。再生中画面のSVGと同じ数値) */
function drawCassette(ctx, track, p, artImg, counter) {
  // ---- シェル(成形プラスチック) ----
  const shell = ctx.createLinearGradient(0, 0, 0, 252);
  shell.addColorStop(0, '#5C584D');
  shell.addColorStop(0.045, '#403D37');
  shell.addColorStop(0.45, '#39362F');
  shell.addColorStop(0.92, '#2A2823');
  shell.addColorStop(1, '#15140F');
  roundRect(ctx, 0, 0, 400, 252, 9);
  ctx.fillStyle = shell;
  ctx.fill();

  const sheen = ctx.createLinearGradient(0, 0, 400, 252);
  sheen.addColorStop(0, 'rgba(255,255,255,0.11)');
  sheen.addColorStop(0.42, 'rgba(255,255,255,0.02)');
  sheen.addColorStop(0.60, 'rgba(255,255,255,0.06)');
  sheen.addColorStop(1, 'rgba(255,255,255,0)');
  roundRect(ctx, 0, 0, 400, 252, 9);
  ctx.fillStyle = sheen;
  ctx.fill();

  roundRect(ctx, 3.5, 3.5, 393, 245, 6.5);
  ctx.strokeStyle = 'rgba(255,255,255,0.09)';
  ctx.lineWidth = 1.4;
  ctx.stroke();
  roundRect(ctx, 0.8, 0.8, 398.4, 250.4, 8.6);
  ctx.strokeStyle = '#131210';
  ctx.lineWidth = 1.6;
  ctx.stroke();

  // 誤消去防止ツメの窪み
  for (const x of [40, 334]) {
    ctx.fillStyle = '#141310';
    ctx.fillRect(x, 0, 26, 8);
    ctx.fillStyle = 'rgba(107,103,94,0.5)';
    ctx.fillRect(x, 7, 26, 1.4);
  }

  // 窓とラベルの間の成形段差
  ctx.fillStyle = 'rgba(21,20,15,0.75)';
  ctx.fillRect(18, 113, 364, 1);
  ctx.fillStyle = 'rgba(107,103,94,0.3)';
  ctx.fillRect(18, 114, 364, 1);

  // ---- テープ窓 ----
  roundRect(ctx, 56, 114, 288, 96, 17);
  ctx.fillStyle = 'rgba(27,26,22,0.85)';
  ctx.fill();
  roundRect(ctx, 60, 118, 280, 88, 14);
  ctx.fillStyle = '#0D0C0A';
  ctx.fill();

  ctx.save();
  roundRect(ctx, 60, 118, 280, 88, 14);
  ctx.clip();
  ctx.fillStyle = '#131210';
  ctx.fillRect(60, 118, 280, 88);
  ctx.beginPath();
  ctx.ellipse(150, 128, 72, 9, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.045)';
  ctx.fill();
  ctx.fillStyle = '#33291D';
  ctx.fillRect(120, 159.5, 160, 5);
  ctx.fillStyle = 'rgba(107,87,58,0.55)';
  ctx.fillRect(120, 159.5, 160, 1.2);
  drawPack(ctx, 130, 162, 20 + 22 * (1 - p));
  drawPack(ctx, 270, 162, 20 + 22 * p);
  ctx.restore();

  drawHub(ctx, 130, 162);
  drawHub(ctx, 270, 162);

  // 窓のアクリル(映り込み)と縁
  const glass = ctx.createLinearGradient(60, 118, 298, 206);
  glass.addColorStop(0, 'rgba(255,255,255,0.34)');
  glass.addColorStop(0.36, 'rgba(255,255,255,0.05)');
  glass.addColorStop(0.54, 'rgba(255,255,255,0.17)');
  glass.addColorStop(1, 'rgba(255,255,255,0.02)');
  roundRect(ctx, 60, 118, 280, 88, 14);
  ctx.fillStyle = glass;
  ctx.fill();
  roundRect(ctx, 60.7, 118.7, 278.6, 86.6, 13.3);
  ctx.strokeStyle = '#0A0908';
  ctx.lineWidth = 1.4;
  ctx.stroke();
  roundRect(ctx, 59, 117, 282, 90, 15);
  ctx.strokeStyle = 'rgba(110,106,96,0.45)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // ---- 下端(ヘッド開口部) ----
  ctx.fillStyle = '#3A3125';
  ctx.fillRect(112, 207, 176, 4);
  ctx.beginPath();
  ctx.moveTo(104, 252);
  ctx.lineTo(104, 218);
  ctx.quadraticCurveTo(104, 212, 110, 212);
  ctx.lineTo(290, 212);
  ctx.quadraticCurveTo(296, 212, 296, 218);
  ctx.lineTo(296, 252);
  ctx.closePath();
  ctx.fillStyle = '#262421';
  ctx.fill();
  ctx.strokeStyle = '#15140F';
  ctx.lineWidth = 1.4;
  ctx.stroke();

  ctx.fillStyle = '#0D0C0A';
  ctx.fillRect(172, 218, 56, 34);
  ctx.fillRect(150, 218, 13, 34);
  ctx.fillRect(237, 218, 13, 34);
  for (const [cx, cy, r] of [[132, 234, 9], [268, 234, 9], [114, 240, 3.5], [286, 240, 3.5]]) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#55514A';
  ctx.fillRect(186, 224, 28, 9);
  ctx.fillStyle = 'rgba(122,116,105,0.7)';
  ctx.fillRect(186, 224, 28, 2.5);

  // ---- シェルの刻印とリブ ----
  ctx.font = util(6.5);
  ctx.letterSpacing = '1px';
  emboss(ctx, 'COMPACT CASSETTE', 22, 230);
  emboss(ctx, 'TYPE I  NORMAL', 378, 230, 'right');
  ctx.letterSpacing = '0px';

  ctx.lineWidth = 1.2;
  for (const [x1, x2] of [[22, 98], [302, 378]]) {
    for (const y of [238, 243]) {
      ctx.strokeStyle = '#15140F';
      ctx.beginPath();
      ctx.moveTo(x1, y); ctx.lineTo(x2, y);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(110,106,97,0.4)';
      ctx.beginPath();
      ctx.moveTo(x1, y + 1.4); ctx.lineTo(x2, y + 1.4);
      ctx.stroke();
    }
  }

  // ---- ネジ ----
  for (const [cx, cy] of [[13, 13], [387, 13], [13, 239], [387, 239]]) drawScrew(ctx, cx, cy);

  // ---- 貼られた紙ラベル ----
  const paper = ctx.createLinearGradient(24, 10, 147.2, 110);
  paper.addColorStop(0, '#F7F2E9');
  paper.addColorStop(0.5, '#EAE4D8');
  paper.addColorStop(1, '#D9D1C0');
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = 4;
  ctx.shadowOffsetY = 2.5;
  roundRect(ctx, 24, 10, 352, 100, 3);
  ctx.fillStyle = paper;
  ctx.fill();
  ctx.restore();

  ctx.save();
  roundRect(ctx, 24, 10, 352, 100, 3);
  ctx.clip();
  STRIPES.forEach((c, i) => {
    ctx.fillStyle = c;
    ctx.fillRect(24 + i * 58.67, 10, 58.9, 5);
  });
  ctx.fillStyle = 'rgba(183,175,158,0.5)';
  ctx.fillRect(24, 15, 352, 1);
  ctx.fillStyle = 'rgba(201,192,172,0.35)';
  ctx.fillRect(24, 96, 352, 14);
  ctx.restore();
  roundRect(ctx, 24.6, 10.6, 350.8, 98.8, 2.6);
  ctx.strokeStyle = '#B7AF9E';
  ctx.lineWidth = 1.2;
  ctx.stroke();

  // ジャケット(無いときは罫線)
  ctx.fillStyle = '#DCD5C6';
  ctx.fillRect(32, 24, 72, 72);
  if (artImg) {
    ctx.drawImage(artImg, 32, 24, 72, 72);
  } else {
    ctx.strokeStyle = '#8A867C';
    ctx.lineWidth = 1.4;
    for (const [y, x2] of [[42, 96], [52, 96], [62, 96], [72, 96], [82, 78]]) {
      ctx.beginPath();
      ctx.moveTo(40, y); ctx.lineTo(x2, y);
      ctx.stroke();
    }
  }
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.4;
  ctx.strokeRect(32, 24, 72, 72);

  // 面表示
  ctx.fillStyle = FLAME;
  ctx.fillRect(344, 24, 26, 26);
  ctx.fillStyle = '#F7F2E9';
  ctx.font = display(17);
  ctx.textAlign = 'center';
  ctx.fillText('A', 357, 44);
  ctx.textAlign = 'left';

  // ---- 曲名(ラベルの主役。再生中画面のHTMLと同じ位置) ----
  const lx = 120, lw = 218;
  ctx.fillStyle = INK;
  ctx.font = display(19);
  const lines = wrapLines(ctx, track.title, lw, 2);
  lines.forEach((line, i) => ctx.fillText(line, lx, 41 + i * 20));
  ctx.fillStyle = INK2;
  ctx.font = util(9.5);
  ctx.letterSpacing = '1px';
  ctx.fillText(ellipsize(ctx, track.artist || 'UNKNOWN ARTIST', lw), lx, 41 + (lines.length - 1) * 20 + 16);
  ctx.letterSpacing = '0px';

  // ラベル下段(罫線 + シリアル + カウンター)
  ctx.strokeStyle = '#B7AF9E';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(120, 99); ctx.lineTo(370, 99);
  ctx.stroke();
  ctx.fillStyle = FLAME;
  ctx.font = util(7.5);
  ctx.letterSpacing = '1px';
  ctx.fillText(serialOf(track), 120, 107);
  ctx.fillStyle = INK2;
  ctx.letterSpacing = '1.4px';
  ctx.textAlign = 'right';
  ctx.fillText(`SIDE A / COUNTER ${counter}`, 370, 107);
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
  roundRect(ctx, cx0 + 14, cy0 + 14, cw, chh, 9 * scale);
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
