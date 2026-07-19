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

function drawReel(ctx, cx, cy, hubR, tapeR) {
  // テープ(巻かれている茶色い部分)
  ctx.beginPath();
  ctx.arc(cx, cy, tapeR, 0, Math.PI * 2);
  ctx.fillStyle = '#3a2a1c';
  ctx.fill();
  // ハブ(白いスポーク付きの軸)
  ctx.beginPath();
  ctx.arc(cx, cy, hubR, 0, Math.PI * 2);
  ctx.fillStyle = '#8fa3c4';
  ctx.fill();
  ctx.fillStyle = '#f1f5fb';
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, hubR, a, a + Math.PI / 7.5);
    ctx.closePath();
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(cx, cy, hubR, 0, Math.PI * 2);
  ctx.lineWidth = 6;
  ctx.strokeStyle = '#cbd5e6';
  ctx.stroke();
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
  const heading = 'N O W   P L A Y I N G';
  ctx.fillText(heading, S / 2, 110);

  // ---- カセット本体 ----
  const cw = 860, ch = 542;
  const cx0 = (S - cw) / 2, cy0 = 190;
  const body = ctx.createLinearGradient(0, cy0, 0, cy0 + ch);
  body.addColorStop(0, '#2b3a60');
  body.addColorStop(1, '#1d2947');
  roundRect(ctx, cx0, cy0, cw, ch, 28);
  ctx.fillStyle = body;
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.strokeStyle = '#3d5183';
  ctx.stroke();

  // ネジ
  ctx.fillStyle = '#6d7ea6';
  for (const [sx, sy] of [[26, 26], [cw - 26, 26], [26, ch - 26], [cw - 26, ch - 26]]) {
    ctx.beginPath();
    ctx.arc(cx0 + sx, cy0 + sy, 9, 0, Math.PI * 2);
    ctx.fill();
  }

  // ラベル
  const lx = cx0 + 52, ly = cy0 + 40, lw = cw - 104, lh = 250;
  roundRect(ctx, lx, ly, lw, lh, 12);
  ctx.fillStyle = '#eef2f8';
  ctx.fill();
  // ラベル上部のストライプ
  ctx.save();
  roundRect(ctx, lx, ly, lw, lh, 12);
  ctx.clip();
  for (let i = 0; i < lw / 56 + 1; i++) {
    ctx.fillStyle = i % 2 === 0 ? '#3b82f6' : '#2563eb';
    ctx.fillRect(lx + i * 56, ly, 56, 62);
  }
  ctx.restore();

  // ジャケット画像(あればラベル左に)
  let textX = lx + 36, textW = lw - 72;
  if (track.artUrl) {
    const img = await loadImage(track.artUrl);
    if (img) {
      const as = 130, ax = lx + 30, ay = ly + 88;
      ctx.save();
      roundRect(ctx, ax, ay, as, as, 10);
      ctx.clip();
      ctx.drawImage(img, ax, ay, as, as);
      ctx.restore();
      textX = ax + as + 28;
      textW = lx + lw - 36 - textX;
    }
  }

  // 曲名・アーティスト
  ctx.textAlign = 'left';
  ctx.fillStyle = '#1e293b';
  ctx.font = '700 52px system-ui, sans-serif';
  ctx.fillText(ellipsize(ctx, track.title, textW), textX, ly + 148);
  ctx.fillStyle = '#475569';
  ctx.font = '400 38px system-ui, sans-serif';
  ctx.fillText(ellipsize(ctx, track.artist || 'Unknown Artist', textW), textX, ly + 208);

  // A面マーク
  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(lx + lw - 40, ly + lh - 38, 22, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#1e293b';
  ctx.font = '700 28px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('A', lx + lw - 40, ly + lh - 28);

  // テープ窓
  const wx = cx0 + cw * 0.19, wy = ly + lh + 42, ww = cw * 0.62, wh = 150;
  roundRect(ctx, wx, wy, ww, wh, 75);
  ctx.fillStyle = '#0a0f1c';
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.strokeStyle = '#3d5183';
  ctx.stroke();
  // 窓の中央のテープ
  ctx.fillStyle = 'rgba(120, 90, 60, 0.55)';
  ctx.fillRect(wx + ww * 0.32, wy + wh / 2 - 12, ww * 0.36, 24);
  // リール(再生位置でテープの巻き量が変わる)
  const p = Math.min(Math.max(progress || 0, 0), 1);
  drawReel(ctx, wx + ww * 0.19, wy + wh / 2, 34, 46 + 18 * (1 - p));
  drawReel(ctx, wx + ww * 0.81, wy + wh / 2, 34, 46 + 18 * p);

  // フッター
  ctx.textAlign = 'center';
  ctx.fillStyle = '#60a5fa';
  ctx.font = '600 36px system-ui, sans-serif';
  ctx.fillText('📼 カセットプレーヤー', S / 2, S - 130);
  ctx.fillStyle = '#8fa3c4';
  ctx.font = '400 28px system-ui, sans-serif';
  ctx.fillText(new Date().toLocaleDateString('ja-JP'), S / 2, S - 80);

  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}
