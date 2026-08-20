# 🎚️ stemsplit — 音楽をパートごとに分けるツール

曲のファイルを **ボーカル / ドラム / ベース / ギター / キーボード / その他** に分解します。
コマンドラインでも、ブラウザ画面(ドラッグ&ドロップ)でも使えます。

```
song.mp3  ──►  vocals.wav   ボーカル
               drums.wav    ドラム
               bass.wav     ベース
               guitar.wav   ギター
               piano.wav    キーボード
               other.wav    その他
```

- **入力**: mp3 / wav / flac / ogg / m4a / aac / aiff …(ffmpeg があれば mp4・wma なども)
- **出力**: wav(16/24/32bit)/ flac / mp3(ビットレート指定可)
- **カラオケ(ボーカル抜き)** の書き出し、フォルダごとの一括処理に対応
- **GPU があれば自動で使用**(CUDA / Apple Silicon の MPS)、無ければ CPU

---

## 1. インストール

Python 3.9 以上が必要です。

```bash
cd stem-splitter

# 簡易モードだけ試す(数十MB、すぐ終わる)
pip install -e .

# 高品質モード(Demucs / AI 分離)まで入れる ← ふつうはこちら
pip install -e ".[hq]"

# MP3 で書き出したい場合(ffmpeg があれば不要)
pip install -e ".[mp3]"
```

インストール後、環境を確認できます:

```bash
stemsplit --check
```

> 初めて高品質モードを実行するときに、学習済みモデル(数十MB〜1GB)が
> 自動でダウンロードされ、以後はキャッシュから読み込まれます。

## 2. 使いかた(コマンド)

```bash
# 4パート(ボーカル / ドラム / ベース / その他)
stemsplit song.mp3

# 6パート(+ ギター / キーボード)
stemsplit song.flac --stems 6

# ボーカルとカラオケの2つだけ
stemsplit song.wav --stems vocals

# 欲しいパートだけ指定
stemsplit song.mp3 --stems vocals,drums,bass

# フォルダごと、MP3 320kbps で書き出し
stemsplit music/ -f mp3 --bitrate 320 -o out/

# AI モデルを入れずにすぐ試す(簡易モード)
stemsplit song.mp3 --model lite
```

出力は既定で `separated/<モデル名>/<曲名>/<パート名>.wav` に保存されます。

### よく使うオプション

| オプション | 説明 |
|---|---|
| `-s, --stems` | `4` / `6` / `vocals` / `vocals,drums` のようなパート指定 |
| `-m, --model` | 使うモデル(`--list-models` で一覧) |
| `-o, --output` | 出力先フォルダ(既定 `separated`) |
| `-f, --format` | `wav` / `flac` / `mp3` |
| `--bitrate` | MP3 のビットレート(既定 320) |
| `--bit-depth` | WAV / FLAC のビット深度(16 / 24 / 32) |
| `--instrumental` | カラオケ(ボーカル抜き)も一緒に書き出す |
| `--shifts N` | 品質を上げる(時間も N 倍。2〜5 が目安) |
| `--device` | `auto` / `cpu` / `cuda` / `mps` |
| `--segment` | 一度に処理する秒数。メモリ不足なら小さくする |
| `--jp-names` | ファイル名を日本語にする(`ボーカル.wav`) |
| `--flat` | 曲ごとのサブフォルダを作らない |
| `--json` | 結果を JSON で出力(他のツールと連携するとき) |

## 3. 使いかた(ブラウザ画面)

```bash
stemsplit --web
```

`http://127.0.0.1:7860` が開きます。曲をドラッグ&ドロップ → パートを選ぶ →
「分解をはじめる」。終わったらその場で試聴でき、1本ずつでも ZIP まとめてでも保存できます。
外部サーバーには一切送信せず、すべて自分のパソコンの中で処理されます。

## 4. モデルの選びかた

`stemsplit --list-models` で一覧が出ます。

| モデル | パート | 特徴 |
|---|---|---|
| `htdemucs` | 4 | 既定。もっとも安定。 |
| `htdemucs_6s` | 6 | **ギター・キーボードまで分けたいならこれ** |
| `htdemucs_ft` | 4 | 最高品質だが約4倍遅い |
| `hdemucs_mmi` | 4 | 別系統。htdemucs が合わない曲の代替 |
| `mdx_extra` / `mdx_extra_q` | 4 | MDX コンペ版。ボーカルの抜けが良いことも |
| `lite` | 4 | **追加DL不要の簡易モード**。数秒で終わるが精度は低い |

> ギターとキーボードは 6パートモデル(`htdemucs_6s`)でのみ分離できます。
> 6パートモデルは 4パートモデルよりボーカル分離がわずかに苦手なので、
> 「歌だけ抜きたい」なら `--stems vocals`(4パートモデル)がおすすめです。

### 簡易モード(`lite`)について

AI を使わず、ステレオの定位と周波数・音の立ち上がりだけで振り分けます。
インストールもダウンロードも不要で数秒で終わりますが、楽器の分離精度は
AI モデルに遠く及びません。**下書き・動作確認用**と考えてください。
(4パートのみ。ギター/キーボードは分けられません)

## 5. Python から使う

```python
from stemsplit import Separator, SeparationOptions

separator = Separator(SeparationOptions(model="htdemucs_6s", output_format="flac"))
result = separator.separate_file("song.mp3", progress=lambda e: print(e.message))

for stem in result.stems:
    print(stem.label, stem.path)
```

## 6. 仕組み

```
入力ファイル ──► audio_io.load_audio      soundfile / ffmpeg で読み込み、44.1kHz に変換
                      │
                      ▼
                 engines/*.py              分離の本体(差し替え可能)
                  ├ demucs_engine.py       Demucs(AI)。長い曲はブロック分割+クロスフェード
                  └ lite_engine.py         簡易モード(STFT マスク、numpy のみ)
                      │
                      ▼
                 separator.py              カラオケ合成 / パート絞り込み / ファイル名決定
                      │
                      ▼
                 audio_io.save_audio       wav / flac / mp3 で書き出し
```

| ファイル | 役割 |
|---|---|
| `stemsplit/config.py` | パートとモデルの定義(**ここが唯一の情報源**) |
| `stemsplit/audio_io.py` | 読み書き・リサンプリング・形式判定 |
| `stemsplit/dsp.py` | STFT / ISTFT など簡易モード用の信号処理 |
| `stemsplit/engines/` | 分離エンジン。増やすときはここに1ファイル足して登録 |
| `stemsplit/separator.py` | 全体の流れ(読み込み→分離→加工→書き出し) |
| `stemsplit/cli.py` | コマンドライン |
| `stemsplit/webui/` | ブラウザ画面(標準ライブラリのみのサーバー) |

**エンジンを追加するには**: `engines/base.py` の `Engine` を継承して `separate()` を実装し、
`engines/__init__.py` の `ENGINES` と `config.py` の `MODELS` に登録するだけです。
CLI・Web UI 側の変更は不要です。

## 7. テスト

```bash
pip install -e ".[dev]"
pytest                  # すべて
pytest -m "not slow"    # 時間のかかるものを除く
```

モデルの重みをダウンロードできない環境でもテストは通ります
(Demucs のテストはランダム初期化の小さなモデルで代用します)。

## 8. うまくいかないとき

| 症状 | 対処 |
|---|---|
| `モデル … を読み込めませんでした` | ネットワークを確認。社内ネットなどで弾かれる場合は `--models-dir` に `.th` を置いたフォルダを指定 |
| `MP3 を書き出せませんでした` | `pip install lameenc` するか ffmpeg を導入 |
| ファイルを読み込めない | ffmpeg を導入すると対応形式が増えます |
| メモリ不足で落ちる | `--segment 10` や `--block-seconds 30` を試す。`--device cpu` も有効 |
| とにかく遅い | GPU を使う(`--device cuda`)。`--shifts 0`(既定)のままにする。試すだけなら `--model lite` |

## ライセンス

本ツールのコードは MIT ライセンスです。
Demucs のモデルおよび学習済み重みは、それぞれの配布元のライセンス
(Demucs は MIT、重みは研究目的の条件付き)に従います。商用利用の際は配布元の条件をご確認ください。
