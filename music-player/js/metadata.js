// 音楽ファイルから題名・アーティスト・アルバム・ジャンル・ジャケットを取り出す。
//
// 形式ごとにタグの入れ物が全く違うため、拡張子と先頭のシグネチャで振り分ける。
//   MP3  … ID3v2(先頭)/ ID3v1(末尾128バイト)
//   M4A  … MP4のボックス構造 moov/udta/meta/ilst
//   FLAC … メタデータブロック(VORBIS_COMMENT / PICTURE)
//   OGG  … Vorbis comment / OpusTags
// 読めなかった場合は空を返し、呼び出し側がファイル名とフォルダ名で補う。

const EMPTY = { title: '', artist: '', album: '', genre: '', picture: null };

const ID3V1_GENRES = [
  'Blues','Classic Rock','Country','Dance','Disco','Funk','Grunge','Hip-Hop','Jazz','Metal',
  'New Age','Oldies','Other','Pop','R&B','Rap','Reggae','Rock','Techno','Industrial',
  'Alternative','Ska','Death Metal','Pranks','Soundtrack','Euro-Techno','Ambient','Trip-Hop','Vocal','Jazz+Funk',
  'Fusion','Trance','Classical','Instrumental','Acid','House','Game','Sound Clip','Gospel','Noise',
  'Alt. Rock','Bass','Soul','Punk','Space','Meditative','Instrumental Pop','Instrumental Rock','Ethnic','Gothic',
  'Darkwave','Techno-Industrial','Electronic','Pop-Folk','Eurodance','Dream','Southern Rock','Comedy','Cult','Gangsta Rap',
  'Top 40','Christian Rap','Pop/Funk','Jungle','Native American','Cabaret','New Wave','Psychedelic','Rave','Showtunes',
  'Trailer','Lo-Fi','Tribal','Acid Punk','Acid Jazz','Polka','Retro','Musical','Rock & Roll','Hard Rock',
];

const clean = (s) => (s || '').replace(/\0/g, '').trim();

function decode(bytes, label = 'utf-8') {
  try {
    return clean(new TextDecoder(label).decode(bytes));
  } catch {
    return '';
  }
}

async function bytes(file, start, end) {
  return new Uint8Array(await file.slice(start, end).arrayBuffer());
}

/**
 * ファイルからタグを読む。
 * @returns {Promise<{title:string, artist:string, album:string, genre:string, picture:Blob|null}>}
 */
export async function readTags(file) {
  try {
    const head = await bytes(file, 0, 12);
    if (head.length < 8) return { ...EMPTY };

    const ascii = (n) => String.fromCharCode(...head.subarray(n, n + 4));

    if (ascii(0) === 'fLaC') return await readFlac(file);
    if (ascii(0) === 'OggS') return await readOgg(file);
    if (ascii(4) === 'ftyp') return await readMp4(file);
    if (head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) {
      const v2 = await readId3v2(file, head);
      // ID3v2 が空振りしたときは末尾の ID3v1 を見る
      if (v2.title || v2.artist || v2.album) return v2;
      return { ...v2, ...(await readId3v1(file)) , picture: v2.picture };
    }
    // 拡張子でも判断できるようにしておく(シグネチャが無い MP3 もあるため)
    if (/\.(mp3|mp2)$/i.test(file.name)) return await readId3v1(file);
    if (/\.(m4a|m4b|mp4|aac)$/i.test(file.name)) return await readMp4(file);
    return { ...EMPTY };
  } catch {
    return { ...EMPTY };
  }
}

// ---------- MP3: ID3v2 ----------

const syncsafe = (a, b, c, d) => (a << 21) | (b << 14) | (c << 7) | d;

function decodeId3Text(body) {
  if (body.length === 0) return '';
  const enc = body[0];
  const rest = body.subarray(1);
  if (enc === 0) return decode(rest, 'latin1');
  if (enc === 1) return decode(rest, 'utf-16');
  if (enc === 2) return decode(rest, 'utf-16be');
  return decode(rest, 'utf-8');
}

function parseApic(body) {
  const enc = body[0];
  let i = 1;
  while (i < body.length && body[i] !== 0) i++;
  const mime = decode(body.subarray(1, i), 'latin1') || 'image/jpeg';
  i += 2; // null + 画像種別
  if (enc === 1 || enc === 2) {
    while (i + 1 < body.length && !(body[i] === 0 && body[i + 1] === 0)) i += 2;
    i += 2;
  } else {
    while (i < body.length && body[i] !== 0) i++;
    i += 1;
  }
  return i < body.length ? new Blob([body.subarray(i)], { type: mime }) : null;
}

function normalizeGenre(raw) {
  if (!raw) return '';
  const m = raw.match(/^\(?(\d+)\)?\s*(.*)$/);
  if (m && !m[2]) return ID3V1_GENRES[parseInt(m[1], 10)] || '';
  return raw.replace(/^\(\d+\)/, '').trim();
}

async function readId3v2(file, head) {
  const tags = { ...EMPTY };
  const major = head[3];
  if (major < 2 || major > 4) return tags;
  const size = syncsafe(head[6], head[7], head[8], head[9]);
  const data = await bytes(file, 10, 10 + Math.min(size, 4 * 1024 * 1024));

  let pos = 0;
  if (head[5] & 0x40) {
    pos += major === 4
      ? syncsafe(data[0], data[1], data[2], data[3])
      : ((data[0] << 24) | (data[1] << 16) | (data[2] << 8) | data[3]) + 4;
  }

  // ID3v2.2 はフレームIDが3文字・サイズ3バイトと構造が違う
  const idLen = major === 2 ? 3 : 4;
  const headLen = major === 2 ? 6 : 10;

  while (pos + headLen <= data.length) {
    const id = String.fromCharCode(...data.subarray(pos, pos + idLen));
    if (!/^[A-Z0-9]+$/.test(id)) break;
    let frameSize;
    if (major === 2) {
      frameSize = (data[pos + 3] << 16) | (data[pos + 4] << 8) | data[pos + 5];
    } else if (major === 4) {
      frameSize = syncsafe(data[pos + 4], data[pos + 5], data[pos + 6], data[pos + 7]);
    } else {
      frameSize = (data[pos + 4] << 24) | (data[pos + 5] << 16) | (data[pos + 6] << 8) | data[pos + 7];
    }
    if (frameSize <= 0 || pos + headLen + frameSize > data.length) break;
    const body = data.subarray(pos + headLen, pos + headLen + frameSize);

    if (id === 'TIT2' || id === 'TT2') tags.title = decodeId3Text(body);
    else if (id === 'TPE1' || id === 'TP1') tags.artist = decodeId3Text(body);
    else if (id === 'TALB' || id === 'TAL') tags.album = decodeId3Text(body);
    else if (id === 'TCON' || id === 'TCO') tags.genre = normalizeGenre(decodeId3Text(body));
    else if ((id === 'APIC' || id === 'PIC') && !tags.picture) tags.picture = parseApic(body);

    pos += headLen + frameSize;
  }
  return tags;
}

// ---------- MP3: ID3v1(末尾128バイト) ----------

async function readId3v1(file) {
  const tags = { ...EMPTY };
  if (file.size < 128) return tags;
  const b = await bytes(file, file.size - 128, file.size);
  if (String.fromCharCode(b[0], b[1], b[2]) !== 'TAG') return tags;
  tags.title = decode(b.subarray(3, 33), 'latin1');
  tags.artist = decode(b.subarray(33, 63), 'latin1');
  tags.album = decode(b.subarray(63, 93), 'latin1');
  tags.genre = ID3V1_GENRES[b[127]] || '';
  return tags;
}

// ---------- M4A / MP4 ----------

async function readMp4(file) {
  const tags = { ...EMPTY };
  const view = await findMoov(file);
  if (!view) return tags;

  const ilst = findBox(view, ['udta', 'meta', 'ilst']);
  if (!ilst) return tags;

  const dv = new DataView(view.buffer, view.byteOffset, view.byteLength);
  let p = ilst.start;
  while (p + 8 <= ilst.end) {
    const size = dv.getUint32(p);
    if (size < 8 || p + size > ilst.end) break;
    const name = String.fromCharCode(view[p + 4], view[p + 5], view[p + 6], view[p + 7]);

    // 各項目の中身は data ボックスに入っている
    let q = p + 8;
    while (q + 8 <= p + size) {
      const dsize = dv.getUint32(q);
      if (dsize < 8 || q + dsize > p + size) break;
      const dtype = String.fromCharCode(view[q + 4], view[q + 5], view[q + 6], view[q + 7]);
      if (dtype === 'data') {
        const flags = dv.getUint32(q + 8) & 0xffffff;
        const payload = view.subarray(q + 16, q + dsize);
        if (name === '\xa9nam') tags.title = decode(payload);
        else if (name === '\xa9ART' || name === 'aART') tags.artist ||= decode(payload);
        else if (name === '\xa9alb') tags.album = decode(payload);
        else if (name === '\xa9gen') tags.genre = decode(payload);
        else if (name === 'gnre' && payload.length >= 2) {
          tags.genre ||= ID3V1_GENRES[((payload[0] << 8) | payload[1]) - 1] || '';
        } else if (name === 'covr' && !tags.picture) {
          // flags: 13 = JPEG, 14 = PNG
          const mime = flags === 14 ? 'image/png' : 'image/jpeg';
          tags.picture = new Blob([payload], { type: mime });
        }
      }
      q += dsize;
    }
    p += size;
  }
  return tags;
}

/** 先頭からトップレベルのボックスを辿って moov を取り出す(末尾にある場合も拾う) */
async function findMoov(file) {
  let offset = 0;
  const LIMIT = 24 * 1024 * 1024; // 巨大な moov は諦める
  while (offset + 8 <= file.size) {
    const h = await bytes(file, offset, offset + 16);
    if (h.length < 8) return null;
    const dv = new DataView(h.buffer, h.byteOffset, h.byteLength);
    let size = dv.getUint32(0);
    let headLen = 8;
    if (size === 1) {
      // 64bit サイズ
      if (h.length < 16) return null;
      size = Number(dv.getBigUint64(8));
      headLen = 16;
    } else if (size === 0) {
      size = file.size - offset;
    }
    if (size < headLen) return null;
    const type = String.fromCharCode(h[4], h[5], h[6], h[7]);
    if (type === 'moov') {
      if (size > LIMIT) return null;
      return await bytes(file, offset + headLen, offset + size);
    }
    offset += size;
  }
  return null;
}

/** moov の中を名前の連なりで辿る。meta だけは4バイトの版数を挟むので読み飛ばす */
function findBox(view, path) {
  const dv = new DataView(view.buffer, view.byteOffset, view.byteLength);
  let start = 0;
  let end = view.length;

  for (const want of path) {
    let p = start;
    let found = null;
    while (p + 8 <= end) {
      const size = dv.getUint32(p);
      if (size < 8 || p + size > end) break;
      const type = String.fromCharCode(view[p + 4], view[p + 5], view[p + 6], view[p + 7]);
      if (type === want) {
        found = { start: p + 8, end: p + size };
        break;
      }
      p += size;
    }
    if (!found) return null;
    start = want === 'meta' ? found.start + 4 : found.start;
    end = found.end;
  }
  return { start, end };
}

// ---------- FLAC ----------

async function readFlac(file) {
  const tags = { ...EMPTY };
  let pos = 4;
  for (let i = 0; i < 64; i++) {
    const h = await bytes(file, pos, pos + 4);
    if (h.length < 4) break;
    const last = (h[0] & 0x80) !== 0;
    const type = h[0] & 0x7f;
    const len = (h[1] << 16) | (h[2] << 8) | h[3];
    const body = await bytes(file, pos + 4, pos + 4 + len);

    if (type === 4) applyVorbisComment(body, 0, tags);
    else if (type === 6 && !tags.picture) tags.picture = parseFlacPicture(body);

    pos += 4 + len;
    if (last) break;
  }
  return tags;
}

function parseFlacPicture(b) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let p = 4; // 画像種別
  const mimeLen = dv.getUint32(p); p += 4;
  const mime = decode(b.subarray(p, p + mimeLen), 'latin1') || 'image/jpeg'; p += mimeLen;
  const descLen = dv.getUint32(p); p += 4 + descLen;
  p += 16; // 幅・高さ・色深度・色数
  const dataLen = dv.getUint32(p); p += 4;
  if (p + dataLen > b.length) return null;
  return new Blob([b.subarray(p, p + dataLen)], { type: mime });
}

// ---------- OGG / Opus ----------

async function readOgg(file) {
  const tags = { ...EMPTY };
  // コメントヘッダは先頭近くにあるので、そこだけ読んで目印を探す
  const buf = await bytes(file, 0, Math.min(file.size, 256 * 1024));
  const marker = findSequence(buf, [0x03, 0x76, 0x6f, 0x72, 0x62, 0x69, 0x73]); // \x03vorbis
  if (marker >= 0) {
    applyVorbisComment(buf, marker + 7, tags);
    return tags;
  }
  const opus = findSequence(buf, [0x4f, 0x70, 0x75, 0x73, 0x54, 0x61, 0x67, 0x73]); // OpusTags
  if (opus >= 0) applyVorbisComment(buf, opus + 8, tags);
  return tags;
}

function findSequence(buf, seq) {
  outer:
  for (let i = 0; i + seq.length <= buf.length; i++) {
    for (let j = 0; j < seq.length; j++) if (buf[i + j] !== seq[j]) continue outer;
    return i;
  }
  return -1;
}

/** VORBIS_COMMENT 構造(長さはリトルエンディアン)を読んで tags に流し込む */
function applyVorbisComment(b, start, tags) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let p = start;
  if (p + 4 > b.length) return;
  const vendorLen = dv.getUint32(p, true); p += 4 + vendorLen;
  if (p + 4 > b.length) return;
  const count = dv.getUint32(p, true); p += 4;

  for (let i = 0; i < count && p + 4 <= b.length; i++) {
    const len = dv.getUint32(p, true); p += 4;
    if (p + len > b.length) break;
    const entry = decode(b.subarray(p, p + len));
    p += len;
    const eq = entry.indexOf('=');
    if (eq < 0) continue;
    const key = entry.slice(0, eq).toUpperCase();
    const value = entry.slice(eq + 1);
    if (key === 'TITLE') tags.title ||= value;
    else if (key === 'ARTIST') tags.artist ||= value;
    else if (key === 'ALBUM') tags.album ||= value;
    else if (key === 'GENRE') tags.genre ||= value;
    else if (key === 'METADATA_BLOCK_PICTURE' && !tags.picture) {
      try {
        const raw = Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
        tags.picture = parseFlacPicture(raw);
      } catch { /* 壊れていたら諦める */ }
    }
  }
}
