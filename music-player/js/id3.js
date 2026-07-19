// ID3v2 タグの最小パーサー(MP3のタイトル・アーティスト・アルバム・ジャンル・ジャケット画像を読む)

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

function syncsafe(b0, b1, b2, b3) {
  return (b0 << 21) | (b1 << 14) | (b2 << 7) | b3;
}

function decodeText(bytes) {
  if (bytes.length === 0) return '';
  const enc = bytes[0];
  let body = bytes.subarray(1);
  let label = 'utf-8';
  if (enc === 0) label = 'latin1';
  else if (enc === 1) label = 'utf-16';
  else if (enc === 2) label = 'utf-16be';
  try {
    return new TextDecoder(label).decode(body).replace(/\0+$/g, '').replace(/^\0+/g, '').trim();
  } catch {
    return '';
  }
}

// APIC フレームから画像 Blob を取り出す
function parsePicture(bytes) {
  const enc = bytes[0];
  let i = 1;
  while (i < bytes.length && bytes[i] !== 0) i++; // MIMEタイプ(latin1、null終端)
  const mime = new TextDecoder('latin1').decode(bytes.subarray(1, i)) || 'image/jpeg';
  i += 1; // null
  i += 1; // 画像種別(1バイト)
  // 説明文字列をスキップ(UTF-16系は 0x00 0x00 終端)
  if (enc === 1 || enc === 2) {
    while (i + 1 < bytes.length && !(bytes[i] === 0 && bytes[i + 1] === 0)) i += 2;
    i += 2;
  } else {
    while (i < bytes.length && bytes[i] !== 0) i++;
    i += 1;
  }
  if (i >= bytes.length) return null;
  return new Blob([bytes.subarray(i)], { type: mime });
}

// "(17)" や "17" 形式のジャンルを名称に変換
function normalizeGenre(raw) {
  if (!raw) return '';
  const m = raw.match(/^\(?(\d+)\)?\s*(.*)$/);
  if (m && m[1] !== undefined && (m[2] === '' || m[2] === undefined)) {
    const n = parseInt(m[1], 10);
    return ID3V1_GENRES[n] || '';
  }
  return raw.replace(/^\(\d+\)/, '').trim();
}

/**
 * ファイル先頭の ID3v2 タグを読む。
 * @returns {Promise<{title:string, artist:string, album:string, genre:string, picture:Blob|null}>}
 */
export async function readTags(file) {
  const empty = { title: '', artist: '', album: '', genre: '', picture: null };
  try {
    const head = new Uint8Array(await file.slice(0, 10).arrayBuffer());
    if (head.length < 10 || head[0] !== 0x49 || head[1] !== 0x44 || head[2] !== 0x33) return empty;
    const major = head[3];
    if (major < 3 || major > 4) return empty;
    const tagSize = syncsafe(head[6], head[7], head[8], head[9]);
    const data = new Uint8Array(await file.slice(10, 10 + Math.min(tagSize, 3 * 1024 * 1024)).arrayBuffer());

    const tags = { ...empty };
    let pos = 0;
    // 拡張ヘッダーをスキップ
    if (head[5] & 0x40) {
      const ext = major === 4
        ? syncsafe(data[0], data[1], data[2], data[3])
        : ((data[0] << 24) | (data[1] << 16) | (data[2] << 8) | data[3]) + 4;
      pos += ext;
    }

    while (pos + 10 <= data.length) {
      const id = String.fromCharCode(data[pos], data[pos + 1], data[pos + 2], data[pos + 3]);
      if (!/^[A-Z0-9]{4}$/.test(id)) break;
      const size = major === 4
        ? syncsafe(data[pos + 4], data[pos + 5], data[pos + 6], data[pos + 7])
        : (data[pos + 4] << 24) | (data[pos + 5] << 16) | (data[pos + 6] << 8) | data[pos + 7];
      if (size <= 0 || pos + 10 + size > data.length) break;
      const body = data.subarray(pos + 10, pos + 10 + size);

      if (id === 'TIT2') tags.title = decodeText(body);
      else if (id === 'TPE1') tags.artist = decodeText(body);
      else if (id === 'TALB') tags.album = decodeText(body);
      else if (id === 'TCON') tags.genre = normalizeGenre(decodeText(body));
      else if (id === 'APIC' && !tags.picture) tags.picture = parsePicture(body);

      pos += 10 + size;
    }
    return tags;
  } catch {
    return empty;
  }
}
