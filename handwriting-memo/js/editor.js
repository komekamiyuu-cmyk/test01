/* 手書きキャンバス本体。
   - ペン(筆圧対応)/ マーカー / 消しゴム / なげなわ選択
   - 2本指でのスクロール・ピンチズーム、ペン使用中は手のひら(タッチ)を無視
   - 元に戻す / やり直す、ページ追加、自動保存
   描画は「確定済みレイヤー(オフスクリーン)+ 描き途中の線」の2枚重ねで行う。 */

import {
  PAGE_W, PAGE_H, PAGE_GAP, pageTop, docHeight,
  makeStroke, computeBBox, strokeHit, strokeInPolygon, translateStroke, cloneStroke,
} from './model.js';
import { drawStroke, drawPaper, clipToPages } from './ink.js';

const ERASER_SCREEN_R = 13;      // 画面上での消しゴム半径(px)
const MIN_STEP_SCREEN = 1.1;     // これ未満の移動は点として記録しない
const PALM_GUARD_MS = 1500;      // ペンを使った直後にタッチを無視する時間

export class Editor {
  constructor({ canvas, wrap, settings, onChange, onHistory }) {
    this.canvas = canvas;
    this.wrap = wrap;
    this.ctx = canvas.getContext('2d');
    this.settings = settings;
    this.onChange = onChange || (() => {});
    this.onHistory = onHistory || (() => {});

    this.layer = document.createElement('canvas');
    this.layerCtx = this.layer.getContext('2d');

    this.strokes = [];
    this.pageCount = 1;
    this.pageStyle = 'line';
    this.theme = 'light';

    this.view = { scale: 1, x: 0, y: 0 };
    this.undoStack = [];
    this.redoStack = [];

    this.pointers = new Map();
    this.drawing = null;      // { pointerId, stroke }
    this.erasing = null;      // { pointerId, removed: [] }
    this.lasso = null;        // { pointerId, pts: [] }
    this.dragSel = null;      // { pointerId, lastX, lastY, dx, dy }
    this.panning = null;      // { pointerId, lastX, lastY }
    this.pinch = null;
    this.selection = new Set();
    this.eraserCursor = null;
    this.lastPenAt = 0;
    this.needsStatic = true;
    this.frame = 0;

    this._bind();
    this.resize();
  }

  /* ---------- 座標変換 ---------- */
  toDoc(sx, sy) {
    const r = this.canvas.getBoundingClientRect();
    return {
      x: (sx - r.left - this.view.x) / this.view.scale,
      y: (sy - r.top - this.view.y) / this.view.scale,
    };
  }

  visibleRect() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    const s = this.view.scale;
    return [-this.view.x / s, -this.view.y / s, (w - this.view.x) / s, (h - this.view.y) / s];
  }

  /* ---------- 読み込み ---------- */
  loadNote(note, strokes) {
    this.note = note;
    this.strokes = strokes;
    this.pageCount = note.pageCount || 1;
    this.pageStyle = note.pageStyle || 'line';
    this.undoStack = [];
    this.redoStack = [];
    this.selection.clear();
    this.fitWidth();
    this.onHistory();
  }

  fitWidth() {
    const w = this.canvas.clientWidth || this.wrap.clientWidth;
    const margin = 24;
    this.view.scale = Math.max(0.15, (w - margin * 2) / PAGE_W);
    this.view.x = margin;
    this.view.y = 20;
    this.invalidate();
  }

  setZoom(scale, cx, cy) {
    const s = Math.min(5, Math.max(0.2, scale));
    const r = this.canvas.getBoundingClientRect();
    const px = (cx - r.left), py = (cy - r.top);
    const docX = (px - this.view.x) / this.view.scale;
    const docY = (py - this.view.y) / this.view.scale;
    this.view.scale = s;
    this.view.x = px - docX * s;
    this.view.y = py - docY * s;
    this.clampView();
    this.invalidate();
    this.onChange({ zoom: true });
  }

  clampView() {
    const h = docHeight(this.pageCount) * this.view.scale;
    const ch = this.canvas.clientHeight;
    const cw = this.canvas.clientWidth;
    const w = PAGE_W * this.view.scale;
    // 用紙が画面より小さいときは中央寄せ、大きいときははみ出しすぎないよう制限
    this.view.x = w < cw ? (cw - w) / 2 : Math.min(40, Math.max(cw - w - 40, this.view.x));
    this.view.y = h < ch ? Math.min(20, (ch - h) / 2) : Math.min(20, Math.max(ch - h - 40, this.view.y));
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const w = this.wrap.clientWidth, h = this.wrap.clientHeight;
    if (!w || !h) return;
    for (const cv of [this.canvas, this.layer]) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
    }
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.dpr = dpr;
    this.invalidate();
  }

  /* ---------- 描画ループ ---------- */
  invalidate() { this.needsStatic = true; this.schedule(); }

  schedule() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => { this.frame = 0; this.render(); });
  }

  applyTransform(ctx) {
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.translate(this.view.x, this.view.y);
    ctx.scale(this.view.scale, this.view.scale);
  }

  renderStatic() {
    const ctx = this.layerCtx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.layer.width, this.layer.height);
    this.applyTransform(ctx);
    drawPaper(ctx, this.pageCount, this.pageStyle, this.theme);

    const vis = this.visibleRect();
    ctx.save();
    clipToPages(ctx, this.pageCount);
    for (const s of this.strokes) {
      const b = s.bbox;
      if (b && (b[2] < vis[0] || b[0] > vis[2] || b[3] < vis[1] || b[1] > vis[3])) continue;
      drawStroke(ctx, s);
    }
    ctx.restore();

    if (this.selection.size) this.drawSelectionBox(ctx);
    this.needsStatic = false;
  }

  drawSelectionBox(ctx) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const s of this.strokes) {
      if (!this.selection.has(s.id) || !s.bbox) continue;
      x0 = Math.min(x0, s.bbox[0]); y0 = Math.min(y0, s.bbox[1]);
      x1 = Math.max(x1, s.bbox[2]); y1 = Math.max(y1, s.bbox[3]);
    }
    if (x0 === Infinity) return;
    this.selBBox = [x0, y0, x1, y1];
    ctx.save();
    ctx.strokeStyle = '#3d7dff';
    ctx.lineWidth = 1.5 / this.view.scale;
    ctx.setLineDash([7 / this.view.scale, 5 / this.view.scale]);
    ctx.strokeRect(x0 - 6, y0 - 6, x1 - x0 + 12, y1 - y0 + 12);
    ctx.fillStyle = 'rgba(61,125,255,.08)';
    ctx.fillRect(x0 - 6, y0 - 6, x1 - x0 + 12, y1 - y0 + 12);
    ctx.restore();
  }

  render() {
    if (!this.dpr) return;
    if (this.needsStatic) this.renderStatic();
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.drawImage(this.layer, 0, 0);

    this.applyTransform(ctx);

    if (this.drawing) {
      ctx.save();
      clipToPages(ctx, this.pageCount);
      drawStroke(ctx, this.drawing.stroke);
      ctx.restore();
    }

    if (this.lasso && this.lasso.pts.length >= 4) {
      const p = this.lasso.pts;
      ctx.save();
      ctx.strokeStyle = '#3d7dff';
      ctx.lineWidth = 1.5 / this.view.scale;
      ctx.setLineDash([6 / this.view.scale, 4 / this.view.scale]);
      ctx.beginPath();
      ctx.moveTo(p[0], p[1]);
      for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
      ctx.closePath();
      ctx.stroke();
      ctx.fillStyle = 'rgba(61,125,255,.10)';
      ctx.fill();
      ctx.restore();
    }

    if (this.eraserCursor) {
      ctx.save();
      ctx.strokeStyle = 'rgba(120,120,140,.9)';
      ctx.fillStyle = 'rgba(160,160,180,.18)';
      ctx.lineWidth = 1 / this.view.scale;
      ctx.beginPath();
      ctx.arc(this.eraserCursor.x, this.eraserCursor.y, ERASER_SCREEN_R / this.view.scale, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      ctx.restore();
    }
  }

  /* ---------- 入力 ---------- */
  _bind() {
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => this.onDown(e));
    c.addEventListener('pointermove', (e) => this.onMove(e));
    c.addEventListener('pointerup', (e) => this.onUp(e));
    c.addEventListener('pointercancel', (e) => this.onUp(e, true));
    c.addEventListener('pointerleave', (e) => { if (this.eraserCursor) { this.eraserCursor = null; this.schedule(); } });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
  }

  touchDrawAllowed() {
    return this.settings.fingerDraw && Date.now() - this.lastPenAt > PALM_GUARD_MS;
  }

  activeTool(e) {
    // ペンのお尻(消しゴムボタン)は自動で消しゴムに切り替わる
    if (e.pointerType === 'pen' && (e.buttons & 32 || e.button === 5)) return 'eraser';
    return this.settings.tool;
  }

  onDown(e) {
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });

    if (e.pointerType === 'pen') {
      this.lastPenAt = Date.now();
      this.abortTouchInteraction();
    }

    if (this.pointers.size >= 2) {
      this.abortStroke();
      this.beginPinch();
      return;
    }

    const isTouch = e.pointerType === 'touch';
    if (isTouch && !this.touchDrawAllowed()) { this.beginPan(e); return; }
    if (e.pointerType === 'mouse' && e.button === 1) { this.beginPan(e); return; }
    if (e.pointerType === 'mouse' && e.button !== 0) return;

    this.capture(e.pointerId);
    const tool = this.activeTool(e);
    const p = this.toDoc(e.clientX, e.clientY);

    if (tool === 'eraser') {
      this.erasing = { pointerId: e.pointerId, removed: [] };
      this.eraserCursor = p;
      this.eraseAt(p.x, p.y);
      return;
    }

    if (tool === 'lasso') {
      if (this.selection.size && this.selBBox && this.insideSel(p)) {
        this.dragSel = { pointerId: e.pointerId, lastX: p.x, lastY: p.y, dx: 0, dy: 0 };
      } else {
        this.clearSelection(false);
        this.lasso = { pointerId: e.pointerId, pts: [p.x, p.y] };
      }
      this.schedule();
      return;
    }

    this.clearSelection(false);
    const width = tool === 'marker' ? this.settings.markerWidth : this.settings.penWidth;
    const stroke = makeStroke(tool, this.settings.color, width);
    this.pushPoint(stroke, p.x, p.y, this.pressureOf(e));
    this.drawing = { pointerId: e.pointerId, stroke, lastSX: e.clientX, lastSY: e.clientY };
    this.schedule();
  }

  onMove(e) {
    const rec = this.pointers.get(e.pointerId);
    if (rec) { rec.x = e.clientX; rec.y = e.clientY; }

    if (this.pinch) { this.updatePinch(); return; }
    if (this.panning && this.panning.pointerId === e.pointerId) {
      this.view.x += e.clientX - this.panning.lastX;
      this.view.y += e.clientY - this.panning.lastY;
      this.panning.lastX = e.clientX; this.panning.lastY = e.clientY;
      this.clampView();
      this.invalidate();
      return;
    }

    if (this.drawing && this.drawing.pointerId === e.pointerId) {
      const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      const min = MIN_STEP_SCREEN;
      for (const ev of (events.length ? events : [e])) {
        const dx = ev.clientX - this.drawing.lastSX, dy = ev.clientY - this.drawing.lastSY;
        if (dx * dx + dy * dy < min * min) continue;
        this.drawing.lastSX = ev.clientX; this.drawing.lastSY = ev.clientY;
        const p = this.toDoc(ev.clientX, ev.clientY);
        this.pushPoint(this.drawing.stroke, p.x, p.y, this.pressureOf(ev));
      }
      this.schedule();
      return;
    }

    if (this.erasing && this.erasing.pointerId === e.pointerId) {
      const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      for (const ev of (events.length ? events : [e])) {
        const p = this.toDoc(ev.clientX, ev.clientY);
        this.eraserCursor = p;
        this.eraseAt(p.x, p.y);
      }
      this.schedule();
      return;
    }

    if (this.lasso && this.lasso.pointerId === e.pointerId) {
      const p = this.toDoc(e.clientX, e.clientY);
      const n = this.lasso.pts.length;
      const dx = p.x - this.lasso.pts[n - 2], dy = p.y - this.lasso.pts[n - 1];
      if (dx * dx + dy * dy > (3 / this.view.scale) ** 2) this.lasso.pts.push(p.x, p.y);
      this.schedule();
      return;
    }

    if (this.dragSel && this.dragSel.pointerId === e.pointerId) {
      const p = this.toDoc(e.clientX, e.clientY);
      const dx = p.x - this.dragSel.lastX, dy = p.y - this.dragSel.lastY;
      this.dragSel.lastX = p.x; this.dragSel.lastY = p.y;
      this.dragSel.dx += dx; this.dragSel.dy += dy;
      for (const s of this.strokes) if (this.selection.has(s.id)) translateStroke(s, dx, dy);
      this.invalidate();
      return;
    }

    if (this.settings.tool === 'eraser' && e.pointerType !== 'touch') {
      this.eraserCursor = this.toDoc(e.clientX, e.clientY);
      this.schedule();
    }
  }

  onUp(e, cancelled = false) {
    this.pointers.delete(e.pointerId);
    this.release(e.pointerId);

    if (this.pinch && this.pointers.size < 2) { this.pinch = null; }
    if (this.panning && this.panning.pointerId === e.pointerId) this.panning = null;

    if (this.drawing && this.drawing.pointerId === e.pointerId) {
      const stroke = this.drawing.stroke;
      this.drawing = null;
      if (!cancelled && stroke.points.length >= 3) {
        stroke.bbox = computeBBox(stroke);
        this.strokes.push(stroke);
        this.commit({ type: 'add', ids: [stroke.id] });
      }
      this.invalidate();
      return;
    }

    if (this.erasing && this.erasing.pointerId === e.pointerId) {
      const removed = this.erasing.removed;
      this.erasing = null;
      this.eraserCursor = null;
      if (removed.length) this.commit({ type: 'remove', items: removed });
      this.invalidate();
      return;
    }

    if (this.lasso && this.lasso.pointerId === e.pointerId) {
      const pts = this.lasso.pts;
      this.lasso = null;
      if (pts.length >= 8) this.selectByPolygon(pts);
      this.invalidate();
      this.onChange({ selection: true });
      return;
    }

    if (this.dragSel && this.dragSel.pointerId === e.pointerId) {
      const { dx, dy } = this.dragSel;
      this.dragSel = null;
      if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
        this.commit({ type: 'move', ids: [...this.selection], dx, dy });
      }
      this.invalidate();
    }
  }

  onWheel(e) {
    e.preventDefault();
    if (e.ctrlKey) {
      this.setZoom(this.view.scale * (e.deltaY < 0 ? 1.12 : 1 / 1.12), e.clientX, e.clientY);
    } else {
      this.view.y -= e.deltaY;
      this.view.x -= e.deltaX;
      this.clampView();
      this.invalidate();
    }
  }

  pressureOf(e) {
    if (e.pointerType !== 'pen') return 0.5;          // 指・マウスは一定の太さ
    const p = e.pressure;
    return p > 0 && p <= 1 ? p : 0.5;
  }

  pushPoint(stroke, x, y, pressure) {
    const p = stroke.points;
    if (p.length >= 3) {
      // 軽い平滑化(移動平均)で手ブレを抑える
      x = p[p.length - 3] * 0.35 + x * 0.65;
      y = p[p.length - 2] * 0.35 + y * 0.65;
      pressure = p[p.length - 1] * 0.5 + pressure * 0.5;
    }
    p.push(x, y, pressure);
  }

  /* ポインタキャプチャ。合成イベントなど掴めない場合もあるので失敗は無視する。 */
  capture(id) { try { this.canvas.setPointerCapture(id); } catch { /* noop */ } }
  release(id) { try { if (this.canvas.hasPointerCapture?.(id)) this.canvas.releasePointerCapture(id); } catch { /* noop */ } }

  /* ---------- ジェスチャ ---------- */
  beginPan(e) {
    this.capture(e.pointerId);
    this.panning = { pointerId: e.pointerId, lastX: e.clientX, lastY: e.clientY };
  }

  beginPinch() {
    const [a, b] = [...this.pointers.values()].slice(0, 2);
    if (!a || !b) return;
    this.panning = null;
    this.pinch = {
      dist: Math.hypot(a.x - b.x, a.y - b.y),
      cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2,
      scale: this.view.scale,
    };
  }

  updatePinch() {
    const [a, b] = [...this.pointers.values()].slice(0, 2);
    if (!a || !b || !this.pinch) return;
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
    this.view.x += cx - this.pinch.cx;
    this.view.y += cy - this.pinch.cy;
    this.pinch.cx = cx; this.pinch.cy = cy;
    if (this.pinch.dist > 8) {
      const target = this.pinch.scale * (dist / this.pinch.dist);
      const s = Math.min(5, Math.max(0.2, target));
      const r = this.canvas.getBoundingClientRect();
      const px = cx - r.left, py = cy - r.top;
      const docX = (px - this.view.x) / this.view.scale;
      const docY = (py - this.view.y) / this.view.scale;
      this.view.scale = s;
      this.view.x = px - docX * s;
      this.view.y = py - docY * s;
      this.onChange({ zoom: true });
    }
    this.clampView();
    this.invalidate();
  }

  abortStroke() {
    if (this.drawing) { this.drawing = null; this.invalidate(); }
    if (this.lasso) { this.lasso = null; this.invalidate(); }
  }

  /** ペンが触れた瞬間、手のひらで始まっていた操作を取り消す */
  abortTouchInteraction() {
    if (this.drawing && this.pointers.get(this.drawing.pointerId)?.type === 'touch') this.drawing = null;
    if (this.panning && this.pointers.get(this.panning.pointerId)?.type === 'touch') this.panning = null;
    this.invalidate();
  }

  /* ---------- 消しゴム ---------- */
  eraseAt(x, y) {
    const r = ERASER_SCREEN_R / this.view.scale;
    for (let i = this.strokes.length - 1; i >= 0; i--) {
      const s = this.strokes[i];
      if (strokeHit(s, x, y, r)) {
        this.strokes.splice(i, 1);
        this.erasing.removed.push({ index: i, stroke: s });
        this.invalidate();
      }
    }
  }

  /* ---------- 選択 ---------- */
  selectByPolygon(pts) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < pts.length; i += 2) {
      x0 = Math.min(x0, pts[i]); x1 = Math.max(x1, pts[i]);
      y0 = Math.min(y0, pts[i + 1]); y1 = Math.max(y1, pts[i + 1]);
    }
    const box = [x0, y0, x1, y1];
    this.selection.clear();
    for (const s of this.strokes) if (strokeInPolygon(s, pts, box)) this.selection.add(s.id);
  }

  insideSel(p) {
    const b = this.selBBox;
    return b && p.x >= b[0] - 10 && p.x <= b[2] + 10 && p.y >= b[1] - 10 && p.y <= b[3] + 10;
  }

  clearSelection(notify = true) {
    if (!this.selection.size) return;
    this.selection.clear();
    this.selBBox = null;
    this.invalidate();
    if (notify) this.onChange({ selection: true });
  }

  deleteSelection() {
    const items = [];
    for (let i = this.strokes.length - 1; i >= 0; i--) {
      if (this.selection.has(this.strokes[i].id)) {
        items.push({ index: i, stroke: this.strokes[i] });
        this.strokes.splice(i, 1);
      }
    }
    if (!items.length) return;
    this.clearSelection();
    this.commit({ type: 'remove', items });
    this.invalidate();
  }

  duplicateSelection() {
    const copies = [];
    for (const s of this.strokes) {
      if (!this.selection.has(s.id)) continue;
      copies.push(translateStroke(cloneStroke(s), 24, 24));
    }
    if (!copies.length) return;
    this.strokes.push(...copies);
    this.selection = new Set(copies.map((s) => s.id));
    this.commit({ type: 'add', ids: copies.map((s) => s.id) });
    this.invalidate();
    this.onChange({ selection: true });
  }

  /* ---------- ページ ---------- */
  addPage() {
    this.pageCount++;
    this.commit({ type: 'pages', delta: +1 });
    this.scrollToPage(this.pageCount - 1);
    this.invalidate();
  }

  scrollToPage(i) {
    this.view.y = -pageTop(i) * this.view.scale + 20;
    this.clampView();
    this.invalidate();
  }

  setPageStyle(style) {
    this.pageStyle = style;
    this.invalidate();
    this.onChange({ meta: true });
  }

  setTheme(theme) { this.theme = theme; this.invalidate(); }

  /* ---------- 履歴 ---------- */
  commit(op) {
    this.undoStack.push(op);
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack.length = 0;
    this.onHistory();
    this.onChange({ strokes: true });
  }

  undo() {
    const op = this.undoStack.pop();
    if (!op) return;
    this.applyInverse(op);
    this.redoStack.push(op);
    this.afterHistory();
  }

  redo() {
    const op = this.redoStack.pop();
    if (!op) return;
    this.applyForward(op);
    this.undoStack.push(op);
    this.afterHistory();
  }

  afterHistory() {
    this.clearSelection(false);
    this.invalidate();
    this.onHistory();
    this.onChange({ strokes: true });
  }

  applyInverse(op) {
    if (op.type === 'add') {
      const ids = new Set(op.ids);
      op.items = [];
      for (let i = this.strokes.length - 1; i >= 0; i--) {
        if (ids.has(this.strokes[i].id)) {
          op.items.push({ index: i, stroke: this.strokes[i] });
          this.strokes.splice(i, 1);
        }
      }
    } else if (op.type === 'remove') {
      [...op.items].reverse().forEach(({ index, stroke }) => this.strokes.splice(index, 0, stroke));
    } else if (op.type === 'move') {
      const ids = new Set(op.ids);
      for (const s of this.strokes) if (ids.has(s.id)) translateStroke(s, -op.dx, -op.dy);
    } else if (op.type === 'pages') {
      this.pageCount = Math.max(1, this.pageCount - op.delta);
    }
  }

  applyForward(op) {
    if (op.type === 'add') {
      [...op.items].reverse().forEach(({ index, stroke }) => this.strokes.splice(index, 0, stroke));
    } else if (op.type === 'remove') {
      const ids = new Set(op.items.map((it) => it.stroke.id));
      for (let i = this.strokes.length - 1; i >= 0; i--) if (ids.has(this.strokes[i].id)) this.strokes.splice(i, 1);
    } else if (op.type === 'move') {
      const ids = new Set(op.ids);
      for (const s of this.strokes) if (ids.has(s.id)) translateStroke(s, op.dx, op.dy);
    } else if (op.type === 'pages') {
      this.pageCount += op.delta;
    }
  }

  canUndo() { return this.undoStack.length > 0; }
  canRedo() { return this.redoStack.length > 0; }

  clearAll() {
    if (!this.strokes.length) return;
    const items = this.strokes.map((stroke, index) => ({ index, stroke })).reverse();
    this.strokes = [];
    this.commit({ type: 'remove', items });
    this.invalidate();
  }

  /** 今の表示位置から見えているページ番号 */
  currentPage() {
    const midY = (-this.view.y + this.canvas.clientHeight / 2) / this.view.scale;
    return Math.max(0, Math.min(this.pageCount - 1, Math.floor(midY / (PAGE_H + PAGE_GAP))));
  }
}
