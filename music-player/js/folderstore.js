// 選んだ音楽フォルダを覚えておくための保管庫。
//
// ブラウザは「このパスを読んで」と指定することを許していないが、一度利用者が
// 選んだフォルダの参照(ハンドル)は保存でき、次回はそれを開き直せる。
// これで「閉じたら曲が消える」状態をなくす。
//
// 参照そのものは JSON にできないため localStorage では保存できず、IndexedDB を使う。

const DB_NAME = 'cassette';
const STORE = 'handles';
const KEY = 'musicDir';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore(mode, fn) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

/** 選んだフォルダを覚える */
export async function rememberFolder(handle) {
  try {
    await withStore('readwrite', (s) => s.put(handle, KEY));
    return true;
  } catch {
    return false;
  }
}

/** 前回のフォルダを取り出す(無ければ null) */
export async function recallFolder() {
  try {
    return (await withStore('readonly', (s) => s.get(KEY))) ?? null;
  } catch {
    return null;
  }
}

export async function forgetFolder() {
  try {
    await withStore('readwrite', (s) => s.delete(KEY));
  } catch { /* 消せなくても実害はない */ }
}

/**
 * 保存したフォルダを読める状態か調べる。
 * @returns 'granted'(すぐ読める) / 'prompt'(利用者の操作が要る) / 'denied' / 'unsupported'
 */
export async function folderPermission(handle) {
  if (!handle?.queryPermission) return 'unsupported';
  try {
    return await handle.queryPermission({ mode: 'read' });
  } catch {
    return 'denied';
  }
}

/** 読み取りの許可を求める(ボタン押下など、利用者の操作の中から呼ぶこと) */
export async function askFolderPermission(handle) {
  if (!handle?.requestPermission) return 'unsupported';
  try {
    return await handle.requestPermission({ mode: 'read' });
  } catch {
    return 'denied';
  }
}
