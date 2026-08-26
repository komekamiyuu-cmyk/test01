/* 画面の切り替えと、エディタまわりの配線。アプリの入口。 */

import * as store from './store.js';
import { state } from './store.js';
import * as lib from './library.js';
import { Editor } from './editor.js';
import { COLORS, PEN_WIDTHS, MARKER_WIDTHS, PAGE_STYLES } from './model.js';
import { renderThumb, renderPagePNG } from './ink.js';
import { promptText, confirmDialog, menuSheet, toast } from './ui.js';

const $ = (id) => document.getElementById(id);
const screens = { library: $('library'), editor: $('editor') };

let editor = null;
let current = null;          // 開いているメモ(メタ情報)
let saveTimer = null;
let thumbAt = 0;

/* ---------- テーマ ---------- */
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]').content = theme === 'dark' ? '#16171c' : '#f5f5f7';
  if (editor) editor.setTheme(theme);
}

/* ---------- 起動 ---------- */
async function boot() {
  await store.load();
  applyTheme(state.settings.theme);

  if (state.folders.length === 0 && state.notes.length === 0) {
    await store.createFolder('しごと');
    await store.createFolder('がっこう');
    await store.createFolder('アイデア');
  }

  lib.init({ openNote });
  lib.renderAll();
  buildToolbar();
  wireLibrary();
  wireEditor();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

function show(name) {
  screens.library.hidden = name !== 'library';
  screens.editor.hidden = name !== 'editor';
}

/* ---------- ライブラリ画面の配線 ---------- */
function wireLibrary() {
  const newNote = async () => {
    const note = await store.createNote(lib.view.folderId);
    lib.renderAll();
    openNote(note.id);
  };
  $('btn-new-note').addEventListener('click', newNote);
  $('btn-new-note-empty').addEventListener('click', newNote);

  $('btn-theme').addEventListener('click', () => {
    state.settings.theme = state.settings.theme === 'dark' ? 'light' : 'dark';
    store.saveSettings();
    applyTheme(state.settings.theme);
  });

  $('btn-export-all').addEventListener('click', async () => {
    const data = await store.exportAll();
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `tegaki-memo-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast('バックアップを書き出しました');
  });

  const fileInput = $('file-input');
  $('btn-import-all').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const mode = await menuSheet('復元のしかた', [
        { id: 'merge', label: '➕ 今のデータに追加する' },
        { id: 'replace', label: '♻️ 今のデータを消して置き換える', danger: true },
      ]);
      if (!mode) return;
      if (mode === 'replace' && !(await confirmDialog('置き換え', '今あるメモはすべて消えます。よろしいですか?', '置き換える'))) return;
      await store.importAll(data, { replace: mode === 'replace' });
      lib.renderAll();
      toast('復元しました');
    } catch (err) {
      toast(err.message || '読み込みに失敗しました', 2600);
    }
  });
}

/* ---------- ツールバー ---------- */
function buildToolbar() {
  const sw = $('swatches');
  sw.innerHTML = '';
  COLORS.forEach((c) => {
    const b = document.createElement('button');
    b.className = 'swatch';
    b.style.background = c;
    b.dataset.color = c;
    b.setAttribute('aria-label', '色 ' + c);
    b.addEventListener('click', () => {
      state.settings.color = c;
      store.saveSettings();
      syncToolbar();
    });
    sw.append(b);
  });
  renderWidths();
  syncToolbar();

  document.querySelectorAll('.tool[data-tool]').forEach((b) => {
    b.addEventListener('click', () => {
      state.settings.tool = b.dataset.tool;
      store.saveSettings();
      if (b.dataset.tool !== 'lasso' && editor) editor.clearSelection();
      renderWidths();
      syncToolbar();
    });
  });

  $('btn-finger').addEventListener('click', () => {
    state.settings.fingerDraw = !state.settings.fingerDraw;
    store.saveSettings();
    syncToolbar();
    toast(state.settings.fingerDraw ? '指でも描けます' : '指はスクロール専用にしました');
  });

  $('btn-fit').addEventListener('click', () => editor && editor.fitWidth());
}

function renderWidths() {
  const list = state.settings.tool === 'marker' ? MARKER_WIDTHS : PEN_WIDTHS;
  const el = $('widths');
  el.innerHTML = '';
  list.forEach((w) => {
    const b = document.createElement('button');
    b.className = 'wbtn';
    b.dataset.width = w;
    b.innerHTML = `<i style="height:${Math.max(2, Math.min(14, w * 0.7))}px"></i>`;
    b.addEventListener('click', () => {
      if (state.settings.tool === 'marker') state.settings.markerWidth = w;
      else state.settings.penWidth = w;
      store.saveSettings();
      syncToolbar();
    });
    el.append(b);
  });
}

function syncToolbar() {
  const s = state.settings;
  document.querySelectorAll('.tool[data-tool]').forEach((b) => b.classList.toggle('is-on', b.dataset.tool === s.tool));
  document.querySelectorAll('.swatch').forEach((b) => b.classList.toggle('is-on', b.dataset.color === s.color));
  const w = s.tool === 'marker' ? s.markerWidth : s.penWidth;
  document.querySelectorAll('.wbtn').forEach((b) => b.classList.toggle('is-on', Number(b.dataset.width) === w));
  $('btn-finger').classList.toggle('is-on', s.fingerDraw);
}

/* ---------- エディタ画面の配線 ---------- */
function wireEditor() {
  editor = new Editor({
    canvas: $('canvas'),
    wrap: $('canvas-wrap'),
    settings: state.settings,
    onChange: onEditorChange,
    onHistory: syncHistory,
  });
  editor.setTheme(state.settings.theme);
  window.__ed = editor;            // デバッグ・動作確認用のハンドル

  new ResizeObserver(() => editor.resize()).observe($('canvas-wrap'));

  $('btn-back').addEventListener('click', closeNote);
  $('btn-undo').addEventListener('click', () => editor.undo());
  $('btn-redo').addEventListener('click', () => editor.redo());
  $('page-add').addEventListener('click', () => { editor.addPage(); scheduleSave(); });
  $('btn-more').addEventListener('click', moreMenu);

  $('sel-delete').addEventListener('click', () => editor.deleteSelection());
  $('sel-duplicate').addEventListener('click', () => editor.duplicateSelection());
  $('sel-cancel').addEventListener('click', () => editor.clearSelection());

  $('note-title').addEventListener('input', () => {
    if (!current) return;
    current.title = $('note-title').value;
    scheduleSave();
  });

  document.addEventListener('keydown', (e) => {
    if (screens.editor.hidden) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      e.shiftKey ? editor.redo() : editor.undo();
    } else if (mod && e.key.toLowerCase() === 'y') {
      e.preventDefault(); editor.redo();
    } else if (e.key === 'Escape') {
      editor.clearSelection();
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      if (document.activeElement === $('note-title')) return;
      editor.deleteSelection();
    }
  });

  window.addEventListener('beforeunload', () => { if (current) saveNow(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && current) saveNow(); });
}

async function openNote(id) {
  const note = state.notes.find((n) => n.id === id);
  if (!note) return;
  current = note;
  const doc = await store.loadDoc(id);
  $('note-title').value = note.title || '';
  show('editor');
  editor.resize();
  editor.loadNote(note, doc.strokes || []);
  syncHistory();
  updateSelActions();
  setSaveState('保存済み');
}

async function closeNote() {
  await saveNow(true);
  current = null;
  show('library');
  lib.renderAll();
}

function onEditorChange(what = {}) {
  if (what.zoom) showZoom();
  if (what.selection) updateSelActions();
  if (what.strokes || what.meta) scheduleSave();
}

function updateSelActions() {
  $('sel-actions').hidden = !(editor && editor.selection.size);
}

function syncHistory() {
  $('btn-undo').disabled = !editor.canUndo();
  $('btn-redo').disabled = !editor.canRedo();
  $('btn-undo').style.opacity = editor.canUndo() ? 1 : 0.35;
  $('btn-redo').style.opacity = editor.canRedo() ? 1 : 0.35;
}

let zoomTimer = null;
function showZoom() {
  const el = $('zoom-badge');
  el.textContent = Math.round(editor.view.scale * 100) + '%';
  el.classList.add('show');
  clearTimeout(zoomTimer);
  zoomTimer = setTimeout(() => el.classList.remove('show'), 900);
}

function setSaveState(text) { $('save-state').textContent = text; }

function scheduleSave() {
  setSaveState('保存中…');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveNow(), 700);
}

async function saveNow(force = false) {
  if (!current || !editor) return;
  clearTimeout(saveTimer);
  const strokes = editor.strokes;
  await store.saveDoc(current.id, strokes);

  const now = Date.now();
  const patch = {
    title: $('note-title').value,
    pageCount: editor.pageCount,
    pageStyle: editor.pageStyle,
  };
  if (force || now - thumbAt > 4000) {
    thumbAt = now;
    try { patch.thumb = renderThumb(strokes, editor.pageStyle); } catch { /* 対応外の形式は諦める */ }
  }
  await store.updateNote(current, patch);
  setSaveState('保存済み');
}

/* ---------- その他メニュー ---------- */
async function moreMenu() {
  const act = await menuSheet('メモの設定', [
    { id: 'paper', label: '📄 用紙の種類' },
    { id: 'page', label: '➕ ページを追加' },
    { id: 'png', label: '🖼 このページを画像で保存' },
    { id: 'move', label: '📁 フォルダへ移動' },
    { id: 'rename', label: '✏️ 名前を変更' },
    { id: 'clear', label: '🧹 このメモを全部消す', danger: true },
    { id: 'delete', label: '🗑 メモを削除', danger: true },
  ]);
  if (!act) return;

  if (act === 'paper') {
    const style = await menuSheet('用紙の種類', PAGE_STYLES.map((p) => ({ id: p.id, label: p.name })));
    if (style) { editor.setPageStyle(style); scheduleSave(); }
  } else if (act === 'page') {
    editor.addPage(); scheduleSave();
  } else if (act === 'png') {
    const cv = renderPagePNG(editor.strokes, editor.pageStyle, editor.currentPage());
    cv.toBlob((blob) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${(current.title || 'memo')}-p${editor.currentPage() + 1}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      toast('画像を保存しました');
    }, 'image/png');
  } else if (act === 'move') {
    const dest = await lib.pickFolder('移動先を選ぶ');
    if (dest !== undefined) { await store.updateNote(current, { folderId: dest }); toast('移動しました'); }
  } else if (act === 'rename') {
    const title = await promptText('メモの名前', current.title, '変更');
    if (title) { $('note-title').value = title; current.title = title; scheduleSave(); }
  } else if (act === 'clear') {
    if (await confirmDialog('全部消す', 'このメモの手書きをすべて消します。(元に戻す で復活できます)', '消す')) {
      editor.clearAll();
    }
  } else if (act === 'delete') {
    if (await confirmDialog('メモを削除', 'このメモを削除します。元に戻せません。')) {
      const id = current.id;
      current = null;
      await store.deleteNote(id);
      show('library');
      lib.renderAll();
      toast('削除しました');
    }
  }
}

boot();
