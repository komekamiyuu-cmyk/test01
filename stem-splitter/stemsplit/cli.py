"""コマンドラインインターフェース。

    stemsplit song.mp3                    # 4パートに分ける
    stemsplit song.wav --stems 6          # ギター・キーボードまで分ける
    stemsplit album/ --stems vocals -f mp3
    stemsplit --web                       # ブラウザ画面を開く
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
import time
from pathlib import Path
from typing import List, Optional

from . import __version__
from .config import (
    DEFAULT_MODEL,
    INPUT_EXTENSIONS,
    MODELS,
    OUTPUT_FORMATS,
    STEM_ORDER,
    STEMS,
    stem_label,
)
from .progress import ProgressEvent
from .separator import (
    INSTRUMENTAL,
    SeparationOptions,
    SeparationResult,
    Separator,
    collect_inputs,
)

STEM_PRESETS = {
    "2": ("vocals", INSTRUMENTAL),
    "vocals": ("vocals", INSTRUMENTAL),
    "karaoke": ("vocals", INSTRUMENTAL),
    "4": (),
    "6": (),
    "all": (),
}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="stemsplit",
        description="音楽をボーカル・ドラム・ベース・ギター・キーボードなどのパートに分けます。",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "例:\n"
            "  stemsplit song.mp3                     4パート(ボーカル/ドラム/ベース/その他)\n"
            "  stemsplit song.flac --stems 6          6パート(+ギター/キーボード)\n"
            "  stemsplit song.wav --stems vocals      ボーカルとカラオケの2つ\n"
            "  stemsplit music/ -f mp3 --bitrate 320  フォルダをまとめて処理\n"
            "  stemsplit --model lite song.mp3        追加DL不要の簡易モードで試す\n"
            "  stemsplit --web                        ブラウザ画面を開く\n"
        ),
    )
    parser.add_argument("inputs", nargs="*", help="音声ファイルまたはフォルダ")
    parser.add_argument("-o", "--output", default="separated",
                        help="出力先フォルダ(既定: separated)")
    parser.add_argument("-s", "--stems", default="4",
                        help="4 / 6 / vocals / 出したいパートをカンマ区切り"
                             "(例: vocals,drums,bass)")
    parser.add_argument("-m", "--model", default=None,
                        help=f"使うモデル(既定: {DEFAULT_MODEL}、--list-models で一覧)")
    parser.add_argument("-f", "--format", default="wav", choices=OUTPUT_FORMATS,
                        dest="output_format", help="出力形式(既定: wav)")
    parser.add_argument("--bitrate", type=int, default=320,
                        help="MP3 のビットレート kbps(既定: 320)")
    parser.add_argument("--bit-depth", type=int, default=24, choices=(16, 24, 32),
                        help="WAV/FLAC のビット深度(既定: 24)")
    parser.add_argument("--device", default="auto",
                        help="auto / cpu / cuda / mps(既定: auto)")
    parser.add_argument("--shifts", type=int, default=0,
                        help="ランダムシフト回数。増やすと高品質だが時間も比例(既定: 0)")
    parser.add_argument("--overlap", type=float, default=0.25,
                        help="分割処理の重なり(既定: 0.25)")
    parser.add_argument("--segment", type=float, default=None,
                        help="1度に処理する秒数。メモリ不足なら小さくする")
    parser.add_argument("--jobs", type=int, default=0,
                        help="CPU 並列数(既定: 0=自動)")
    parser.add_argument("--instrumental", action="store_true",
                        help="ボーカル以外を混ぜた「カラオケ」も一緒に書き出す")
    parser.add_argument("--only", default=None,
                        help="書き出すパートを限定(例: vocals,drums)")
    parser.add_argument("--jp-names", action="store_true",
                        help="ファイル名を日本語にする(ボーカル.wav など)")
    parser.add_argument("--template", default="{stem}",
                        help="ファイル名テンプレート。使える項目: "
                             "{stem} {track} {model} {label_ja} {label_en}")
    parser.add_argument("--flat", action="store_true",
                        help="曲ごとのサブフォルダを作らず出力先に直接置く")
    parser.add_argument("--no-overwrite", action="store_true",
                        help="同名ファイルがあれば別名で保存する")
    parser.add_argument("--models-dir", default=None,
                        help="学習済みモデルを置いたフォルダ(オフライン実行用)")
    parser.add_argument("--block-seconds", type=float, default=90.0,
                        help="長い曲を区切って処理する長さ(既定: 90秒、0で分割なし)")
    parser.add_argument("--json", action="store_true", dest="as_json",
                        help="結果を JSON で出力する")
    parser.add_argument("-q", "--quiet", action="store_true", help="進捗を表示しない")
    parser.add_argument("--list-models", action="store_true", help="モデル一覧を表示")
    parser.add_argument("--check", action="store_true", help="動作環境を確認する")
    parser.add_argument("--web", action="store_true", help="ブラウザ用の画面を起動する")
    parser.add_argument("--host", default="127.0.0.1", help="--web のホスト")
    parser.add_argument("--port", type=int, default=7860, help="--web のポート")
    parser.add_argument("--no-browser", action="store_true",
                        help="--web でブラウザを自動で開かない")
    parser.add_argument("-V", "--version", action="version",
                        version=f"stemsplit {__version__}")
    return parser


# ----------------------------------------------------------------------
# 引数 → 設定
# ----------------------------------------------------------------------


def resolve_selection(args) -> tuple:
    """--stems / --only / --model から (モデル名, 出力するパート) を決める。"""
    spec = (args.stems or "4").strip().lower()
    only: tuple = ()
    model = args.model

    if spec in STEM_PRESETS:
        only = STEM_PRESETS[spec]
        if model is None:
            model = "htdemucs_6s" if spec == "6" else DEFAULT_MODEL
    else:
        keys = [key.strip() for key in spec.split(",") if key.strip()]
        unknown = [key for key in keys if key not in STEMS]
        if unknown:
            raise SystemExit(
                f"知らないパート名です: {', '.join(unknown)}\n"
                f"使えるのは: {', '.join(STEM_ORDER)}"
            )
        only = tuple(keys)
        if model is None:
            needs_six = any(key in ("guitar", "piano") for key in keys)
            model = "htdemucs_6s" if needs_six else DEFAULT_MODEL

    if args.only:
        only = tuple(key.strip() for key in args.only.split(",") if key.strip())
        unknown = [key for key in only if key not in STEMS]
        if unknown:
            raise SystemExit(f"知らないパート名です: {', '.join(unknown)}")
        if model is None:
            model = DEFAULT_MODEL
    return model or DEFAULT_MODEL, only


def selection_warnings(args, options: SeparationOptions) -> List[str]:
    """指定どおりに出せないときの注意書き(処理は続行する)。"""
    from .config import resolve_model

    warnings: List[str] = []
    model = resolve_model(options.model)
    if (args.stems or "").strip() == "6" and model.stem_count < 6:
        warnings.append(
            f"{model.name} は {model.stem_count} パートまでです。"
            "ギター・キーボードも分けるには --model htdemucs_6s を指定してください"
        )
    missing = [key for key in options.only
               if key not in model.stems and key != INSTRUMENTAL]
    if missing:
        warnings.append(
            f"{model.name} は {', '.join(missing)} を出力できません"
            f"(出せるのは {', '.join(model.stems)})"
        )
    return warnings


def options_from_args(args) -> SeparationOptions:
    model, only = resolve_selection(args)
    return SeparationOptions(
        model=model,
        device=args.device,
        output_dir=Path(args.output),
        output_format=args.output_format,
        bitrate=args.bitrate,
        bit_depth=args.bit_depth,
        only=only,
        instrumental=args.instrumental,
        shifts=args.shifts,
        overlap=args.overlap,
        segment=args.segment,
        jobs=args.jobs,
        block_seconds=args.block_seconds,
        models_dir=args.models_dir,
        filename_template=args.template,
        flat=args.flat,
        overwrite=not args.no_overwrite,
        jp_names=args.jp_names,
    )


# ----------------------------------------------------------------------
# 表示
# ----------------------------------------------------------------------


class ConsoleProgress:
    """端末に1行の進捗バーを出す。パイプ出力時は静かにする。"""

    def __init__(self, enabled: bool = True, stream=None) -> None:
        self.stream = stream or sys.stderr
        self.enabled = enabled and self.stream.isatty()
        self._last = 0.0

    def __call__(self, event: ProgressEvent) -> None:
        if not self.enabled:
            return
        now = time.time()
        if event.fraction < 1.0 and now - self._last < 0.1:
            return
        self._last = now
        width = max(20, min(shutil.get_terminal_size((80, 20)).columns - 34, 40))
        filled = int(width * event.fraction)
        bar = "█" * filled + "░" * (width - filled)
        text = f"\r  {bar} {event.fraction * 100:5.1f}%  {event.message[:28]:<28}"
        self.stream.write(text)
        self.stream.flush()
        if event.stage == "done":
            self.stream.write("\n")
            self.stream.flush()

    def clear(self) -> None:
        if self.enabled:
            self.stream.write("\r" + " " * 78 + "\r")
            self.stream.flush()


def print_models(stream=None) -> None:
    from .engines import engine_status

    stream = stream or sys.stdout
    status = engine_status()
    stream.write("使えるモデル:\n\n")
    for name, model in MODELS.items():
        ok, reason = status.get(model.engine, (True, ""))
        mark = "  " if ok else "× "
        stems = " / ".join(stem_label(key) for key in model.stems)
        stream.write(
            f"{mark}{name:<14} {model.stem_count}パート  品質 {model.quality:<7}"
            f" 速度 {model.speed}\n"
            f"      {stems}\n      {model.description}\n"
        )
        if not ok:
            stream.write(f"      → 使えません: {reason.splitlines()[0]}\n")
        stream.write("\n")


def print_check(stream=None) -> None:
    from . import audio_io
    from .engines import engine_status

    stream = stream or sys.stdout
    caps = audio_io.capabilities()
    stream.write(f"stemsplit {__version__}\n\n")
    stream.write("[音声の読み書き]\n")
    stream.write(f"  soundfile      : {caps['soundfile'] or '未インストール'}"
                 f" (libsndfile {caps['libsndfile'] or '-'})\n")
    stream.write(f"  ffmpeg         : {caps['ffmpeg'] or '未検出(mp4/wma などが読めません)'}\n")
    stream.write(f"  MP3 書き出し   : {'可' if caps['mp3_write'] else '不可'}\n")
    stream.write(f"  読み込み対応   : {', '.join(sorted(caps['soundfile_formats']))}\n\n")
    stream.write("[分離エンジン]\n")
    for name, (ok, reason) in engine_status().items():
        stream.write(f"  {name:<14} : {'利用可' if ok else '利用不可'}\n")
        if not ok:
            for line in reason.splitlines():
                stream.write(f"      {line}\n")
    stream.write("\n")
    try:
        from .engines.demucs_engine import resolve_device

        stream.write(f"  計算に使う装置 : {resolve_device('auto')}\n")
    except Exception:
        pass


def print_result(result: SeparationResult, stream=None) -> None:
    stream = stream or sys.stdout
    stream.write(f"\n✓ {result.source.name}  ({result.duration:.1f}秒の曲 / "
                 f"処理 {result.elapsed:.1f}秒 / モデル {result.model})\n")
    stream.write(f"  出力先: {result.output_dir}\n")
    for stem in result.stems:
        size = stem.size / 1024 / 1024
        stream.write(f"    {stem.label:<8} {stem.path.name:<28} {size:6.1f} MB\n")
    for warning in result.warnings:
        stream.write(f"  ! {warning}\n")


# ----------------------------------------------------------------------
# エントリポイント
# ----------------------------------------------------------------------


def main(argv: Optional[List[str]] = None) -> int:
    args = build_parser().parse_args(argv)

    if args.list_models:
        print_models()
        return 0
    if args.check:
        print_check()
        return 0
    if args.web:
        from .webui.server import serve

        options = options_from_args(args)
        serve(options, host=args.host, port=args.port, open_browser=not args.no_browser)
        return 0
    if not args.inputs:
        build_parser().print_help()
        return 1

    try:
        options = options_from_args(args)
        separator = Separator(options)
    except (ValueError, SystemExit) as exc:
        sys.stderr.write(f"設定エラー: {exc}\n")
        return 2

    for warning in selection_warnings(args, options):
        sys.stderr.write(f"! {warning}\n")

    files = collect_inputs(args.inputs)
    missing = [path for path in files if not Path(path).exists()]
    if missing:
        sys.stderr.write(
            "見つからないファイル: " + ", ".join(str(path) for path in missing) + "\n"
        )
        return 2
    if not files:
        sys.stderr.write(
            "処理できる音声ファイルがありませんでした"
            f"(対応拡張子: {', '.join(INPUT_EXTENSIONS)})\n"
        )
        return 2

    quiet = args.quiet or args.as_json
    results, failures = [], []
    for index, path in enumerate(files, start=1):
        if not quiet:
            sys.stderr.write(f"[{index}/{len(files)}] {Path(path).name}\n")
        progress = ConsoleProgress(enabled=not quiet)
        try:
            result = separator.separate_file(path, progress=progress)
        except Exception as exc:  # 1曲失敗しても残りは続ける
            progress.clear()
            failures.append((path, exc))
            sys.stderr.write(f"✗ {Path(path).name}: {exc}\n")
            continue
        results.append(result)
        if not args.as_json:
            print_result(result)

    if args.as_json:
        payload = {
            "version": __version__,
            "results": [result.as_dict() for result in results],
            "failures": [
                {"source": str(path), "error": str(exc)} for path, exc in failures
            ],
        }
        json.dump(payload, sys.stdout, ensure_ascii=False, indent=2)
        sys.stdout.write("\n")
    return 0 if results and not failures else 1
