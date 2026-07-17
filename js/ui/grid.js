/* ============================================================
   打ち込みグリッドの描画と入力(タップ&なぞり)
   データには直接触らず、onPaint コールバックで通知するだけ。
   ============================================================ */

export class GridView {
  /**
   * @param {HTMLElement} el グリッドのコンテナ
   * @param {(dataRow:number, step:number, value:boolean) => void} onPaint
   *        マスの状態が変わったときに呼ばれる(値の保存と試聴は呼び出し側の仕事)
   */
  constructor(el, onPaint) {
    this.el = el;
    this.onPaint = onPaint;
    this.columnCells = []; // 再生ハイライト用: columnCells[step] = [セル要素...]
    this._grid = null;     // 描画中のトラックの bool[][](表示状態の判定に使う)

    this._painting = false;
    this._paintValue = true;
    this._painted = new Set();

    el.addEventListener('pointerdown', (e) => {
      const cell = e.target.closest('.cell');
      if (!cell) return;
      e.preventDefault();
      this._painting = true;
      this._painted = new Set();
      this._paintValue = !this._grid[Number(cell.dataset.row)][Number(cell.dataset.step)];
      this._apply(cell);
    });
    el.addEventListener('pointermove', (e) => {
      if (!this._painting) return;
      e.preventDefault();
      const hit = document.elementFromPoint(e.clientX, e.clientY);
      if (hit) this._apply(hit.closest('.cell'));
    });
    window.addEventListener('pointerup', () => { this._painting = false; });
    window.addEventListener('pointercancel', () => { this._painting = false; });
    // なぞり入力中はスクロールさせない
    el.addEventListener('touchmove', (e) => { if (this._painting) e.preventDefault(); }, { passive: false });
  }

  _apply(cell) {
    if (!cell || !cell.classList.contains('cell')) return;
    const key = cell.dataset.row + ':' + cell.dataset.step;
    if (this._painted.has(key)) return;
    this._painted.add(key);
    const row = Number(cell.dataset.row);
    const step = Number(cell.dataset.step);
    if (this._grid[row][step] === this._paintValue) return;
    this._grid[row][step] = this._paintValue;
    cell.classList.toggle('on', this._paintValue);
    this.onPaint(row, step, this._paintValue);
  }

  /**
   * グリッドを描き直す
   * @param {object} view { steps, rows: [{dataRow,label,strong}], color, grid: bool[][] }
   */
  render({ steps, rows, color, grid }) {
    this._grid = grid;
    const el = this.el;
    el.innerHTML = '';
    el.style.gridTemplateColumns = `var(--label-w) repeat(${steps}, var(--cell-size))`;
    this.columnCells = Array.from({ length: steps }, () => []);

    // 上段: 拍の目盛り(1・2・3・4)
    const corner = document.createElement('div');
    corner.className = 'row-label';
    el.appendChild(corner);
    for (let s = 0; s < steps; s++) {
      const c = document.createElement('div');
      c.className = 'ruler-cell' + (s % 4 === 0 ? ' beat' : '');
      c.textContent = s % 4 === 0 ? String(s / 4 + 1) : '・';
      el.appendChild(c);
      this.columnCells[s].push(c);
    }

    for (const row of rows) {
      const label = document.createElement('div');
      label.className = 'row-label' + (row.strong ? ' strong' : '');
      label.textContent = row.label;
      el.appendChild(label);

      for (let s = 0; s < steps; s++) {
        const cell = document.createElement('button');
        cell.type = 'button';
        cell.className = 'cell' + (Math.floor(s / 4) % 2 === 0 ? '' : ' beat');
        cell.style.setProperty('--row-color', color);
        cell.dataset.row = row.dataRow;
        cell.dataset.step = s;
        if (grid[row.dataRow][s]) cell.classList.add('on');
        el.appendChild(cell);
        this.columnCells[s].push(cell);
      }
    }
  }

  /** 再生位置の列をハイライトする(-1で消灯) */
  highlight(step) {
    this.el.querySelectorAll('.playing').forEach(x => x.classList.remove('playing'));
    if (step >= 0 && this.columnCells[step]) {
      this.columnCells[step].forEach(x => x.classList.add('playing'));
    }
  }
}
