/* 描画エンジン。canvas の transform をドキュメント座標に合わせてから描くので、
   線の太さや罫線の間隔は拡大率に自動で追従する。 */

import { PAGE_W, PAGE_H, PAGE_GAP, pageTop } from './model.js';

export const MARKER_ALPHA = 0.34;

/** 筆圧 → 実際の線幅。筆圧非対応の端末では 0.5 が来るので等倍になる。 */
export function widthFor(stroke, pressure) {
  if (stroke.tool === 'marker') return stroke.width;
  const w = stroke.width * (0.5 + (pressure ?? 0.5));
  return w < 0.35 ? 0.35 : w;
}

/** ストローク1本を現在の transform で描く */
export function drawStroke(ctx, stroke) {
  const p = stroke.points;
  const n = p.length / 3;
  if (n === 0) return;

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = stroke.color;
  ctx.fillStyle = stroke.color;

  if (stroke.tool === 'marker') {
    // マーカーは半透明。重なりで濃くならないよう1本のパスとしてまとめて描く。
    ctx.save();
    ctx.globalAlpha = MARKER_ALPHA;
    ctx.lineWidth = stroke.width;
    ctx.beginPath();
    if (n === 1) {
      ctx.moveTo(p[0], p[1]);
      ctx.lineTo(p[0] + 0.01, p[1]);
    } else {
      ctx.moveTo(p[0], p[1]);
      for (let i = 1; i < n - 1; i++) {
        const j = i * 3;
        ctx.quadraticCurveTo(p[j], p[j + 1], (p[j] + p[j + 3]) / 2, (p[j + 1] + p[j + 4]) / 2);
      }
      ctx.lineTo(p[(n - 1) * 3], p[(n - 1) * 3 + 1]);
    }
    ctx.stroke();
    ctx.restore();
    return;
  }

  if (n === 1) {
    ctx.beginPath();
    ctx.arc(p[0], p[1], widthFor(stroke, p[2]) / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  // ペンは筆圧で太さが変わるため、区間ごとに線幅を変えて描く。
  let px = p[0], py = p[1];
  for (let i = 1; i < n; i++) {
    const j = i * 3;
    const isLast = i === n - 1;
    const mx = isLast ? p[j] : (p[j] + p[j + 3]) / 2;
    const my = isLast ? p[j + 1] : (p[j + 1] + p[j + 4]) / 2;
    ctx.lineWidth = widthFor(stroke, (p[j + 2] + p[j - 1]) / 2);
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.quadraticCurveTo(p[j], p[j + 1], mx, my);
    ctx.stroke();
    px = mx; py = my;
  }
}

/** 用紙(ページ)の背景を描く */
export function drawPaper(ctx, pageCount, style, theme) {
  const paper = theme === 'dark' ? '#22232a' : '#ffffff';
  const rule = theme === 'dark' ? '#34394a' : '#dbe4f2';

  for (let i = 0; i < pageCount; i++) {
    const top = pageTop(i);
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.22)';
    ctx.shadowBlur = 14;
    ctx.shadowOffsetY = 3;
    ctx.fillStyle = paper;
    ctx.fillRect(0, top, PAGE_W, PAGE_H);
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, top, PAGE_W, PAGE_H);
    ctx.clip();
    ctx.strokeStyle = rule;
    ctx.fillStyle = rule;
    ctx.lineWidth = 1;

    if (style === 'line') {
      for (let y = top + 96; y < top + PAGE_H - 40; y += 48) {
        ctx.beginPath(); ctx.moveTo(56, y); ctx.lineTo(PAGE_W - 56, y); ctx.stroke();
      }
    } else if (style === 'grid') {
      for (let y = top + 40; y < top + PAGE_H; y += 40) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(PAGE_W, y); ctx.stroke();
      }
      for (let x = 40; x < PAGE_W; x += 40) {
        ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, top + PAGE_H); ctx.stroke();
      }
    } else if (style === 'dot') {
      for (let y = top + 40; y < top + PAGE_H; y += 40) {
        for (let x = 40; x < PAGE_W; x += 40) {
          ctx.beginPath(); ctx.arc(x, y, 1.6, 0, Math.PI * 2); ctx.fill();
        }
      }
    }
    ctx.restore();

    // ページ番号
    ctx.save();
    ctx.fillStyle = theme === 'dark' ? '#5c6070' : '#b9bcc8';
    ctx.font = '20px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(String(i + 1), PAGE_W / 2, top + PAGE_H - 22);
    ctx.restore();
  }
}

/** ページ外(余白)のクリッピング用パス。用紙からはみ出した線を隠す。 */
export function clipToPages(ctx, pageCount) {
  ctx.beginPath();
  for (let i = 0; i < pageCount; i++) ctx.rect(0, pageTop(i), PAGE_W, PAGE_H);
  ctx.clip();
}

/** 一覧用サムネイル(1ページ目)を dataURL で作る */
export function renderThumb(strokes, pageStyle, w = 220) {
  const h = Math.round((w * PAGE_H) / PAGE_W);
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  const s = w / PAGE_W;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.save();
  ctx.scale(s, s);
  if (pageStyle === 'line') {
    ctx.strokeStyle = '#e3eaf5'; ctx.lineWidth = 1.6;
    for (let y = 96; y < PAGE_H - 40; y += 48) {
      ctx.beginPath(); ctx.moveTo(56, y); ctx.lineTo(PAGE_W - 56, y); ctx.stroke();
    }
  }
  ctx.beginPath();
  ctx.rect(0, 0, PAGE_W, PAGE_H);
  ctx.clip();
  for (const st of strokes) {
    if (st.bbox && st.bbox[1] > PAGE_H) continue;   // 1ページ目だけ描く
    drawStroke(ctx, st);
  }
  ctx.restore();
  return cv.toDataURL('image/webp', 0.7);
}

/** PNG 書き出し(指定ページを等倍で) */
export function renderPagePNG(strokes, pageStyle, pageIndex, scale = 1.4) {
  const cv = document.createElement('canvas');
  cv.width = Math.round(PAGE_W * scale);
  cv.height = Math.round(PAGE_H * scale);
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.save();
  ctx.scale(scale, scale);
  ctx.translate(0, -pageTop(pageIndex));
  drawPaperFlat(ctx, pageIndex, pageStyle);
  ctx.beginPath();
  ctx.rect(0, pageTop(pageIndex), PAGE_W, PAGE_H);
  ctx.clip();
  for (const st of strokes) drawStroke(ctx, st);
  ctx.restore();
  return cv;
}

/* 書き出し用の罫線(影なし・白背景前提) */
function drawPaperFlat(ctx, i, style) {
  const top = pageTop(i);
  ctx.save();
  ctx.strokeStyle = '#dbe4f2'; ctx.fillStyle = '#dbe4f2'; ctx.lineWidth = 1;
  if (style === 'line') {
    for (let y = top + 96; y < top + PAGE_H - 40; y += 48) {
      ctx.beginPath(); ctx.moveTo(56, y); ctx.lineTo(PAGE_W - 56, y); ctx.stroke();
    }
  } else if (style === 'grid') {
    for (let y = top + 40; y < top + PAGE_H; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(PAGE_W, y); ctx.stroke(); }
    for (let x = 40; x < PAGE_W; x += 40) { ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, top + PAGE_H); ctx.stroke(); }
  } else if (style === 'dot') {
    for (let y = top + 40; y < top + PAGE_H; y += 40) {
      for (let x = 40; x < PAGE_W; x += 40) { ctx.beginPath(); ctx.arc(x, y, 1.6, 0, Math.PI * 2); ctx.fill(); }
    }
  }
  ctx.restore();
}

export { PAGE_W, PAGE_H, PAGE_GAP };
