// 再生中画面をSNS用のスクショ画像(PNG)としてキャンバスに描画・共有する

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
  const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, 1, cx, cy, r);
  g.addColorStop(0, '#a7bade');
  g.addColorStop(1, '#3f4f76');
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = '#22304f';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.65, cy); ctx.lineTo(cx + r * 0.65, cy);
  ctx.moveTo(cx, cy - r * 0.65); ctx.lineTo(cx, cy + r * 0.65);
  ctx.stroke();
}

// リール(テープの巻き + 歯付きハブ)
function drawReel(ctx, cx, cy, hubR, tapeR) {
  const pack = ctx.createRadialGradient(cx, cy, tapeR * 0.2, cx, cy, tapeR);
  pack.addColorStop(0, '#5a4330');
  pack.addColorStop(0.72, '#3a2a1c');
  pack.addColorStop(1, '#221910');
  ctx.beginPath();
  ctx.arc(cx, cy, tapeR, 0, Math.PI * 2);
  ctx.fillStyle = pack;
  ctx.fill();

  // 白いハブ
  ctx.beginPath();
  ctx.arc(cx, cy, hubR, 0, Math.PI * 2);
  ctx.fillStyle = '#dfe6f2';
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#a9b7cf';
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, hubR * 0.79, 0, Math.PI * 2);
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#c3cfe2';
  ctx.stroke();
  // 中央の穴
  ctx.beginPath();
  ctx.arc(cx, cy, hubR * 0.53, 0, Math.PI * 2);
  ctx.fillStyle = '#0a0f1c';
  ctx.fill();
  // 内向きの歯(6枚)
  ctx.fillStyle = '#dfe6f2';
  for (let i = 0; i < 6; i++) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((i * Math.PI) / 3);
    roundRect(ctx, -3.5, -hubR * 0.53, 7, hubR * 0.34, 3);
    ctx.fill();
    ctx.restore();
  }
}

async function loadImage(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
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
  ctx.fillText('N O W   P L A Y I N G', S / 2, 108);

  // ---- カセット本体 ----
  const cw = 860, ch = 542;
  const cx0 = (S - cw) / 2, cy0 = 182;
  const body = ctx.createLinearGradient(0, cy0, 0, cy0 + ch);
  body.addColorStop(0, '#2e3f68');
  body.addColorStop(1, '#19233f');
  roundRect(ctx, cx0, cy0, cw, ch, 36);
  ctx.fillStyle = body;
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = '#3d5183';
  ctx.stroke();

  // 継ぎ目(シェルの合わせ目)
  ctx.beginPath();
  ctx.moveTo(cx0 + 18, cy0 + ch * 0.815);
  ctx.lineTo(cx0 + cw - 18, cy0 + ch * 0.815);
  ctx.strokeStyle = '#121b32';
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx0 + 18, cy0 + ch * 0.815 + 4);
  ctx.lineTo(cx0 + cw - 18, cy0 + ch * 0.815 + 4);
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 2;
  ctx.stroke();

  // ラベル
  const lx = cx0 + 56, ly = cy0 + 34, lw = cw - 112, lh = 222;
  roundRect(ctx, lx, ly, lw, lh, 14);
  ctx.fillStyle = '#eef2f8';
  ctx.fill();
  ctx.save();
  roundRect(ctx, lx, ly, lw, lh, 14);
  ctx.clip();
  ctx.fillStyle = '#3b82f6';
  ctx.fillRect(lx, ly, lw, 46);
  ctx.fillStyle = '#1d4ed8';
  ctx.fillRect(lx, ly + 46, lw, 14);
  // 罫線
  ctx.strokeStyle = '#c3cfe2';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(lx + 36, ly + 148); ctx.lineTo(lx + lw - 36, ly + 148);
  ctx.moveTo(lx + 36, ly + 196); ctx.lineTo(lx + lw - 110, ly + 196);
  ctx.stroke();
  ctx.restore();

  // ジャケット画像(あればラベル左に)
  let textX = lx + 36, textW = lw - 72;
  if (track.artUrl) {
    const img = await loadImage(track.artUrl);
    if (img) {
      const as = 118, ax = lx + 30, ay = ly + 78;
      ctx.save();
      roundRect(ctx, ax, ay, as, as, 10);
      ctx.clip();
      ctx.drawImage(img, ax, ay, as, as);
      ctx.restore();
      textX = ax + as + 26;
      textW = lx + lw - 36 - textX;
    }
  }

  // 曲名・アーティスト
  ctx.textAlign = 'left';
  ctx.fillStyle = '#1e293b';
  ctx.font = '700 50px system-ui, sans-serif';
  ctx.fillText(ellipsize(ctx, track.title, textW), textX, ly + 138);
  ctx.fillStyle = '#475569';
  ctx.font = '400 36px system-ui, sans-serif';
  ctx.fillText(ellipsize(ctx, track.artist || 'Unknown Artist', textW), textX, ly + 188);

  // A面マーク
  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(lx + lw - 46, ly + lh - 40, 24, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#1e293b';
  ctx.font = '700 30px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('A', lx + lw - 46, ly + lh - 29);

  // テープ窓
  const ww = cw * 0.52, wx = cx0 + (cw - ww) / 2, wy = ly + lh + 26, wh = 148;
  roundRect(ctx, wx, wy, ww, wh, wh / 2);
  ctx.fillStyle = '#0a0f1c';
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = '#3d5183';
  ctx.stroke();
  // 窓の中のテープとリール(再生位置で巻き量が変わる)
  const p = Math.min(Math.max(progress || 0, 0), 1);
  ctx.save();
  roundRect(ctx, wx + 4, wy + 4, ww - 8, wh - 8, (wh - 8) / 2);
  ctx.clip();
  ctx.fillStyle = '#4a3626';
  ctx.fillRect(wx + ww * 0.3, wy + wh / 2 - 11, ww * 0.4, 22);
  drawReel(ctx, wx + ww * 0.21, wy + wh / 2, 36, 44 + 26 * (1 - p));
  drawReel(ctx, wx + ww * 0.79, wy + wh / 2, 36, 44 + 26 * p);
  // ガラスの反射
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  ctx.beginPath();
  ctx.moveTo(wx + ww * 0.06, wy);
  ctx.lineTo(wx + ww * 0.3, wy);
  ctx.lineTo(wx + ww * 0.18, wy + wh);
  ctx.lineTo(wx + ww * 0.02, wy + wh);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // 下部のヘッド開口部(台形)
  const tzTop = wy + wh + 22, tzBot = cy0 + ch - 10;
  ctx.beginPath();
  ctx.moveTo(cx0 + cw * 0.29, tzBot);
  ctx.lineTo(cx0 + cw * 0.71, tzBot);
  ctx.lineTo(cx0 + cw * 0.66, tzTop);
  ctx.lineTo(cx0 + cw * 0.34, tzTop);
  ctx.closePath();
  ctx.fillStyle = '#111a30';
  ctx.fill();
  ctx.strokeStyle = '#0d1426';
  ctx.lineWidth = 3;
  ctx.stroke();
  // キャプスタン穴・ヘッド窓・小穴
  ctx.fillStyle = '#070b14';
  ctx.strokeStyle = '#2a3a5f';
  ctx.lineWidth = 3;
  for (const fx of [0.415, 0.585]) {
    ctx.beginPath();
    ctx.arc(cx0 + cw * fx, tzTop + 42, 12, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
  }
  roundRect(ctx, S / 2 - 38, tzTop + 12, 76, 32, 6);
  ctx.fill(); ctx.stroke();
  for (const fx of [0.355, 0.645]) {
    ctx.beginPath();
    ctx.arc(cx0 + cw * fx, tzTop + 56, 8, 0, Math.PI * 2);
    ctx.fill();
  }

  // ネジ(四隅 + 下中央)
  drawScrew(ctx, cx0 + 36, cy0 + 36, 13);
  drawScrew(ctx, cx0 + cw - 36, cy0 + 36, 13);
  drawScrew(ctx, cx0 + 36, cy0 + ch - 36, 13);
  drawScrew(ctx, cx0 + cw - 36, cy0 + ch - 36, 13);
  drawScrew(ctx, S / 2, tzBot - 14, 11);

  // フッター
  ctx.textAlign = 'center';
  ctx.fillStyle = '#60a5fa';
  ctx.font = '600 36px system-ui, sans-serif';
  ctx.fillText('📼 カセットプレーヤー', S / 2, S - 128);
  ctx.fillStyle = '#8fa3c4';
  ctx.font = '400 28px system-ui, sans-serif';
  ctx.fillText(new Date().toLocaleDateString('ja-JP'), S / 2, S - 78);

  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}
