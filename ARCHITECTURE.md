# 🏗️ かんたんDAW 設計ドキュメント

今後のメンテナンス・修正・機能追加をしやすくするための設計方針と、
「よくある変更をどこでやるか」をまとめたガイドです。

## 全体像

ビルド不要の静的サイト(Vanilla JS + ES Modules + Web Audio API)。
機能はモジュールに分割され、**楽器は共通インターフェースを実装した1ファイル**として追加・修正できます。

```
index.html                 画面の骨組み(トラック非依存の共通UIのみ)
style.css                  スタイル
js/
├─ main.js                 エントリポイント。各モジュールの配線だけを行う
├─ config.js               音楽の共通知識(スケール・音名・コード定義)
├─ state.js                曲データの作成・検証・保存・読込(v1→v2移行含む)
├─ audio/
│   ├─ bus.js              マスター+トラックチャンネルの構築(再生/書き出し共用)
│   ├─ scheduler.js        先読み方式のトランスポート(再生位置管理)
│   └─ wav.js              AudioBuffer → WAV エンコード
├─ ui/
│   ├─ grid.js             打ち込みグリッドの描画とタップ/なぞり入力
│   └─ controls.js         楽器設定UIの共通部品(セレクタ・スライダー)
└─ instruments/
    ├─ index.js            ★楽器レジストリ(ここに登録すればタブに現れる)
    ├─ basic-drums.js      かんたんドラム(5音)
    ├─ chords.js           コード
    ├─ bass.js             ベース
    ├─ melody.js           メロディ(音色3種)
    ├─ icepad.js           ICE PAD 移植(16ボイス×3キット×4バンク)
    └─ icesynth.js         ICE SYNTH 移植(FMポリシンセ、6プリセット)
```

### データの流れ

```
ユーザー操作 → main.js → song(曲データ、state.jsが形を管理)
                              │ 自動保存(localStorage)/ JSON書き出し
再生:  scheduler.js が step 番号と時刻を発行
        → main.js の scheduleStepSounds()
        → 各楽器の noteOn(ctx, channel, row, time, ...)  ← 発音はすべてここ
WAV:   同じ scheduleStepSounds() を OfflineAudioContext に対して実行
```

**重要な不変条件**: 発音コードは「AudioContext と出力先を引数で受け取る」形にする。
これにより リアルタイム再生 / 試聴 / WAV書き出し が同じコードで動きます。

## 楽器インターフェース

楽器は次の形のオブジェクトを default export します(詳細は `js/instruments/index.js` のコメント参照):

| メンバ | 必須 | 役割 |
|---|---|---|
| `id` / `name` / `color` / `hint` | ✅ | トラックID(保存キー、変更禁止)・表示名・色・説明 |
| `maxRows` | ✅ | グリッドの保存行数 |
| `getRows(song, params)` | ✅ | 表示する行(上から順)。スケールやキット切替で変わってよい |
| `noteOn(ctx, channel, dataRow, time, dur, song, params)` | ✅ | 時刻 `time` に1音を予約 |
| `defaultParams()` / `sanitizeParams(p)` | - | トラック固有パラメータの初期値と検証 |
| `createChannel(ctx, dest, params)` | - | リバーブ等のトラック内エフェクトチェーン。`{input, update?(p)}` を返す |
| `buildControls(container, params, api)` | - | トラック設定UI。`api = {onChange, refreshGrid, refreshControls}` |

## よくある変更のやり方

### 新しい楽器を追加する
1. `js/instruments/新楽器.js` を作り、上のインターフェースを実装
2. `js/instruments/index.js` の `INSTRUMENTS` 配列に追加(並び順=タブ順)
3. `style.css` にテーマカラー変数(例 `--c-mysynth`)を足す
4. `sw.js` の `ASSETS` にファイルを追加し、`CACHE_NAME` の版数を上げる

これだけで タブ・グリッド・音量/ミュート・自動保存・JSON入出力・WAV書き出し にすべて自動で組み込まれます。

### 楽器の音を調整する
- ICE PAD の音色: `icepad.js` の `synthIce / synthVapor / synthTexture`(単体版と同じ数式)
- ICE PAD の音量バランス: `icepad.js` の `VOICE_GAIN`
- ICE SYNTH のプリセット追加: `icesynth.js` の `PRESETS` と `PRESET_LABELS` に1行ずつ足す
- 基本4トラック: それぞれのファイル内で完結

### スケールやコードを増やす
`config.js` の `SCALES` / `CHORD_SETS` に追加し、`index.html` のスケール `<select>` に選択肢を足す。

### 保存データの形を変える
`state.js` だけを触る。ルール:
- 既存キーの意味を変えない(知らないキーは無視・欠けは初期値で補完する方針なので、**足す**のは安全)
- 大きく変える場合は保存キーの版数を上げ(`kantan-daw-song-v3`)、`loadSong()` に移行パスを足す

## 検証方法

```bash
# 構文チェック(全モジュール)
for f in $(find js -name '*.js'); do node --input-type=module --check < "$f"; done

# 手動確認
python3 -m http.server 8000   # → http://localhost:8000
```

ブラウザでの確認観点: 6トラックのタブ表示 → 各トラックで打ち込み&試聴 →
再生 → デモ曲 → WAV書き出し → リロードして復元、の順に一巡すれば主要経路を通ります。

## 設計上の意図(なぜこうなっているか)

- **楽器レジストリ方式**: 「楽器を増やす=配列に足す」に集約し、UI・保存・書き出しへの散在した修正をなくす
- **channel(トラック内エフェクト)を楽器に持たせる**: ICE SYNTH のリバーブ/シマーのような楽器固有の音作りを、DAW本体に漏らさず楽器ファイルに閉じ込める
- **ICE PAD は AudioBuffer 生成をコンテキスト非依存に**: 波形キャッシュを再生とWAV書き出しで共有でき、二重実装を防ぐ
- **state.js の寛容な読み込み**: 楽器やパラメータが将来増えても、古い保存データ・書き出しJSONがそのまま読める
- **単体版(アップロードされた icesynth.html / icepad.html)からの移植方針**: 音を決める数値・数式は変えずに移植し、「リアルタイム鍵盤用の即時発音」を「時刻指定の予約発音」に書き換えた。音の聴こえ方を変えたいときは単体版ではなく `js/instruments/` 側を修正する
