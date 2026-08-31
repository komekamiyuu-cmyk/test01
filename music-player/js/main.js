// カセットプレーヤー — メインロジック
import { readTags } from './metadata.js';
import { drawShareCard, serialOf } from './share.js';
import {
  rememberFolder, recallFolder, forgetFolder, folderPermission, askFolderPermission,
} from './folderstore.js';

const AUDIO_EXT = /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac|weba|webm)$/i;

const $ = (id) => document.getElementById(id);
const audio = $('audio');

const state = {
  tracks: [],                 // {key,file,url,title,artist,album,genre,artUrl}
  favorites: new Set(load('favorites', [])),
  playlists: load('playlists', {}),   // 名前 -> [key]
  queue: [],
  qIndex: -1,
  history: [],
  shuffle: false,
  playing: false,
  tab: 'albums',
  detail: null,               // {type:'album'|'genre'|'playlist', name}
};

function load(k, fallback) {
  try { return JSON.parse(localStorage.getItem('cassette.' + k)) ?? fallback; }
  catch { return fallback; }
}
function save(k, v) {
  localStorage.setItem('cassette.' + k, JSON.stringify(v));
}
function persistFavs() { save('favorites', [...state.favorites]); }
function persistPls() { save('playlists', state.playlists); }

const current = () => state.queue[state.qIndex] ?? null;
const byKey = (key) => state.tracks.find((t) => t.key === key);

// ---------- フォルダ読み込み ----------

async function collectFromDirectory(dirHandle, out) {
  for await (const entry of dirHandle.values()) {
    if (entry.kind === 'file') {
      if (AUDIO_EXT.test(entry.name)) out.push(await entry.getFile());
    } else if (entry.kind === 'directory') {
      await collectFromDirectory(entry, out);
    }
  }
}

// 埋め込み枠(iframe)の中では showDirectoryPicker が使えない。
// しかも失敗時のエラーが「利用者が取り消した」ときと同じ AbortError になるため
// 区別できず、黙って何も起きない状態になってしまう。
// 枠の中だと分かっている場合は、最初から input 方式を使う(こちらは枠の中でも開く)。
const inFrame = window.self !== window.top;

/** 覚えているフォルダから曲を読み込む */
async function loadFromHandle(dir) {
  const files = [];
  await collectFromDirectory(dir, files);
  if (files.length === 0) { toast('そのフォルダに音楽ファイルがありませんでした'); return false; }
  await addFiles(files);
  return true;
}

async function openFolder() {
  if (window.showDirectoryPicker && !inFrame) {
    const started = Date.now();
    try {
      const dir = await window.showDirectoryPicker();
      // 次回の起動でそのまま読み込めるよう、選んだフォルダを覚えておく
      await rememberFolder(dir);
      await loadFromHandle(dir);
      return;
    } catch (e) {
      // 取り消しなら何もしない。ただし即座に失敗した場合は環境側で塞がれたとみなし、
      // 行き止まりにせず input 方式へ切り替える。
      if (e.name === 'AbortError' && Date.now() - started > 250) return;
    }
  }
  openPicker($('folderInput'));
}

/** フォルダから選んだ場合、親フォルダ名はアルバム名の有力な手がかりになる */
function folderNameOf(file) {
  const rel = file.webkitRelativePath || '';
  const parts = rel.split('/').filter(Boolean);
  return parts.length >= 2 ? parts[parts.length - 2] : '';
}

async function addFiles(files) {
  const audioFiles = [...files].filter((f) => AUDIO_EXT.test(f.name));
  if (audioFiles.length === 0) { toast('音楽ファイルが見つかりませんでした'); return; }

  const before = state.tracks.length;
  toast(`${audioFiles.length} 曲を読み込み中…`);

  // 同じ曲を二重に登録しないための目印。フォルダ違いの同名ファイルは別物として扱う
  const seen = new Set(state.tracks.map((t) => t.key));
  let added = 0;
  let skipped = 0;

  for (const file of audioFiles) {
    const key = `${file.webkitRelativePath || ''}|${file.name}|${file.size}`;
    if (seen.has(key)) { skipped++; continue; }
    seen.add(key);

    const tags = await readTags(file);
    state.tracks.push({
      key,
      file,
      url: null,
      title: tags.title || file.name.replace(/\.[^.]+$/, ''),
      artist: tags.artist || '不明なアーティスト',
      // タグが無くても、入っていたフォルダ名が分かればそれをアルバム名にする
      album: tags.album || folderNameOf(file) || '不明なアルバム',
      genre: tags.genre || '不明',
      artUrl: tags.picture ? URL.createObjectURL(tags.picture) : null,
    });
    added++;
  }

  state.tracks.sort((a, b) => a.album.localeCompare(b.album, 'ja') || a.title.localeCompare(b.title, 'ja'));

  if (added === 0 && skipped > 0) {
    toast('すでに読み込み済みの曲です');
  } else if (before > 0) {
    toast(`${added} 曲を追加しました(合計 ${state.tracks.length} 曲)`);
  } else {
    toast(`${state.tracks.length} 曲を読み込みました`);
  }
  render();
}

// ---------- 再生 ----------

function playContext(list, index) {
  state.queue = list;
  state.history = [];
  if (nativePlayer) {
    // 並びをまとめて渡しておくと、以降の曲送りはロック画面からでも完結する
    state.qIndex = index;
    nativePlayer.setQueue(JSON.stringify(list), index);
    updatePlayerUI();
    render();
    return;
  }
  startTrack(index);
}

// APK版では音を鳴らすのはネイティブ側(PlaybackService)なので、画面はそれを映すだけになる。
// ブラウザ版は今まで通り <audio> で鳴らす。両者の差はこの nativePlayer の有無に閉じ込めてある。
const nativePlayer = window.AndroidPlayer || null;
let nativeState = { ready: false, playing: false, index: 0, positionMs: 0, durationMs: 0, shuffle: false };

const posSec = () => (nativePlayer ? nativeState.positionMs / 1000 : audio.currentTime);
const durSec = () => (nativePlayer ? nativeState.durationMs / 1000 : audio.duration);

function startTrack(index) {
  const track = state.queue[index];
  if (!track) return;
  state.qIndex = index;
  if (nativePlayer) {
    // 並びは既に渡してあるので、移動だけ指示する
    nativePlayer.seekToIndex(index);
  } else {
    track.url ??= URL.createObjectURL(track.file);
    ensureAnalyser();
    audio.src = track.url;
    audio.play().catch(() => {});
  }
  updatePlayerUI();
  render();
}

function togglePlay() {
  if (!current()) return;
  if (nativePlayer) {
    if (nativeState.playing) nativePlayer.pause();
    else nativePlayer.play();
    return;
  }
  ensureAnalyser();
  if (audio.paused) audio.play().catch(() => {});
  else audio.pause();
}

function next() {
  if (state.queue.length === 0) return;
  // ネイティブ側が並びとシャッフルを持っているので、そちらに任せる
  // (ロック画面から操作されたときと挙動を揃えるため)
  if (nativePlayer) { nativePlayer.next(); return; }
  let i;
  if (state.shuffle && state.queue.length > 1) {
    state.history.push(state.qIndex);
    do { i = Math.floor(Math.random() * state.queue.length); } while (i === state.qIndex);
  } else {
    i = (state.qIndex + 1) % state.queue.length;
  }
  startTrack(i);
}

function prev() {
  if (state.queue.length === 0) return;
  if (nativePlayer) { nativePlayer.previous(); return; }
  if (audio.currentTime > 3) { audio.currentTime = 0; return; }
  if (state.shuffle && state.history.length > 0) {
    startTrack(state.history.pop());
    return;
  }
  startTrack((state.qIndex - 1 + state.queue.length) % state.queue.length);
}

function toggleShuffle() {
  state.shuffle = !state.shuffle;
  $('shuffleBtn').classList.toggle('on', state.shuffle);
  if (nativePlayer) nativePlayer.setShuffle(state.shuffle);
  toast(state.shuffle ? 'シャッフル再生 ON' : 'シャッフル再生 OFF');
}

// ネイティブ側からの状態通知。再生位置・再生中かどうか・今の曲がここで入ってくる
window.__onPlayerState = (s) => {
  if (!s || !s.ready) return;
  nativeState = s;
  const indexChanged = state.qIndex !== s.index;
  state.qIndex = s.index;
  state.playing = s.playing;
  updatePlayerUI();
  updateProgress();
  if (indexChanged) render();
};

audio.addEventListener('play', () => { state.playing = true; audioCtx?.resume().catch(() => {}); updatePlayerUI(); });
audio.addEventListener('pause', () => { state.playing = false; updatePlayerUI(); });
audio.addEventListener('ended', () => next());
audio.addEventListener('timeupdate', updateProgress);
audio.addEventListener('loadedmetadata', updateProgress);

// ---------- お気に入り・プレイリスト ----------

function toggleFav(key) {
  if (state.favorites.has(key)) state.favorites.delete(key);
  else { state.favorites.add(key); toast('お気に入りに追加しました'); }
  persistFavs();
  updatePlayerUI();
  render();
}

let plDialogTarget = null;

function openPlDialog(key) {
  plDialogTarget = key;
  const list = $('plDialogList');
  list.innerHTML = '';
  const names = Object.keys(state.playlists);
  if (names.length === 0) {
    list.innerHTML = '<p style="color:var(--muted);font-size:0.85rem">プレイリストがまだありません</p>';
  }
  for (const name of names) {
    const b = document.createElement('button');
    b.className = 'btn';
    b.textContent = `🎶 ${name}(${state.playlists[name].length}曲)`;
    b.onclick = () => { addToPlaylist(name, plDialogTarget); $('plDialog').close(); };
    list.appendChild(b);
  }
  $('plDialog').showModal();
}

function createPlaylist() {
  const name = prompt('新しいプレイリストの名前');
  if (!name || !name.trim()) return null;
  const n = name.trim();
  if (!state.playlists[n]) { state.playlists[n] = []; persistPls(); }
  return n;
}

function addToPlaylist(name, key) {
  if (!key) return;
  const list = state.playlists[name];
  if (list.includes(key)) { toast('すでに追加されています'); return; }
  list.push(key);
  persistPls();
  toast(`「${name}」に追加しました`);
  render();
}

// ---------- 画面描画 ----------

function groupBy(fn) {
  const map = new Map();
  for (const t of state.tracks) {
    const k = fn(t);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(t);
  }
  return map;
}

function trackRow(track, contextList, index, extras = {}) {
  const row = document.createElement('div');
  row.className = 'track-row' + (current()?.key === track.key ? ' current' : '');
  const art = track.artUrl ? `<img src="${track.artUrl}" alt="">` : '♪';
  row.innerHTML = `
    <span class="t-index"></span>
    <div class="t-art">${art}</div>
    <div class="t-info">
      <div class="t-title"></div>
      <div class="t-sub"></div>
    </div>`;
  row.querySelector('.t-index').textContent = String(index + 1).padStart(2, '0');
  row.querySelector('.t-title').textContent = track.title;
  row.querySelector('.t-sub').textContent = `${track.artist} — ${track.album}`;
  row.onclick = () => playContext(contextList, contextList.indexOf(track));

  const favBtn = document.createElement('button');
  favBtn.className = 't-btn' + (state.favorites.has(track.key) ? ' faved' : '');
  favBtn.textContent = state.favorites.has(track.key) ? '♥' : '♡';
  favBtn.title = 'お気に入り';
  favBtn.onclick = (e) => { e.stopPropagation(); toggleFav(track.key); };
  row.appendChild(favBtn);

  if (extras.removeFrom) {
    const rm = document.createElement('button');
    rm.className = 't-btn';
    rm.textContent = '✕';
    rm.title = 'プレイリストから削除';
    rm.onclick = (e) => {
      e.stopPropagation();
      const pl = state.playlists[extras.removeFrom];
      pl.splice(pl.indexOf(track.key), 1);
      persistPls();
      render();
    };
    row.appendChild(rm);
  } else {
    const add = document.createElement('button');
    add.className = 't-btn';
    add.textContent = '+';
    add.title = 'プレイリストに追加';
    add.onclick = (e) => { e.stopPropagation(); openPlDialog(track.key); };
    row.appendChild(add);
  }
  return row;
}

function trackListEl(tracks, extras = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'track-list';
  tracks.forEach((t, i) => wrap.appendChild(trackRow(t, tracks, i, extras)));
  return wrap;
}

function sectionHead(title, count, onBack) {
  const head = document.createElement('div');
  head.className = 'section-head';
  if (onBack) {
    const back = document.createElement('button');
    back.className = 'btn back-btn';
    back.textContent = '◀ 戻る';
    back.onclick = onBack;
    head.appendChild(back);
  }
  const h = document.createElement('h2');
  h.textContent = title;
  head.appendChild(h);
  const c = document.createElement('span');
  c.className = 'count';
  c.textContent = `${String(count).padStart(2, '0')} TRACKS`;
  head.appendChild(c);
  return head;
}

function render() {
  const root = $('viewRoot');
  const empty = $('emptyState');
  empty.classList.toggle('hidden', state.tracks.length > 0);
  root.innerHTML = '';
  if (state.tracks.length === 0 && state.tab !== 'playlists') return;

  const back = () => { state.detail = null; render(); };

  // 詳細ビュー(アルバム / ジャンル / プレイリスト)
  if (state.detail) {
    const { type, name } = state.detail;
    let tracks = [];
    let extras = {};
    if (type === 'album') tracks = state.tracks.filter((t) => t.album === name);
    else if (type === 'genre') tracks = state.tracks.filter((t) => t.genre === name);
    else if (type === 'playlist') {
      tracks = (state.playlists[name] ?? []).map(byKey).filter(Boolean);
      extras = { removeFrom: name };
    }
    root.appendChild(sectionHead(name, tracks.length, back));
    root.appendChild(trackListEl(tracks, extras));
    return;
  }

  if (state.tab === 'albums') {
    const albums = groupBy((t) => t.album);
    const grid = document.createElement('div');
    grid.className = 'album-grid';
    for (const [name, tracks] of albums) {
      const artTrack = tracks.find((t) => t.artUrl);
      const card = document.createElement('div');
      card.className = 'album-card';
      card.innerHTML = `
        <div class="album-art">${artTrack ? `<img src="${artTrack.artUrl}" alt="">` : '♪'}</div>
        <div class="album-name"></div>
        <div class="album-artist"></div>`;
      card.querySelector('.album-name').textContent = name;
      card.querySelector('.album-artist').textContent = tracks[0].artist;
      card.onclick = () => { state.detail = { type: 'album', name }; render(); };
      grid.appendChild(card);
    }
    root.appendChild(grid);
  } else if (state.tab === 'tracks') {
    root.appendChild(sectionHead('すべての曲', state.tracks.length));
    root.appendChild(trackListEl(state.tracks));
  } else if (state.tab === 'favorites') {
    const favs = state.tracks.filter((t) => state.favorites.has(t.key));
    root.appendChild(sectionHead('お気に入り', favs.length));
    if (favs.length === 0) {
      root.insertAdjacentHTML('beforeend', '<p class="hint-text">曲の ♡ を押すとここに追加されます</p>');
    } else {
      root.appendChild(trackListEl(favs));
    }
  } else if (state.tab === 'playlists') {
    const headWrap = document.createElement('div');
    headWrap.className = 'section-head';
    const h = document.createElement('h2');
    h.textContent = 'プレイリスト';
    headWrap.appendChild(h);
    const newBtn = document.createElement('button');
    newBtn.className = 'btn primary back-btn';
    newBtn.textContent = '+ 新規作成';
    newBtn.onclick = () => { if (createPlaylist()) render(); };
    headWrap.appendChild(newBtn);
    root.appendChild(headWrap);

    const cards = document.createElement('div');
    cards.className = 'list-cards';
    const names = Object.keys(state.playlists);
    if (names.length === 0) {
      root.insertAdjacentHTML('beforeend', '<p class="hint-text">「新規作成」でプレイリストを作れます</p>');
    }
    for (const name of names) {
      const card = document.createElement('div');
      card.className = 'list-card';
      card.innerHTML = `<span class="lc-bar"></span><span class="lc-name"></span><span class="lc-count"></span>`;
      card.querySelector('.lc-name').textContent = name;
      card.querySelector('.lc-count').textContent = `${String(state.playlists[name].length).padStart(2, '0')} TRACKS`;
      const del = document.createElement('button');
      del.className = 't-btn';
      del.textContent = '✕';
      del.title = 'プレイリストを削除';
      del.onclick = (e) => {
        e.stopPropagation();
        if (confirm(`プレイリスト「${name}」を削除しますか?`)) {
          delete state.playlists[name];
          persistPls();
          render();
        }
      };
      card.appendChild(del);
      card.onclick = () => { state.detail = { type: 'playlist', name }; render(); };
      cards.appendChild(card);
    }
    root.appendChild(cards);
  } else if (state.tab === 'genres') {
    root.appendChild(sectionHead('ジャンル', state.tracks.length));
    const cards = document.createElement('div');
    cards.className = 'list-cards';
    for (const [name, tracks] of groupBy((t) => t.genre)) {
      const card = document.createElement('div');
      card.className = 'list-card';
      card.innerHTML = `<span class="lc-bar"></span><span class="lc-name"></span><span class="lc-count"></span>`;
      card.querySelector('.lc-name').textContent = name;
      card.querySelector('.lc-count').textContent = `${String(tracks.length).padStart(2, '0')} TRACKS`;
      card.onclick = () => { state.detail = { type: 'genre', name }; render(); };
      cards.appendChild(card);
    }
    root.appendChild(cards);
  }
}

// ---------- プレーヤーUI更新 ----------

function fmtTime(s) {
  if (!isFinite(s)) return '0:00';
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

function updatePlayerUI() {
  const t = current();
  if (!t) return;
  $('miniPlayer').classList.remove('hidden');
  $('miniTitle').textContent = t.title;
  $('miniArtist').textContent = t.artist;
  $('miniArt').innerHTML = t.artUrl ? `<img src="${t.artUrl}" alt="">` : '♪';
  $('cTitle').textContent = t.title;
  $('cArtist').textContent = t.artist;
  $('cSerial').textContent = serialOf(t);

  // アルバムのジャケットをカセットのラベル面に貼る
  const art = $('cArt');
  if (t.artUrl) {
    art.src = t.artUrl;
    art.hidden = false;
  } else {
    art.removeAttribute('src');
    art.hidden = true;
  }
  $('cassette').classList.toggle('has-art', !!t.artUrl);

  $('miniPlayBtn').textContent = state.playing ? '❚❚' : '▶';
  $('npPlayIco').textContent = state.playing ? '❚❚' : '▶';
  $('npPlayLabel').textContent = state.playing ? 'PAUSE' : 'PLAY';
  $('npPlayBtn').classList.toggle('down', state.playing);

  const fav = state.favorites.has(t.key);
  $('npFavBtn').innerHTML = `${fav ? '♥' : '♡'} &nbsp;FAVORITE`;
  $('npFavBtn').classList.toggle('on', fav);
}

let seeking = false;

function updateProgress() {
  const dur = durSec();
  const p = dur ? posSec() / dur : 0;
  if (!seeking) $('seekBar').value = Math.round(p * 1000);
  $('curTime').textContent = fmtTime(posSec());
  $('durTime').textContent = fmtTime(dur);
  // テープの巻き量を再生位置に連動させる(左が減り、右が増える)
  // 巻きとその上に乗る照りは同じ半径で動かす
  const rl = String(20 + 16 * (1 - p));
  const rr = String(20 + 16 * p);
  $('spoolL').setAttribute('r', rl);
  $('spoolLGloss').setAttribute('r', rl);
  $('spoolR').setAttribute('r', rr);
  $('spoolRGloss').setAttribute('r', rr);
  // テープカウンター
  $('tapeCounter').textContent = String(Math.floor(posSec() * 1.6) % 1000).padStart(3, '0');
}

// ---------- リール回転・VUメーター ----------

let audioCtx = null;
let analyser = null;
let vuData = null;
let analyserFailed = false;

// AudioElement を AnalyserNode 経由で鳴らし、VUメーターを実際の音声に反応させる
function ensureAnalyser() {
  if (audioCtx || analyserFailed) return;
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const src = audioCtx.createMediaElementSource(audio);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    src.connect(analyser);
    analyser.connect(audioCtx.destination);
    vuData = new Uint8Array(analyser.fftSize);
  } catch {
    analyserFailed = true;
    audioCtx = null;
    analyser = null;
  }
}

function makeVuBar(el) {
  // ストライプ帯と同じ暖色の階調(黄 → 橙 → 赤 → 赤紫)
  const colors = ['#F5B415', '#F5B415', '#F0930E', '#F0930E', '#F07C10', '#F07C10',
                  '#E2371F', '#E2371F', '#E2371F', '#B32036', '#7B1F42', '#7B1F42'];
  for (const c of colors) {
    const seg = document.createElement('span');
    seg.className = 'vu-seg';
    seg.style.setProperty('--seg', c);
    el.appendChild(seg);
  }
}
makeVuBar($('vuL'));
makeVuBar($('vuR'));

function lightVuBar(bar, level) {
  const segs = bar.children;
  const n = Math.round(level * segs.length);
  for (let i = 0; i < segs.length; i++) segs[i].classList.toggle('on', i < n);
}

const vuLevel = { l: 0, r: 0 };
let reelAngle = { l: 0, r: 0 };
let lastTick = performance.now();

function tick(now) {
  const dt = Math.min((now - lastTick) / 1000, 0.1);
  lastTick = now;

  if (state.playing) {
    // 線速度一定のテープ → リールの回転はテープ巻き半径に反比例
    const d = durSec();
    const p = d ? posSec() / d : 0;
    reelAngle.l += (dt * 4200) / (20 + 16 * (1 - p));
    reelAngle.r += (dt * 4200) / (20 + 16 * p);
    $('hubL').style.transform = `rotate(${(reelAngle.l % 360).toFixed(1)}deg)`;
    $('hubR').style.transform = `rotate(${(reelAngle.r % 360).toFixed(1)}deg)`;
  }

  // VUレベル(音声解析、使えない環境ではランダムで代用)
  let level = 0;
  if (state.playing) {
    if (analyser) {
      analyser.getByteTimeDomainData(vuData);
      let sum = 0;
      for (let i = 0; i < vuData.length; i++) {
        const v = (vuData[i] - 128) / 128;
        sum += v * v;
      }
      level = Math.min(1, Math.sqrt(sum / vuData.length) * 3);
    } else {
      level = 0.35 + 0.35 * Math.random();
    }
  }
  vuLevel.l = Math.max(level, vuLevel.l * 0.9);
  vuLevel.r = Math.max(Math.min(1, level * (0.86 + 0.22 * Math.abs(Math.sin(now / 310)))), vuLevel.r * 0.9);
  lightVuBar($('vuL'), vuLevel.l);
  lightVuBar($('vuR'), vuLevel.r);

  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// ---------- スクショ・シェア ----------

async function shareScreenshot() {
  const t = current();
  if (!t) { toast('再生中の曲がありません'); return; }
  toast('画像を作成中…');
  const d = durSec();
  const p = d ? posSec() / d : 0;
  const blob = await drawShareCard(t, p, $('tapeCounter').textContent);
  if (!blob) { toast('画像の作成に失敗しました'); return; }
  const message = `📼 ${t.title} / ${t.artist} を聴いています`;

  // APK版は端末の共有シートへ渡す(WebView には navigator.share もダウンロードも無い)
  if (window.AndroidLibrary?.shareImage) {
    const dataUrl = await new Promise((res) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.readAsDataURL(blob);
    });
    window.AndroidLibrary.shareImage(dataUrl, message);
    return;
  }

  // ここで直接 navigator.share を呼ばないのが要点。
  // 画像を作る待ち時間の間に「ユーザー操作直後」という資格が切れてしまい、
  // 共有が拒否されて何も起きない状態になるため、
  // 一度プレビューを出して、その中のボタン(=新しい操作)から共有する。
  showShotDialog(blob, message);
}

let shotUrl = null;

function showShotDialog(blob, message) {
  if (shotUrl) URL.revokeObjectURL(shotUrl);
  shotUrl = URL.createObjectURL(blob);
  $('shotImg').src = shotUrl;

  const file = new File([blob], 'now-playing.png', { type: 'image/png' });
  const shareData = { files: [file], text: message };
  const canShare = !!navigator.canShare?.(shareData);

  const shareBtn = $('shotShareBtn');
  shareBtn.classList.toggle('hidden', !canShare);
  shareBtn.onclick = async () => {
    try {
      await navigator.share(shareData);       // このクリックが新しい資格になる
      $('shotDialog').close();
    } catch (e) {
      if (e.name === 'AbortError') return;    // 利用者が共有をやめた
      toast('共有できませんでした。画像を長押しして保存してください');
    }
  };

  $('shotSaveBtn').onclick = () => {
    const a = document.createElement('a');
    a.href = shotUrl;
    a.download = 'now-playing.png';
    a.click();
  };

  $('shotDialog').showModal();
}

// ---------- トースト ----------

let toastTimer = null;
window.__toast = (msg) => toast(msg);

function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 2500);
}

// ---------- イベント配線 ----------

/**
 * ファイル選択を開く。
 * 環境によっては選択ダイアログ自体が開けないことがあり、その場合に黙って
 * 何も起きないと手詰まりになるため、反応が無ければ代わりの手段を案内する。
 */
function openPicker(input) {
  let responded = false;
  const mark = () => { responded = true; };
  input.addEventListener('change', mark, { once: true });
  input.addEventListener('cancel', mark, { once: true });   // ダイアログを閉じた場合
  window.addEventListener('blur', mark, { once: true });    // ダイアログに焦点が移った場合

  input.click();

  setTimeout(() => {
    // まだ1曲も読めていないときだけ案内する(通常利用の邪魔をしない)
    if (!responded && state.tracks.length === 0) {
      toast('この画面ではファイル選択を開けないようです。曲をドラッグして落とすか、デモ曲をお試しください');
    }
  }, 2500);
}

const pickFiles = () => openPicker($('filesInput'));

// ---------- 投げ込みでの読み込み ----------
// 選択ダイアログが開けない環境でも、ここから曲を入れられるようにしておく。

/** 投げ込まれた項目がフォルダなら、中のファイルまで辿る */
async function filesFromEntry(entry, out) {
  if (!entry) return;
  if (entry.isFile) {
    await new Promise((res) => entry.file((f) => { out.push(f); res(); }, res));
  } else if (entry.isDirectory) {
    const reader = entry.createReader();
    for (;;) {
      const batch = await new Promise((res) => reader.readEntries(res, () => res([])));
      if (batch.length === 0) break;
      for (const e of batch) await filesFromEntry(e, out);
    }
  }
}

let dragDepth = 0;

document.addEventListener('dragenter', (e) => {
  if (![...(e.dataTransfer?.types ?? [])].includes('Files')) return;
  e.preventDefault();
  dragDepth++;
  document.body.classList.add('dragging');
});

document.addEventListener('dragover', (e) => {
  if ([...(e.dataTransfer?.types ?? [])].includes('Files')) e.preventDefault();
});

document.addEventListener('dragleave', () => {
  if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragging'); }
});

document.addEventListener('drop', async (e) => {
  if (![...(e.dataTransfer?.types ?? [])].includes('Files')) return;
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove('dragging');

  const out = [];
  const items = [...(e.dataTransfer.items ?? [])];
  if (items.length && items[0].webkitGetAsEntry) {
    // フォルダごと投げ込まれた場合にも対応する
    const entries = items.map((it) => it.webkitGetAsEntry?.()).filter(Boolean);
    for (const entry of entries) await filesFromEntry(entry, out);
  }
  if (out.length === 0) out.push(...e.dataTransfer.files);
  if (out.length) await addFiles(out);
});

// デモ曲。ファイル選択が使えない環境でも動作を確かめられるようにするための逃げ道
$('demoBtn').onclick = async () => {
  const btn = $('demoBtn');
  btn.disabled = true;
  toast('デモ曲を作成中…');
  try {
    const { buildDemoTracks } = await import('./demo.js');
    const demo = await buildDemoTracks();
    const seen = new Set(state.tracks.map((t) => t.key));
    for (const t of demo) if (!seen.has(t.key)) state.tracks.push(t);
    state.tracks.sort((a, b) => a.album.localeCompare(b.album, 'ja') || a.title.localeCompare(b.title, 'ja'));
    toast(`デモ曲 ${demo.length} 曲を読み込みました`);
    render();
  } catch (e) {
    toast('デモ曲を作成できませんでした');
  } finally {
    btn.disabled = false;
  }
};

// ---------- DJミキサー ----------
// 2曲を同時に鳴らす画面なので、通常再生とは別の仕組み(Web Audio)で動く。
// 読み込みが要るのは開いたときだけなので、その場で取り込む。

let dj = null;

async function openDJScreen() {
  const btn = $('djBtn');
  btn.disabled = true;
  try {
    dj ??= await import('./dj.js');
    // 通常再生と重ならないよう、DJ画面を開くときに止める
    await dj.openDJ({
      getTracks: () => state.tracks,
      audioContext: (ensureAnalyser(), audioCtx) || undefined,
      toast,
      onOpen: () => {
        if (nativePlayer) nativePlayer.pause();
        else audio.pause();
      },
    });
  } catch (e) {
    toast('DJミキサーを開けませんでした');
  } finally {
    btn.disabled = false;
  }
}

$('djBtn').onclick = openDJScreen;

$('addFilesBtn').onclick = pickFiles;
$('openFolderBtn').onclick = openFolder;
$('emptyOpenBtn').onclick = openFolder;
$('emptyFilesBtn').onclick = pickFiles;

// 同じファイルを選び直しても change が発火するよう、読み込み後に選択を空にする
for (const id of ['folderInput', 'filesInput']) {
  $(id).addEventListener('change', async (e) => {
    const files = e.target.files;
    await addFiles(files);
    e.target.value = '';
  });
}

document.querySelectorAll('.tab').forEach((tab) => {
  tab.onclick = () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    state.tab = tab.dataset.tab;
    state.detail = null;
    render();
  };
});

$('miniPlayBtn').onclick = togglePlay;
$('miniPrevBtn').onclick = prev;
$('miniNextBtn').onclick = () => next();
$('miniInfo').onclick = () => $('nowPlaying').classList.remove('hidden');
$('miniArt').onclick = () => $('nowPlaying').classList.remove('hidden');
$('npCloseBtn').onclick = () => $('nowPlaying').classList.add('hidden');
$('npPlayBtn').onclick = togglePlay;
$('npPrevBtn').onclick = prev;
$('npNextBtn').onclick = () => next();
$('shuffleBtn').onclick = toggleShuffle;
$('npFavBtn').onclick = () => { const t = current(); if (t) toggleFav(t.key); };
$('shotBtn').onclick = shareScreenshot;

$('seekBar').addEventListener('input', () => { seeking = true; });
$('seekBar').addEventListener('change', () => {
  const f = Number($('seekBar').value) / 1000;
  if (nativePlayer) {
    if (nativeState.durationMs) nativePlayer.seekTo(f * nativeState.durationMs);
  } else if (audio.duration) {
    audio.currentTime = f * audio.duration;
  }
  seeking = false;
});

$('plNewBtn').onclick = () => {
  const name = createPlaylist();
  if (name) { addToPlaylist(name, plDialogTarget); $('plDialog').close(); }
};
$('plCancelBtn').onclick = () => $('plDialog').close();
$('shotCloseBtn').onclick = () => $('shotDialog').close();

document.addEventListener('keydown', (e) => {
  // DJ画面を開いている間は、こちらの再生には触らない
  if (dj?.isDJOpen()) return;
  if (e.code === 'Space' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'BUTTON') {
    e.preventDefault();
    togglePlay();
  }
});

// ---------- Androidアプリとして動いているときの連携 ----------
// APK版では端末の音楽ライブラリ(MediaStore)から直接読み込むので、
// 起動のたびにフォルダを選び直す必要がない。ブラウザで開いた場合はここを丸ごと素通りする。

const android = window.AndroidLibrary;

function loadFromAndroid() {
  let list = [];
  try {
    list = JSON.parse(android.listTracks());
  } catch {
    toast('端末の音楽を読み込めませんでした');
    return;
  }
  if (list.length === 0) {
    toast('端末に音楽が見つかりませんでした');
    return;
  }
  // MediaStore が題名・アーティスト・アルバム・ジャンルまで持っているのでタグ解析は不要
  state.tracks = list.map((t) => ({ ...t, artUrl: t.artUrl || null, file: null }));
  const scope = android.libraryScope?.() || '';
  toast(scope && scope !== 'all'
    ? `${scope} フォルダから ${state.tracks.length} 曲を読み込みました`
    : `${state.tracks.length} 曲を読み込みました`);
  render();
}

// 権限ダイアログの結果を受け取る(MainActivity から呼ばれる)
window.__onLibraryReady = (granted) => {
  if (granted) loadFromAndroid();
  else toast('音楽へのアクセスが許可されていません');
};

// 戻るキー: 再生中画面が開いていれば閉じ、開いていなければアプリを終了させる
window.__androidBack = () => {
  if (dj?.closeDJ()) return true;
  const np = $('nowPlaying');
  if (!np.classList.contains('hidden')) {
    np.classList.add('hidden');
    return true;
  }
  if (state.detail) {
    state.detail = null;
    render();
    return true;
  }
  return false;
};

// ---------- 起動時に前回のフォルダを読み直す ----------
// 「閉じたら曲が消える」のを防ぐ仕組み。覚えたフォルダを開き直す。
// 読み取りの許可が生きていればそのまま自動で、切れていれば1タップで戻せる。

async function restoreFolderOnStart() {
  const dir = await recallFolder();
  if (!dir) return;

  const perm = await folderPermission(dir);
  if (perm === 'granted') {
    toast('前回のフォルダを読み込んでいます…');
    const ok = await loadFromHandle(dir);
    if (!ok) await forgetFolder();
    return;
  }
  if (perm === 'denied' || perm === 'unsupported') { await forgetFolder(); return; }

  // 'prompt' の場合、許可を求めるには利用者の操作が要るのでボタンを出す
  const btn = $('reopenBtn');
  btn.classList.remove('hidden');
  btn.textContent = `前回のフォルダを開く(${dir.name})`;
  btn.onclick = async () => {
    if ((await askFolderPermission(dir)) !== 'granted') {
      toast('フォルダへのアクセスが許可されませんでした');
      return;
    }
    btn.classList.add('hidden');
    if (!(await loadFromHandle(dir))) await forgetFolder();
  };
}

if (android) {
  // ファイル選択のボタン類はAndroidアプリ版では不要なので隠す
  document.body.classList.add('is-android');
  if (android.hasPermission()) loadFromAndroid();
  else android.requestPermission();
} else {
  // ブラウザ版は、前回選んだフォルダを開き直す
  restoreFolderOnStart();
}

render();
