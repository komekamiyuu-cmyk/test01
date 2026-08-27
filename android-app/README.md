# ✍️ てがきメモ(Androidネイティブ版)

Kotlin + Jetpack Compose + Room で作った、**Androidタブレット向け手書きメモアプリ**のプロトタイプです。
[PWA版](../handwriting-memo/) と同じ操作感を、S Pen などのスタイラス前提でネイティブ実装しています。

> **状態**: GitHub Actions でのビルドは成功しています(APK 約16MB)。
> ただし**実機での書き心地はまだ未確認**です。スタイラスでの筆圧・パームリジェクションの
> 効き具合は、実際に書いてみて調整が要る部分です。

## 端末に入れる(ビルド不要)

`android-app/` を変更して push すると、GitHub Actions が APK を作ります。

1. リポジトリの **Actions → Build Android APK** から最新の実行を開く
2. ページ下部の **Artifacts → `tegaki-memo-debug-apk`** をタブレットでダウンロード
3. zip を解凍して `app-debug.apk` をタップ
4. 「不明なアプリのインストール」を許可 → インストール

デバッグ署名のため Play ストア経由ではありませんが、自分の端末に入れる分には問題ありません。

## 自分でビルドする

```bash
# Android Studio で android-app を開く(推奨)
# もしくはコマンドラインから
cd android-app
./gradlew installDebug          # 端末を USB 接続 or エミュレータ起動の状態で
```

- **minSdk 26 / targetSdk 35**、Kotlin 2.0 + Compose BOM
- 外部サービスへの通信は一切なし。パーミッションも要求しません

## 作りの要点

### 手書き入力(`ink/InkView.kt`)
Compose の `Canvas` ではなく **`View` を自前で用意して `AndroidView` で埋め込んでいます**。
`MotionEvent` を直接扱えるため、下記がやりやすいからです。

| やっていること | 使っている仕組み |
|---|---|
| 筆圧で線の太さを変える | `MotionEvent.getPressure()`。スタイラス以外は 0.5 固定にして太くなりすぎないようにする |
| 速く動かしても線がカクつかない | `getHistoricalX/Y/Pressure()` で間引かれた中間点も拾う |
| 手のひら誤爆の防止 | `getToolType()` が STYLUS のとき時刻を記録し、直後 1.5 秒のタッチは描画に使わない |
| ペンのお尻で消す | `TOOL_TYPE_ERASER` / `BUTTON_STYLUS_PRIMARY` を検出して自動で消しゴムに切り替え |
| 2本指スクロール・ピンチズーム | `ACTION_POINTER_DOWN` 以降を自前で処理(描きかけの線は取り消す) |
| 描画の軽さ | 確定済みの線は Bitmap レイヤーにまとめ、描き途中の線だけ毎フレーム描く。画面外の線は外接矩形で除外 |

線は `[x, y, 筆圧]` のベクタで保持するので、拡大しても輪郭がぼけません。

### データ(`data/`)
Room の3テーブル構成です。

| テーブル | 中身 |
|---|---|
| `folders` | フォルダ。`parentId` で入れ子にできる |
| `notes` | メモのメタ情報(名前 / フォルダ / 更新日時 / 用紙 / ページ数 / サムネイルのパス) |
| `note_docs` | 手書き本体(ストロークを JSON 化)。一覧画面では読まないよう分離。メモ削除時は CASCADE で一緒に消える |

保存は入力が止まってから 0.7 秒後(`EditorViewModel.markDirty`)。サムネイルは重いので数秒に1回と画面を閉じるときだけ作り直します。

### 画面(`ui/`)
- `library/` … フォルダツリー + メモのカード一覧。画面幅 720dp 以上なら左ペイン常時表示、狭ければドロワー
- `editor/` … 上部バー(名前・元に戻す・その他)+ 左のツールパレット + `InkView`
- バックアップ/復元と PNG 書き出しは SAF(`CreateDocument` / `OpenDocument`)経由

## ファイル構成

```
android-app/app/src/main/java/com/example/tegakimemo/
├── MainActivity.kt            画面の出し分け(一覧 ⇄ エディタ)
├── TegakiApp.kt               Repository を持つだけの簡易コンテナ
├── ink/
│   ├── Stroke.kt              ストローク・ページ・当たり判定
│   ├── InkRenderer.kt         Canvas への描画(線 / 用紙 / 書き出し)
│   └── InkView.kt             入力処理・ジェスチャ・元に戻す
├── data/
│   ├── Entities.kt            Room のテーブル定義
│   ├── MemoDao.kt / MemoDatabase.kt
│   ├── MemoRepository.kt      保存・複製・バックアップ
│   └── ThumbnailRenderer.kt   一覧用サムネイル / PNG書き出し
└── ui/
    ├── library/               一覧画面
    ├── editor/                エディタ画面
    ├── components/            ダイアログ類
    └── theme/                 配色
```

## これから足すとよいもの

- 手書き文字の検索(OCR)、図形認識、PDF 書き出し
- 低遅延描画(`androidx.graphics.lowlatency` のフロントバッファ)で、より紙に近い書き味に
- 端末間の同期、Google ドライブへのバックアップ
