/* アプリの状態(フォルダ・メモ一覧・設定)と保存処理をまとめた層。
   画面側はここだけを触り、IndexedDB を直接は使わない。 */

import * as db from './db.js';
import { newFolder, newNote, uid } from './model.js';

export const state = {
  folders: [],
  notes: [],
  settings: {
    theme: 'light',
    tool: 'pen',
    color: '#1c1c22',
    penWidth: 3,
    markerWidth: 22,
    fingerDraw: false,
    expanded: {},      // フォルダIDごとの開閉状態
    sort: 'updated',
  },
};

export async function load() {
  const [folders, notes, settings] = await Promise.all([
    db.getAll('folders'),
    db.getAll('notes'),
    db.get('meta', 'settings'),
  ]);
  state.folders = folders;
  state.notes = notes;
  if (settings) Object.assign(state.settings, settings);
}

let settingsTimer = null;
export function saveSettings() {
  clearTimeout(settingsTimer);
  settingsTimer = setTimeout(() => db.put('meta', { ...state.settings }, 'settings'), 250);
}

/* ---------- フォルダ ---------- */

export async function createFolder(name, parentId = null) {
  const f = newFolder(name, parentId);
  state.folders.push(f);
  await db.put('folders', f);
  return f;
}

export async function renameFolder(id, name) {
  const f = state.folders.find((x) => x.id === id);
  if (!f) return;
  f.name = name;
  await db.put('folders', f);
}

export function childFolders(parentId) {
  return state.folders
    .filter((f) => f.parentId === parentId)
    .sort((a, b) => a.name.localeCompare(b.name, 'ja'));
}

export function descendantFolderIds(id) {
  const out = [];
  const walk = (pid) => childFolders(pid).forEach((f) => { out.push(f.id); walk(f.id); });
  walk(id);
  return out;
}

/** フォルダを削除。中身は親フォルダへ引き上げる(誤操作でメモが消えないように)。 */
export async function deleteFolder(id) {
  const target = state.folders.find((f) => f.id === id);
  if (!target) return;
  const parentId = target.parentId;

  for (const f of state.folders.filter((f) => f.parentId === id)) {
    f.parentId = parentId;
    await db.put('folders', f);
  }
  for (const n of state.notes.filter((n) => n.folderId === id)) {
    n.folderId = parentId;
    await db.put('notes', n);
  }
  state.folders = state.folders.filter((f) => f.id !== id);
  await db.del('folders', id);
}

export async function moveFolder(id, newParentId) {
  if (id === newParentId) return;
  if (descendantFolderIds(id).includes(newParentId)) return;   // 自分の子孫には入れない
  const f = state.folders.find((x) => x.id === id);
  if (!f) return;
  f.parentId = newParentId;
  await db.put('folders', f);
}

export function folderPath(id) {
  const names = [];
  let cur = state.folders.find((f) => f.id === id);
  while (cur) {
    names.unshift(cur.name);
    cur = state.folders.find((f) => f.id === cur.parentId);
  }
  return names;
}

/* ---------- メモ ---------- */

export function notesIn(folderId, { recursive = false } = {}) {
  if (folderId === null) return state.notes.slice();      // 「すべてのメモ」
  const ids = recursive ? [folderId, ...descendantFolderIds(folderId)] : [folderId];
  return state.notes.filter((n) => ids.includes(n.folderId));
}

export function countIn(folderId) {
  const ids = [folderId, ...descendantFolderIds(folderId)];
  return state.notes.filter((n) => ids.includes(n.folderId)).length;
}

export async function createNote(folderId) {
  const n = newNote(folderId, 'line');
  state.notes.push(n);
  await db.put('notes', n);
  await db.put('docs', { noteId: n.id, strokes: [] });
  return n;
}

export async function updateNote(note, patch = {}) {
  Object.assign(note, patch, { updatedAt: Date.now() });
  await db.put('notes', { ...note });
}

export async function deleteNote(id) {
  state.notes = state.notes.filter((n) => n.id !== id);
  await db.del('notes', id);
  await db.del('docs', id);
}

export async function duplicateNote(id) {
  const src = state.notes.find((n) => n.id === id);
  if (!src) return null;
  const doc = await loadDoc(id);
  const copy = { ...src, id: uid('n'), title: (src.title || '無題のメモ') + ' のコピー', createdAt: Date.now(), updatedAt: Date.now() };
  state.notes.push(copy);
  await db.put('notes', copy);
  await db.put('docs', { noteId: copy.id, strokes: doc.strokes.map((s) => ({ ...s, id: uid('s'), points: s.points.slice() })) });
  return copy;
}

export async function loadDoc(noteId) {
  return (await db.get('docs', noteId)) || { noteId, strokes: [] };
}

export async function saveDoc(noteId, strokes) {
  await db.put('docs', { noteId, strokes });
}

/* ---------- バックアップ ---------- */

export async function exportAll() {
  const docs = await db.getAll('docs');
  return {
    app: 'tegaki-memo', version: 1, exportedAt: new Date().toISOString(),
    folders: state.folders, notes: state.notes, docs,
  };
}

export async function importAll(data, { replace = false } = {}) {
  if (!data || data.app !== 'tegaki-memo') throw new Error('このファイルは てがきメモ のバックアップではありません');
  if (replace) await db.clearAll();

  // ID 衝突を避けるため、追加インポート時は付け替える
  const fmap = new Map(), nmap = new Map();
  const folders = (data.folders || []).map((f) => {
    const id = replace ? f.id : uid('f');
    fmap.set(f.id, id);
    return { ...f, id };
  });
  folders.forEach((f) => { if (f.parentId) f.parentId = fmap.get(f.parentId) ?? null; });

  const notes = (data.notes || []).map((n) => {
    const id = replace ? n.id : uid('n');
    nmap.set(n.id, id);
    return { ...n, id, folderId: n.folderId ? (fmap.get(n.folderId) ?? null) : null };
  });
  const docs = (data.docs || []).map((d) => ({ ...d, noteId: nmap.get(d.noteId) ?? d.noteId }));

  await db.bulkPut('folders', folders);
  await db.bulkPut('notes', notes);
  await db.bulkPut('docs', docs);
  await load();
}
