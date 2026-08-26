/* ダイアログ・トーストなどの共通 UI。
   タブレットで押しやすいよう、ボタンは大きめ・縦並びを基本にしている。 */

const backdrop = document.getElementById('sheet-backdrop');
const sheet = document.getElementById('sheet');
const toastEl = document.getElementById('toast');

let closer = null;

export function closeSheet(result) {
  backdrop.hidden = true;
  sheet.innerHTML = '';
  const c = closer; closer = null;
  if (c) c(result);
}

backdrop.addEventListener('pointerdown', (e) => { if (e.target === backdrop) closeSheet(null); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !backdrop.hidden) closeSheet(null); });

function openSheet(build) {
  return new Promise((resolve) => {
    closer = resolve;
    sheet.innerHTML = '';
    build(sheet, (v) => closeSheet(v));
    backdrop.hidden = false;
  });
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** テキスト入力ダイアログ。OK なら文字列、キャンセルなら null。 */
export function promptText(title, value = '', okLabel = 'OK') {
  return openSheet((el, done) => {
    el.innerHTML = `
      <h2>${esc(title)}</h2>
      <input type="text" id="sheet-text" value="${esc(value)}">
      <div class="sheet-actions">
        <button class="ghost-btn" data-act="cancel">キャンセル</button>
        <button class="primary-btn" data-act="ok">${esc(okLabel)}</button>
      </div>`;
    const input = el.querySelector('#sheet-text');
    setTimeout(() => { input.focus(); input.select(); }, 30);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(input.value.trim() || null); });
    el.querySelector('[data-act="ok"]').onclick = () => done(input.value.trim() || null);
    el.querySelector('[data-act="cancel"]').onclick = () => done(null);
  });
}

/** 確認ダイアログ。true / false を返す。 */
export function confirmDialog(title, message, okLabel = '削除', danger = true) {
  return openSheet((el, done) => {
    el.innerHTML = `
      <h2>${esc(title)}</h2>
      <p style="margin:0 0 16px;color:var(--text-dim)">${esc(message)}</p>
      <div class="sheet-actions">
        <button class="ghost-btn" data-act="cancel">キャンセル</button>
        <button class="primary-btn" data-act="ok" ${danger ? 'style="background:var(--danger)"' : ''}>${esc(okLabel)}</button>
      </div>`;
    el.querySelector('[data-act="ok"]').onclick = () => done(true);
    el.querySelector('[data-act="cancel"]').onclick = () => done(false);
  });
}

/** 選択メニュー。items = [{ id, label, danger }] 。選ばれた id を返す。 */
export function menuSheet(title, items) {
  return openSheet((el, done) => {
    el.innerHTML = `<h2>${esc(title)}</h2><div class="sheet-list">${
      items.map((it) => `<button data-id="${esc(it.id)}" class="${it.danger ? 'danger' : ''}">${esc(it.label)}</button>`).join('')
    }</div>`;
    el.querySelectorAll('button[data-id]').forEach((b) => {
      b.onclick = () => done(b.dataset.id);
    });
  });
}

/** 任意の HTML を出す汎用シート。build(el, done) を渡す。 */
export const customSheet = openSheet;

let toastTimer = null;
export function toast(msg, ms = 1800) {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, ms);
}

export function formatDate(ts) {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const p = (n) => String(n).padStart(2, '0');
  return sameDay
    ? `今日 ${p(d.getHours())}:${p(d.getMinutes())}`
    : `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
