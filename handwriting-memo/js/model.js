/* データ構造と幾何計算のユーティリティ。
   座標はすべて「ドキュメント座標」(ページ左上が原点、拡大率に依存しない)で持つ。 */

export const PAGE_W = 1240;          // A4 相当(1:1.414)
export const PAGE_H = 1754;
export const PAGE_GAP = 28;

export const PAGE_STYLES = [
  { id: 'plain', name: '無地' },
  { id: 'line', name: '横罫' },
  { id: 'grid', name: '方眼' },
  { id: 'dot', name: 'ドット' },
];

export const COLORS = ['#1c1c22', '#3d7dff', '#e3524b', '#22a06b', '#f2a516', '#8a4fd8', '#ffffff'];
export const PEN_WIDTHS = [1.6, 3, 5, 9];
export const MARKER_WIDTHS = [14, 22, 34];

export const uid = (p = 'i') =>
  p + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export function newFolder(name, parentId = null) {
  return { id: uid('f'), name, parentId, createdAt: Date.now() };
}

export function newNote(folderId = null, pageStyle = 'line') {
  const t = Date.now();
  return {
    id: uid('n'), title: '', folderId,
    createdAt: t, updatedAt: t,
    pageStyle, pageCount: 1, thumb: null,
  };
}

/* ページ番号 → そのページの上端 Y 座標 */
export const pageTop = (i) => i * (PAGE_H + PAGE_GAP);

/* ドキュメント全体の高さ */
export const docHeight = (pageCount) => pageCount * PAGE_H + (pageCount - 1) * PAGE_GAP;

/* ---------- ストローク ---------- */

export function makeStroke(tool, color, width) {
  return { id: uid('s'), tool, color, width, points: [], bbox: null };
}

/** points は [x, y, pressure, ...] のフラット配列 */
export function computeBBox(stroke) {
  const p = stroke.points;
  if (p.length === 0) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < p.length; i += 3) {
    if (p[i] < x0) x0 = p[i];
    if (p[i] > x1) x1 = p[i];
    if (p[i + 1] < y0) y0 = p[i + 1];
    if (p[i + 1] > y1) y1 = p[i + 1];
  }
  const m = stroke.width * 0.6 + 1;
  return [x0 - m, y0 - m, x1 + m, y1 + m];
}

export const bboxHit = (b, x, y, r = 0) =>
  !!b && x >= b[0] - r && x <= b[2] + r && y >= b[1] - r && y <= b[3] + r;

export const bboxIntersects = (a, b) =>
  !!a && !!b && a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];

/** 線分と点の距離の2乗 */
function distSqToSegment(px, py, x0, y0, x1, y1) {
  const dx = x1 - x0, dy = y1 - y0;
  const len = dx * dx + dy * dy;
  let t = len === 0 ? 0 : ((px - x0) * dx + (py - y0) * dy) / len;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = x0 + t * dx, cy = y0 + t * dy;
  return (px - cx) ** 2 + (py - cy) ** 2;
}

/** 消しゴム用: 半径 r 以内にストロークが掛かっているか */
export function strokeHit(stroke, x, y, r) {
  if (!bboxHit(stroke.bbox, x, y, r)) return false;
  const p = stroke.points;
  const rr = (r + stroke.width * 0.5) ** 2;
  if (p.length === 3) return (p[0] - x) ** 2 + (p[1] - y) ** 2 <= rr;
  for (let i = 0; i + 5 < p.length; i += 3) {
    if (distSqToSegment(x, y, p[i], p[i + 1], p[i + 3], p[i + 4]) <= rr) return true;
  }
  return false;
}

/** なげなわ選択用: 多角形の中に点があるか(交差数判定) */
export function pointInPolygon(poly, x, y) {
  let inside = false;
  for (let i = 0, j = poly.length - 2; i < poly.length; j = i, i += 2) {
    const xi = poly[i], yi = poly[i + 1], xj = poly[j], yj = poly[j + 1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** ストロークの過半数の点が多角形に入っていれば「選択された」とみなす */
export function strokeInPolygon(stroke, poly, polyBBox) {
  if (!bboxIntersects(stroke.bbox, polyBBox)) return false;
  const p = stroke.points;
  let inside = 0, total = 0;
  for (let i = 0; i < p.length; i += 3) {
    total++;
    if (pointInPolygon(poly, p[i], p[i + 1])) inside++;
  }
  return total > 0 && inside / total >= 0.55;
}

export function translateStroke(stroke, dx, dy) {
  const p = stroke.points;
  for (let i = 0; i < p.length; i += 3) { p[i] += dx; p[i + 1] += dy; }
  if (stroke.bbox) {
    stroke.bbox = [stroke.bbox[0] + dx, stroke.bbox[1] + dy, stroke.bbox[2] + dx, stroke.bbox[3] + dy];
  }
  return stroke;
}

export function cloneStroke(stroke) {
  return { ...stroke, id: uid('s'), points: stroke.points.slice(), bbox: stroke.bbox ? stroke.bbox.slice() : null };
}
