/* 一覧画面(フォルダツリー + メモのカード一覧)。 */

import * as store from './store.js';
import { state } from './store.js';
import { promptText, confirmDialog, menuSheet, toast, formatDate } from './ui.js';

const els = {
  tree: document.getElementById('folder-tree'),
  grid: document.getElementById('note-grid'),
  empty: document.getElementById('empty-state'),
  title: document.getElementById('current-folder-name'),
  search: document.getElementById('search-input'),
  sidebar: document.getElementById('sidebar'),
};

export const view = { folderId: null, query: '', };

let onOpenNote = () => {};

export function init(handlers) {
  onOpenNote = handlers.openNote;

  els.search.addEventListener('input', () => {
    view.query = els.search.value.trim();
    renderNotes();
  });

  document.querySelectorAll('.seg-btn[data-sort]').forEach((b) => {
    b.classList.toggle('is-on', b.dataset.sort === state.settings.sort);
    b.addEventListener('click', () => {
      state.settings.sort = b.dataset.sort;
      store.saveSettings();
      document.querySelectorAll('.seg-btn[data-sort]').forEach((x) => x.classList.toggle('is-on', x === b));
      renderNotes();
    });
  });

  document.getElementById('btn-new-folder').addEventListener('click', async () => {
    const name = await promptText('新しいフォルダ', '', '作成');
    if (!name) return;
    const parent = view.folderId;
    const f = await store.createFolder(name, parent);
    if (parent) state.settings.expanded[parent] = true;
    view.folderId = f.id;
    store.saveSettings();
    renderAll();
  });

  document.getElementById('btn-open-sidebar').addEventListener('click', () => els.sidebar.classList.add('open'));
  document.getElementById('btn-close-sidebar').addEventListener('click', () => els.sidebar.classList.remove('open'));
}

export function renderAll() { renderTree(); renderNotes(); }

/* ---------- フォルダツリー ---------- */

function treeRow({ id, label, icon, count, depth, hasChildren, expanded }) {
  const row = document.createElement('div');
  row.className = 'tree-row' + (view.folderId === id ? ' is-on' : '');
  row.dataset.folderId = id ?? '';
  row.style.paddingLeft = 4 + depth * 14 + 'px';

  const twisty = document.createElement('button');
  twisty.className = 'tree-twisty' + (hasChildren ? '' : ' empty');
  twisty.textContent = expanded ? '▼' : '▶';
  twisty.addEventListener('click', (e) => {
    e.stopPropagation();
    state.settings.expanded[id] = !expanded;
    store.saveSettings();
    renderTree();
  });

  const label_ = document.createElement('span');
  label_.className = 'tree-label';
  label_.textContent = `${icon} ${label}`;

  const cnt = document.createElement('span');
  cnt.className = 'tree-count';
  cnt.textContent = count;

  row.append(twisty, label_, cnt);

  if (id) {
    const menu = document.createElement('button');
    menu.className = 'tree-menu';
    menu.textContent = '⋯';
    menu.setAttribute('aria-label', 'フォルダの操作');
    menu.addEventListener('click', (e) => { e.stopPropagation(); folderMenu(id); });
    row.append(menu);
  }

  row.addEventListener('click', () => {
    view.folderId = id;
    els.sidebar.classList.remove('open');
    renderAll();
  });

  // メモをドラッグして移動(マウス操作向け。タップ操作は「⋯ → 移動」)
  row.addEventListener('dragover', (e) => { e.preventDefault(); row.classList.add('drop-target'); });
  row.addEventListener('dragleave', () => row.classList.remove('drop-target'));
  row.addEventListener('drop', async (e) => {
    e.preventDefault();
    row.classList.remove('drop-target');
    const noteId = e.dataTransfer.getData('text/note-id');
    const note = state.notes.find((n) => n.id === noteId);
    if (!note) return;
    await store.updateNote(note, { folderId: id });
    renderAll();
    toast('移動しました');
  });

  return row;
}

export function renderTree() {
  els.tree.innerHTML = '';
  els.tree.append(treeRow({
    id: null, label: 'すべてのメモ', icon: '🗂', count: state.notes.length,
    depth: 0, hasChildren: false, expanded: false,
  }));

  const walk = (parentId, depth) => {
    for (const f of store.childFolders(parentId)) {
      const children = store.childFolders(f.id);
      const expanded = !!state.settings.expanded[f.id];
      els.tree.append(treeRow({
        id: f.id, label: f.name, icon: expanded ? '📂' : '📁',
        count: store.countIn(f.id), depth, hasChildren: children.length > 0, expanded,
      }));
      if (expanded) walk(f.id, depth + 1);
    }
  };
  walk(null, 0);
}

async function folderMenu(id) {
  const folder = state.folders.find((f) => f.id === id);
  if (!folder) return;
  const act = await menuSheet(folder.name, [
    { id: 'rename', label: '✏️ 名前を変更' },
    { id: 'sub', label: '📁 サブフォルダを作る' },
    { id: 'move', label: '➡️ 別のフォルダへ移動' },
    { id: 'delete', label: '🗑 削除(中身は親フォルダへ)', danger: true },
  ]);
  if (act === 'rename') {
    const name = await promptText('フォルダ名', folder.name, '変更');
    if (name) { await store.renameFolder(id, name); renderAll(); }
  } else if (act === 'sub') {
    const name = await promptText('サブフォルダ名', '', '作成');
    if (name) {
      await store.createFolder(name, id);
      state.settings.expanded[id] = true;
      store.saveSettings();
      renderTree();
    }
  } else if (act === 'move') {
    const dest = await pickFolder('移動先を選ぶ', [id, ...store.descendantFolderIds(id)]);
    if (dest !== undefined) { await store.moveFolder(id, dest); renderAll(); }
  } else if (act === 'delete') {
    const ok = await confirmDialog('フォルダを削除', `「${folder.name}」を削除します。中のメモとサブフォルダは親フォルダに移動します。`);
    if (ok) {
      await store.deleteFolder(id);
      if (view.folderId === id) view.folderId = folder.parentId;
      renderAll();
      toast('削除しました');
    }
  }
}

/** フォルダ選択ダイアログ。ルート(未分類)は null を返す。キャンセルは undefined。 */
export async function pickFolder(title, excludeIds = []) {
  const items = [{ id: '__root__', label: '🗂 すべてのメモ(フォルダなし)' }];
  const walk = (parentId, depth) => {
    for (const f of store.childFolders(parentId)) {
      if (!excludeIds.includes(f.id)) {
        items.push({ id: f.id, label: '　'.repeat(depth) + '📁 ' + f.name });
      }
      walk(f.id, depth + 1);
    }
  };
  walk(null, 0);
  const picked = await menuSheet(title, items);
  if (picked === null) return undefined;
  return picked === '__root__' ? null : picked;
}

/* ---------- メモ一覧 ---------- */

function sortNotes(list) {
  const s = state.settings.sort;
  return list.sort((a, b) => {
    if (s === 'title') return (a.title || '無題のメモ').localeCompare(b.title || '無題のメモ', 'ja');
    if (s === 'created') return b.createdAt - a.createdAt;
    return b.updatedAt - a.updatedAt;
  });
}

export function renderNotes() {
  const q = view.query.toLowerCase();
  let list = q
    ? state.notes.filter((n) => (n.title || '無題のメモ').toLowerCase().includes(q))
    : store.notesIn(view.folderId, { recursive: false });
  list = sortNotes(list.slice());

  const path = view.folderId ? store.folderPath(view.folderId).join(' / ') : 'すべてのメモ';
  els.title.textContent = q ? `「${view.query}」の検索結果` : path;

  els.grid.innerHTML = '';
  els.empty.hidden = list.length > 0;
  els.grid.hidden = list.length === 0;

  for (const n of list) els.grid.append(noteCard(n));
}

function noteCard(note) {
  const card = document.createElement('div');
  card.className = 'note-card';
  card.draggable = true;
  card.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/note-id', note.id));

  const thumb = document.createElement('div');
  thumb.className = 'note-thumb';
  if (note.thumb) {
    const img = document.createElement('img');
    img.src = note.thumb;
    img.alt = '';
    thumb.append(img);
  }

  const meta = document.createElement('div');
  meta.className = 'note-meta';
  const t = document.createElement('div');
  t.className = 't';
  t.innerHTML = '<div class="note-name"></div><div class="note-date"></div>';
  t.querySelector('.note-name').textContent = note.title || '無題のメモ';
  t.querySelector('.note-date').textContent = formatDate(note.updatedAt);

  const menu = document.createElement('button');
  menu.className = 'icon-btn';
  menu.textContent = '⋯';
  menu.setAttribute('aria-label', 'メモの操作');
  menu.addEventListener('click', (e) => { e.stopPropagation(); noteMenu(note); });

  meta.append(t, menu);
  card.append(thumb, meta);
  card.addEventListener('click', () => onOpenNote(note.id));
  return card;
}

async function noteMenu(note) {
  const act = await menuSheet(note.title || '無題のメモ', [
    { id: 'rename', label: '✏️ 名前を変更' },
    { id: 'move', label: '📁 フォルダへ移動' },
    { id: 'dup', label: '⧉ 複製' },
    { id: 'delete', label: '🗑 削除', danger: true },
  ]);
  if (act === 'rename') {
    const title = await promptText('メモの名前', note.title, '変更');
    if (title) { await store.updateNote(note, { title }); renderNotes(); }
  } else if (act === 'move') {
    const dest = await pickFolder('移動先を選ぶ');
    if (dest !== undefined) { await store.updateNote(note, { folderId: dest }); renderAll(); toast('移動しました'); }
  } else if (act === 'dup') {
    await store.duplicateNote(note.id);
    renderAll();
    toast('複製しました');
  } else if (act === 'delete') {
    const ok = await confirmDialog('メモを削除', `「${note.title || '無題のメモ'}」を削除します。元に戻せません。`);
    if (ok) { await store.deleteNote(note.id); renderAll(); toast('削除しました'); }
  }
}
