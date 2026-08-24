// カセットプレーヤー — メインロジック
import { readTags } from './id3.js';
import { drawShareCard, serialOf } from './share.js';

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

async function openFolder() {
  if (window.showDirectoryPicker) {
    try {
      const dir = await window.showDirectoryPicker();
      const files = [];
      await collectFromDirectory(dir, files);
      await addFiles(files);
    } catch (e) {
      if (e.name !== 'AbortError') toast('フォルダを開けませんでした');
    }
  } else {
    $('folderInput').click();
  }
}

async function addFiles(files) {
  const audioFiles = [...files].filter((f) => AUDIO_EXT.test(f.name));
  if (audioFiles.length === 0) { toast('音楽ファイルが見つかりませんでした'); return; }
  toast(`${audioFiles.length} 曲を読み込み中…`);

  const seen = new Set(state.tracks.map((t) => t.key));
  for (const file of audioFiles) {
    const key = file.name;
    if (seen.has(key)) continue;
    seen.add(key);
    const tags = /\.mp3$/i.test(file.name) ? await readTags(file) : { title: '', artist: '', album: '', genre: '', picture: null };
    state.tracks.push({
      key,
      file,
      url: null,
      title: tags.title || file.name.replace(/\.[^.]+$/, ''),
      artist: tags.artist || '不明なアーティスト',
      album: tags.album || '不明なアルバム',
      genre: tags.genre || '不明',
      artUrl: tags.picture ? URL.createObjectURL(tags.picture) : null,
    });
  }
  state.tracks.sort((a, b) => a.album.localeCompare(b.album, 'ja') || a.title.localeCompare(b.title, 'ja'));
  toast(`${state.tracks.length} 曲を読み込みました`);
  render();
}

// ---------- 再生 ----------

function playContext(list, index) {
  state.queue = list;
  state.history = [];
  startTrack(index);
}

function startTrack(index) {
  const track = state.queue[index];
  if (!track) return;
  state.qIndex = index;
  track.url ??= URL.createObjectURL(track.file);
  ensureAnalyser();
  audio.src = track.url;
  audio.play().catch(() => {});
  updatePlayerUI();
  render();
}

function togglePlay() {
  if (!current()) return;
  ensureAnalyser();
  if (audio.paused) audio.play().catch(() => {});
  else audio.pause();
}

function next() {
  if (state.queue.length === 0) return;
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
  toast(state.shuffle ? 'シャッフル再生 ON' : 'シャッフル再生 OFF');
}

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
  const p = audio.duration ? audio.currentTime / audio.duration : 0;
  if (!seeking) $('seekBar').value = Math.round(p * 1000);
  $('curTime').textContent = fmtTime(audio.currentTime);
  $('durTime').textContent = fmtTime(audio.duration);
  // テープの巻き量を再生位置に連動させる(左が減り、右が増える)
  $('spoolL').setAttribute('r', String(20 + 16 * (1 - p)));
  $('spoolR').setAttribute('r', String(20 + 16 * p));
  // テープカウンター
  $('tapeCounter').textContent = String(Math.floor(audio.currentTime * 1.6) % 1000).padStart(3, '0');
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
    const p = audio.duration ? audio.currentTime / audio.duration : 0;
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
  const p = audio.duration ? audio.currentTime / audio.duration : 0;
  const blob = await drawShareCard(t, p, $('tapeCounter').textContent);
  if (!blob) { toast('画像の作成に失敗しました'); return; }
  const file = new File([blob], 'now-playing.png', { type: 'image/png' });
  const shareData = { files: [file], text: `📼 ${t.title} / ${t.artist} を聴いています` };
  if (navigator.canShare && navigator.canShare(shareData)) {
    try {
      await navigator.share(shareData);
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  // 共有APIが使えない環境では画像を表示して、長押し / 右クリック / 保存ボタンで持ち帰ってもらう
  // (サンドボックス内ではダウンロードがブロックされることがあるため、必ず画像自体を出す)
  showShotDialog(blob);
}

let shotUrl = null;

function showShotDialog(blob) {
  if (shotUrl) URL.revokeObjectURL(shotUrl);
  shotUrl = URL.createObjectURL(blob);
  $('shotImg').src = shotUrl;
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
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 2500);
}

// ---------- イベント配線 ----------

$('openFolderBtn').onclick = openFolder;
$('emptyOpenBtn').onclick = openFolder;
$('emptyFilesBtn').onclick = () => $('filesInput').click();
$('folderInput').addEventListener('change', (e) => addFiles(e.target.files));
$('filesInput').addEventListener('change', (e) => addFiles(e.target.files));

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
  if (audio.duration) audio.currentTime = (Number($('seekBar').value) / 1000) * audio.duration;
  seeking = false;
});

$('plNewBtn').onclick = () => {
  const name = createPlaylist();
  if (name) { addToPlaylist(name, plDialogTarget); $('plDialog').close(); }
};
$('plCancelBtn').onclick = () => $('plDialog').close();
$('shotCloseBtn').onclick = () => $('shotDialog').close();

document.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'BUTTON') {
    e.preventDefault();
    togglePlay();
  }
});

render();
