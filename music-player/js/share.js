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

/**
 * 表面のざらつき。これが無いと、どれだけ陰影を足しても図に見える。
 * SVG側の feTurbulence にあたるものを、タイル1枚を作って敷き詰めることで用意する。
 */
let grainTile = null;
function grain(ctx) {
  if (!grainTile) {
    const N = 96;
    const c = document.createElement('canvas');
    c.width = N;
    c.height = N;
    const g = c.getContext('2d');
    const img = g.createImageData(N, N);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 90 + Math.random() * 76;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    grainTile = c;
  }
  return ctx.createPattern(grainTile, 'repeat');
}

/** ぼかした影を一枚落とす */
function soft(ctx, draw, color, blur, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
  ctx.shadowOffsetX = 2000;   // 影だけを見せたいので、本体は画面の外で描く
  ctx.translate(-2000, 0);
  draw();
  ctx.restore();
}

/** 刻印(彫り込みの影 + 上面のハイライト)で文字を打つ */
function emboss(ctx, text, x, y, align = 'left') {
  ctx.textAlign = align;
  ctx.fillStyle = '#121110';
  ctx.fillText(text, x, y + 1);
  ctx.fillStyle = '#6E6A61';
  ctx.fillText(text, x, y);
  ctx.textAlign = 'left';
}

/** 歯付きハブ(金属光沢) */
function drawHub(ctx, cx, cy) {
  const g = ctx.createRadialGradient(cx - 5.3, cy - 5.7, 0, cx - 5.3, cy - 5.7, 32.3);
  g.addColorStop(0, '#DED9CC');
  g.addColorStop(0.45, '#A6A296');
  g.addColorStop(1, '#63605A');
  ctx.beginPath();
  ctx.arc(cx, cy, 19, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = '#4A473F';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = '#121110';
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

/** テープを送るガイドローラー */
function drawRoller(ctx, cx, cy) {
  const g = ctx.createRadialGradient(cx - 1.5, cy - 2, 0, cx - 1.5, cy - 2, 8.5);
  g.addColorStop(0, '#C6C0B2');
  g.addColorStop(0.55, '#7E7A71');
  g.addColorStop(1, '#3A3832');
  ctx.beginPath();
  ctx.arc(cx, cy, 5, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy, 1.9, 0, Math.PI * 2);
  ctx.fillStyle = '#141310';
  ctx.fill();
}

/** 掘り込みに沈んだ十字ネジ */
function drawScrew(ctx, cx, cy) {
  ctx.beginPath();
  ctx.arc(cx, cy, 7.5, 0, Math.PI * 2);
  ctx.fillStyle = '#121110';
  ctx.fill();
  ctx.strokeStyle = 'rgba(110,106,97,0.3)';
  ctx.lineWidth = 1;
  ctx.stroke();

  const g = ctx.createRadialGradient(cx - 1.5, cy - 2, 0, cx - 1.5, cy - 2, 8.6);
  g.addColorStop(0, '#CFC9BB');
  g.addColorStop(0.45, '#8B877D');
  g.addColorStop(1, '#3B3832');
  ctx.beginPath();
  ctx.arc(cx, cy, 4.8, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.fillStyle = '#2A2823';
  ctx.fillRect(cx - 4.5, cy - 0.75, 9, 1.5);
  ctx.fillRect(cx - 0.75, cy - 4.5, 1.5, 9);
}

/** 巻かれたテープ。半径が変わっても巻き層の縞が同じ比率で伸び縮みする */
function drawPack(ctx, cx, cy, r) {
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  for (const [o, c] of [
    [0, '#141209'], [0.40, '#221E17'], [0.425, '#4A4030'], [0.45, '#221E17'],
    [0.585, '#29241C'], [0.605, '#574836'], [0.625, '#29241C'],
    [0.765, '#2E281F'], [0.785, '#5E4D39'], [0.805, '#2E281F'],
    [0.93, '#332C22'], [0.955, '#6A573B'], [0.975, '#241F19'],
    [0.995, '#4A3E2D'], [1, '#0B0A08'],
  ]) g.addColorStop(o, c);
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = '#0A0907';
  ctx.lineWidth = 1.1;
  ctx.stroke();

  // 巻いた面に乗る照り(SVGの packSheen と同じく、半径に対する比率で置く)
  const fx = cx + (0.34 - 0.5) * 2 * r;
  const fy = cy + (0.26 - 0.5) * 2 * r;
  const s = ctx.createRadialGradient(fx, fy, 0, fx, fy, r * 1.24);
  s.addColorStop(0, 'rgba(255,255,255,0.11)');
  s.addColorStop(0.5, 'rgba(255,255,255,0.035)');
  s.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = s;
  ctx.fill();
}

/** カセット本体(400x252 座標系。再生中画面のSVGと同じ数値) */
function drawCassette(ctx, track, p, artImg, counter) {
  // ---- シェル(成形プラスチック) ----
  const shell = ctx.createLinearGradient(0, 0, 60, 252);
  shell.addColorStop(0, '#5E5A4F');
  shell.addColorStop(0.04, '#413E37');
  shell.addColorStop(0.30, '#3B382F');
  shell.addColorStop(0.72, '#312E28');
  shell.addColorStop(0.94, '#26241F');
  shell.addColorStop(1, '#13120E');
  roundRect(ctx, 0, 0, 400, 252, 9);
  ctx.fillStyle = shell;
  ctx.fill();

  const sheen = ctx.createLinearGradient(0, 0, 400, 252);
  sheen.addColorStop(0, 'rgba(255,255,255,0.12)');
  sheen.addColorStop(0.30, 'rgba(255,255,255,0.02)');
  sheen.addColorStop(0.52, 'rgba(255,255,255,0.07)');
  sheen.addColorStop(0.66, 'rgba(255,255,255,0.01)');
  sheen.addColorStop(1, 'rgba(255,255,255,0)');
  roundRect(ctx, 0, 0, 400, 252, 9);
  ctx.fillStyle = sheen;
  ctx.fill();

  ctx.save();
  roundRect(ctx, 0, 0, 400, 252, 9);
  ctx.clip();
  // 上面に落ちる光
  ctx.save();
  ctx.filter = 'blur(6px)';
  ctx.beginPath();
  ctx.ellipse(196, 3, 150, 9, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  ctx.fill();
  ctx.restore();
  // 成形のざらつき
  ctx.save();
  ctx.globalCompositeOperation = 'overlay';
  ctx.globalAlpha = 0.08;
  ctx.fillStyle = grain(ctx);
  ctx.fillRect(0, 0, 400, 252);
  ctx.restore();
  ctx.restore();

  // 上下ハーフの合わせ目
  roundRect(ctx, 5, 5, 390, 242, 5.5);
  ctx.strokeStyle = 'rgba(16,15,12,0.75)';
  ctx.lineWidth = 1;
  ctx.stroke();
  roundRect(ctx, 5, 6.2, 390, 242, 5.5);
  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.stroke();
  roundRect(ctx, 0.8, 0.8, 398.4, 250.4, 8.6);
  ctx.strokeStyle = '#121110';
  ctx.lineWidth = 1.6;
  ctx.stroke();

  // 誤消去防止ツメの窪み
  for (const x of [40, 334]) {
    ctx.fillStyle = '#131210';
    ctx.fillRect(x, 0, 26, 8);
    ctx.fillStyle = 'rgba(107,103,94,0.5)';
    ctx.fillRect(x, 7, 26, 1.4);
  }

  // ---- テープ窓 ----
  soft(ctx, () => {
    roundRect(ctx, 54, 112, 292, 100, 17);
    ctx.fillStyle = '#0F0E0C';
    ctx.fill();
  }, 'rgba(15,14,12,0.7)', 6.4);

  const chamfer = ctx.createLinearGradient(83, 112, 258, 211);
  chamfer.addColorStop(0, '#948E81');
  chamfer.addColorStop(0.42, '#3C3931');
  chamfer.addColorStop(1, '#100F0C');
  roundRect(ctx, 54.5, 112.5, 291, 99, 16.5);
  ctx.strokeStyle = chamfer;
  ctx.lineWidth = 3;
  ctx.stroke();

  roundRect(ctx, 56, 114, 288, 96, 15);
  ctx.fillStyle = '#0C0B09';
  ctx.fill();

  ctx.save();
  roundRect(ctx, 56, 114, 288, 96, 15);
  ctx.clip();
  ctx.fillStyle = '#1A1714';
  ctx.fillRect(56, 114, 288, 96);
  ctx.beginPath();
  ctx.ellipse(150, 122, 76, 8, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.035)';
  ctx.fill();

  // テープの経路: 巻きから下のガイドへ降り、前面を横切る
  ctx.strokeStyle = '#2E2418';
  ctx.lineWidth = 3.6;
  ctx.beginPath();
  ctx.moveTo(78, 199); ctx.lineTo(128, 156);
  ctx.moveTo(322, 199); ctx.lineTo(272, 156);
  ctx.stroke();

  drawPack(ctx, 128, 156, 20 + 16 * (1 - p));
  drawPack(ctx, 272, 156, 20 + 16 * p);

  ctx.strokeStyle = '#2E2418';
  ctx.lineWidth = 3.6;
  ctx.beginPath();
  ctx.moveTo(78, 199); ctx.lineTo(322, 199);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(110,90,60,0.55)';
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.moveTo(78, 197.6); ctx.lineTo(322, 197.6);
  ctx.stroke();
  drawRoller(ctx, 78, 199);
  drawRoller(ctx, 322, 199);

  // 掘り込みの内側に回り込む影
  ctx.save();
  ctx.filter = 'blur(6px)';
  roundRect(ctx, 56, 114, 288, 96, 15);
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.lineWidth = 11;
  ctx.stroke();
  ctx.restore();
  ctx.restore();

  drawHub(ctx, 128, 156);
  drawHub(ctx, 272, 156);

  // 窓のアクリル(映り込み)と縁
  const glass = ctx.createLinearGradient(56, 114, 301, 210);
  glass.addColorStop(0, 'rgba(255,255,255,0.13)');
  glass.addColorStop(0.10, 'rgba(255,255,255,0.02)');
  glass.addColorStop(0.455, 'rgba(255,255,255,0.012)');
  glass.addColorStop(0.485, 'rgba(255,255,255,0.085)');
  glass.addColorStop(0.515, 'rgba(255,255,255,0.012)');
  glass.addColorStop(1, 'rgba(255,255,255,0.006)');
  roundRect(ctx, 56, 114, 288, 96, 15);
  ctx.fillStyle = glass;
  ctx.fill();
  roundRect(ctx, 56.7, 114.7, 286.6, 94.6, 14.3);
  ctx.strokeStyle = '#0A0908';
  ctx.lineWidth = 1.4;
  ctx.stroke();

  // ---- 下端(ヘッド開口部) ----
  const recess = () => {
    ctx.beginPath();
    ctx.moveTo(104, 252);
    ctx.lineTo(104, 220);
    ctx.quadraticCurveTo(104, 214, 110, 214);
    ctx.lineTo(290, 214);
    ctx.quadraticCurveTo(296, 214, 296, 220);
    ctx.lineTo(296, 252);
    ctx.closePath();
  };
  recess();
  ctx.fillStyle = '#242220';
  ctx.fill();
  ctx.strokeStyle = '#131210';
  ctx.lineWidth = 1.4;
  ctx.stroke();

  ctx.fillStyle = '#0C0B09';
  ctx.fillRect(172, 220, 56, 32);
  ctx.fillRect(150, 220, 13, 32);
  ctx.fillRect(237, 220, 13, 32);
  for (const [cx, cy, r] of [[132, 236, 8.5], [268, 236, 8.5], [114, 242, 3.5], [286, 242, 3.5]]) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#54504A';
  ctx.fillRect(186, 226, 28, 9);
  ctx.fillStyle = 'rgba(122,116,105,0.7)';
  ctx.fillRect(186, 226, 28, 2.5);

  // ---- シェルの刻印とリブ ----
  ctx.font = util(6.5);
  ctx.letterSpacing = '1px';
  emboss(ctx, 'COMPACT CASSETTE', 22, 232);
  emboss(ctx, 'TYPE I  NORMAL', 378, 232, 'right');
  ctx.letterSpacing = '0px';

  ctx.lineWidth = 1.2;
  for (const [x1, x2] of [[22, 98], [302, 378]]) {
    for (const y of [240, 245]) {
      ctx.strokeStyle = '#131210';
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
  paper.addColorStop(0, '#F8F3EA');
  paper.addColorStop(0.5, '#EAE4D8');
  paper.addColorStop(1, '#D7CFBE');
  soft(ctx, () => {
    roundRect(ctx, 24, 10, 352, 100, 3);
    ctx.fillStyle = '#000';
    ctx.fill();
  }, 'rgba(0,0,0,0.4)', 6.8);
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = 1.8;
  ctx.shadowOffsetY = 1.2;
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
  // 紙の繊維
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.globalAlpha = 0.075;
  ctx.fillStyle = grain(ctx);
  ctx.fillRect(24, 10, 352, 100);
  ctx.restore();
  // 貼りの浮きと退色
  ctx.fillStyle = 'rgba(201,192,172,0.18)';
  ctx.fillRect(24, 96, 352, 14);
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fillRect(24, 10, 7, 100);
  ctx.fillStyle = 'rgba(183,175,158,0.2)';
  ctx.fillRect(369, 10, 7, 100);
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
