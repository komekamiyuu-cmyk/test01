/* ============================================================
   楽器レジストリ
   ここに import して配列に足すだけで、新しい楽器が
   トラックタブ・グリッド・保存データ・WAV書き出しの
   すべてに自動で組み込まれる。並び順 = タブの表示順。

   ── 楽器インターフェース ──────────────────────────
   必須:
     id: string            トラックID(保存データのキー。変更しない)
     name: string          タブに表示する名前
     color: string         テーマカラー(CSS値)
     hint: string          初心者向けのひとこと説明
     maxRows: number       グリッドの保存行数(スケールで表示行が減ってもデータは保持)
     getRows(song, params) 表示する行を上から順に返す
                           → [{ dataRow, label, strong? }]
     noteOn(ctx, channel, dataRow, time, dur, song, params)
                           時刻 time に1音を予約する(再生とWAV書き出しで共用)
   任意:
     defaultVol: number            初期音量(省略時 0.8)
     defaultParams(): object       トラック固有パラメータの初期値
     sanitizeParams(params)        読み込んだパラメータの検証・修正
     createChannel(ctx, dest, params)
                                   トラック固有のエフェクトチェーンを作る
                                   → { input: AudioNode, update?(params), ... }
                                   省略時は素通し。noteOn には常にこれが渡る
     buildControls(container, params, api)
                                   トラック設定UI(音色セレクタ等)を組み立てる
                                   api = { onChange, refreshGrid, refreshControls }
   ============================================================ */

import basicDrums from './basic-drums.js';
import chords from './chords.js';
import bass from './bass.js';
import melody from './melody.js';
import icepad from './icepad.js';
import icesynth from './icesynth.js';

export const INSTRUMENTS = [
  basicDrums,
  icepad,
  chords,
  bass,
  melody,
  icesynth,
];

export function getInstrument(id) {
  return INSTRUMENTS.find(i => i.id === id);
}
