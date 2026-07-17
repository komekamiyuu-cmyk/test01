/* ============================================================
   トラック設定UIの部品
   楽器モジュールが buildControls() の中で使う共通ヘルパー。
   楽器側はDOMの細部を知らずに「セレクタ」「スライダー」を置ける。
   ============================================================ */

/**
 * セレクトボックスを追加する
 * @param {Object<string,string>} options {値: 表示名}
 */
export function makeSelect(container, label, options, value, onChange) {
  const wrap = document.createElement('label');
  wrap.className = 'inst-ctrl';
  const span = document.createElement('span');
  span.textContent = label;
  const sel = document.createElement('select');
  for (const [val, text] of Object.entries(options)) {
    const opt = document.createElement('option');
    opt.value = val;
    opt.textContent = text;
    sel.appendChild(opt);
  }
  sel.value = value;
  sel.addEventListener('change', () => onChange(sel.value));
  wrap.append(span, sel);
  container.appendChild(wrap);
  return sel;
}

/** スライダーを追加する(値は数値で渡ってくる) */
export function makeSlider(container, label, { min, max, step, value, fmt }, onChange) {
  const wrap = document.createElement('label');
  wrap.className = 'inst-ctrl';
  const span = document.createElement('span');
  span.textContent = label;
  const input = document.createElement('input');
  input.type = 'range';
  input.min = min;
  input.max = max;
  input.step = step;
  input.value = value;
  const val = document.createElement('output');
  const show = (v) => { val.textContent = fmt ? fmt(v) : String(v); };
  show(value);
  input.addEventListener('input', () => {
    const v = Number(input.value);
    show(v);
    onChange(v);
  });
  wrap.append(span, input, val);
  container.appendChild(wrap);
  return input;
}
