// 再生中画面をSNS用のスクショ画像(PNG)としてキャンバスに描画・共有する
// カセットは再生画面のSVGと同じ 400x252 座標系で描き、拡大して配置する

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

// プラスねじ
function drawScrew(ctx, cx, cy, r) {
  const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, 0.5, cx, cy, r);
  g.addColorStop(0, '#bfe4f5');
  g.addColorStop(1, '#31708f');
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = '#173a52';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.65, cy); ctx.lineTo(cx + r * 0.65, cy);
  ctx.moveTo(cx, cy - r * 0.65); ctx.lineTo(cx, cy + r * 0.65);
  ctx.stroke();
}

// テープの巻き(パック)
function drawPack(ctx, cx, cy, r) {
  const g = ctx.createRadialGradient(cx, cy, r * 0.15, cx, cy, r);
  g.addColorStop(0, '#181310');
  g.addColorStop(0.75, '#0e0b09');
  g.addColorStop(1, '#050404');
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
}

// 歯付きスピンドル穴
function drawHub(ctx, cx, cy) {
  ctx.beginPath();
  ctx.arc(cx, cy, 15, 0, Math.PI * 2);
  ctx.fillStyle = '#0a0f1c';
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = '#93a1b3';
  ctx.stroke();
  ctx.fillStyle = '#b9c2cf';
  for (let i = 0; i < 6; i++) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((i * Math.PI) / 3 + 0.35);
    roundRect(ctx, -1.6, -14, 3.2, 6.5, 1.3);
    ctx.fill();
    ctx.restore();
  }
  ctx.beginPath();
  ctx.arc(cx, cy, 5.5, 0, Math.PI * 2);
  ctx.fillStyle = '#05080f';
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

// スケルトンブルーのカセット本体(400x252 座標系)
function drawCassette(ctx, track, p, artImg) {
  // 内部
  roundRect(ctx, 2, 2, 396, 248, 16);
  ctx.fillStyle = '#1e3d59';
  ctx.fill();

  ctx.save();
  roundRect(ctx, 2, 2, 396, 248, 16);
  ctx.clip();

  // テープの巻きとガイド・下端のテープ
  drawPack(ctx, 142, 140, 27 + 13 * (1 - p));
  drawPack(ctx, 258, 140, 27 + 13 * p);
  ctx.fillStyle = '#1c2a3e';
  for (const gx of [78, 322]) {
    ctx.beginPath();
    ctx.arc(gx, 192, 5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#1a1310';
  ctx.fillRect(78, 197, 244, 5);

  // 半透明ブルーのシェル
  const tint = ctx.createLinearGradient(0, 2, 0, 250);
  tint.addColorStop(0, 'rgba(72, 178, 222, 0.42)');
  tint.addColorStop(1, 'rgba(31, 123, 176, 0.42)');
  ctx.fillStyle = tint;
  ctx.fillRect(0, 0, 400, 252);
  ctx.restore();

  // 縁
  roundRect(ctx, 2, 2, 396, 248, 16);
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = 'rgba(143, 215, 242, 0.85)';
  ctx.stroke();
  roundRect(ctx, 8, 8, 384, 236, 12);
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(10, 200); ctx.lineTo(390, 200);
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(8, 20, 38, 0.5)';
  ctx.stroke();

  // 白いハブリングと連結バー
  ctx.fillStyle = '#f4f7fb';
  roundRect(ctx, 142, 131, 116, 18, 9);
  ctx.fill();
  ctx.fillStyle = '#2e93c9';
  ctx.font = '700 6.5px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('PRECISION MECH.', 200, 143.5);
  for (const hx of [142, 258]) {
    ctx.beginPath();
    ctx.arc(hx, 140, 25, 0, Math.PI * 2);
    ctx.fillStyle = '#f4f7fb';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#cfd9e6';
    ctx.stroke();
  }
  drawHub(ctx, 142, 140);
  drawHub(ctx, 258, 140);

  // 白いステッカーラベル
  roundRect(ctx, 92, 27, 216, 46, 5);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
  ctx.fill();
  roundRect(ctx, 92, 26, 216, 46, 5);
  ctx.fillStyle = '#fdfefe';
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = '#d7dde6';
  ctx.stroke();

  // ステッカーに曲名(ジャケットがあれば左に添える)
  let tx = 200, tw = 196, align = 'center';
  if (artImg) {
    ctx.save();
    roundRect(ctx, 98, 31, 36, 36, 4);
    ctx.clip();
    ctx.drawImage(artImg, 98, 31, 36, 36);
    ctx.restore();
    tx = 140; tw = 160; align = 'left';
  }
  ctx.textAlign = align;
  ctx.fillStyle = '#1d4ed8';
  ctx.font = '700 13px sans-serif';
  ctx.fillText(ellipsize(ctx, track.title, tw), tx, 47);
  ctx.fillStyle = '#64748b';
  ctx.font = '400 9px sans-serif';
  ctx.fillText(ellipsize(ctx, track.artist || 'Unknown Artist', tw), tx, 62);

  // シェルに印刷された文字
  ctx.fillStyle = '#dff4fc';
  ctx.textAlign = 'center';
  ctx.font = 'italic 700 12px sans-serif';
  ctx.fillText('60 min', 54, 44);
  ctx.textAlign = 'right';
  ctx.fillText('BLUETAPE', 378, 44);
  ctx.textAlign = 'center';
  ctx.globalAlpha = 0.85;
  ctx.font = '6.5px sans-serif';
  ctx.fillText('TYPE Ⅰ ( NORMAL ) POSITION   ·   NORMAL BIAS 120μs EQ', 200, 88);
  ctx.globalAlpha = 1;
  ctx.textAlign = 'right';
  ctx.font = '700 9px sans-serif';
  ctx.fillText('SIDE-A', 378, 124);
  ctx.font = 'italic 700 11px sans-serif';
  ctx.fillText('B·tune 60', 388, 194);
  ctx.beginPath();
  ctx.moveTo(96, 97); ctx.lineTo(168, 93); ctx.lineTo(174, 100); ctx.lineTo(232, 95);
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(143, 215, 242, 0.45)';
  ctx.stroke();
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(7, 21, 34, 0.85)';
  ctx.font = '700 24px sans-serif';
  ctx.fillText('A', 34, 242);

  // 下部(ヘッド開口部)
  ctx.beginPath();
  ctx.moveTo(110, 246); ctx.lineTo(290, 246); ctx.lineTo(272, 204); ctx.lineTo(128, 204);
  ctx.closePath();
  ctx.fillStyle = 'rgba(22, 52, 78, 0.9)';
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(120, 200, 235, 0.3)';
  ctx.stroke();
  ctx.fillStyle = '#060b14';
  ctx.strokeStyle = '#2a4a66';
  for (const fx of [156, 244]) {
    ctx.beginPath();
    ctx.arc(fx, 228, 5.5, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
  }
  roundRect(ctx, 183, 210, 34, 14, 2);
  ctx.fill(); ctx.stroke();
  for (const fx of [132, 268]) {
    ctx.beginPath();
    ctx.arc(fx, 238, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // プラスチックの艶
  ctx.save();
  roundRect(ctx, 2, 2, 396, 248, 16);
  ctx.clip();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.07)';
  ctx.beginPath();
  ctx.moveTo(52, 2); ctx.lineTo(118, 2); ctx.lineTo(64, 250); ctx.lineTo(26, 250);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
  ctx.beginPath();
  ctx.moveTo(132, 2); ctx.lineTo(156, 2); ctx.lineTo(102, 250); ctx.lineTo(88, 250);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // ネジ
  drawScrew(ctx, 16, 16, 5.5);
  drawScrew(ctx, 384, 16, 5.5);
  drawScrew(ctx, 16, 236, 5.5);
  drawScrew(ctx, 384, 236, 5.5);
  drawScrew(ctx, 200, 235, 4.5);
}

/**
 * 再生中の曲情報からシェア用画像を作る。
 * @returns {Promise<Blob>}
 */
export async function drawShareCard(track, progress) {
  const S = 1080;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d');

  // 背景(青のグラデーション)
  const bg = ctx.createLinearGradient(0, 0, 0, S);
  bg.addColorStop(0, '#0e1a33');
  bg.addColorStop(0.55, '#0b1220');
  bg.addColorStop(1, '#12224a');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, S, S);

  ctx.textAlign = 'center';
  ctx.fillStyle = '#8fa3c4';
  ctx.font = '600 34px system-ui, sans-serif';
  ctx.fillText('N O W   P L A Y I N G', S / 2, 128);

  const artImg = track.artUrl ? await loadImage(track.artUrl) : null;
  const p = Math.min(Math.max(progress || 0, 0), 1);

  // カセット(400x252 → 2.15倍で中央配置、うっすら影)
  const scale = 2.15;
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
  ctx.shadowBlur = 60;
  ctx.shadowOffsetY = 24;
  roundRect(ctx, (S - 400 * scale) / 2, 208, 400 * scale, 252 * scale, 16 * scale);
  ctx.fillStyle = '#1e3d59';
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.translate((S - 400 * scale) / 2, 208);
  ctx.scale(scale, scale);
  drawCassette(ctx, track, p, artImg);
  ctx.restore();

  // フッター
  ctx.textAlign = 'center';
  ctx.fillStyle = '#60a5fa';
  ctx.font = '600 36px system-ui, sans-serif';
  ctx.fillText('📼 カセットプレーヤー', S / 2, S - 148);
  ctx.fillStyle = '#8fa3c4';
  ctx.font = '400 28px system-ui, sans-serif';
  ctx.fillText(new Date().toLocaleDateString('ja-JP'), S / 2, S - 98);

  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}
